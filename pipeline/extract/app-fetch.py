#!/usr/bin/env python3
"""app-fetch.py - download GW's app package and store its data dump (docs/DATASET.md 11.3).

  python3 -I app-fetch.py --store DIR [--bin DIR] [--check] [--version X.Y.Z]
                          [--import PATH [--app-version V]]

Host python3, stdlib only; run as `PYTHONDONTWRITEBYTECODE=1 python3 -I app-fetch.py ...`.

The downloaded package is UNTRUSTED. Nothing in it is ever executed, installed or
unpacked to disk: the outer zip (.xapk) and the base APK inside it are opened in
memory, the single member `assets/dump.json` is read (size-capped), validated and
only then written - gzip-compressed - to the store. The package file is deleted
afterwards (and the temp dir it sat in, even on failure).

Store layout (all under --store):
  index.json                      { package, dumps: [ {appVersion, versionCode, dataVersion,
                                    file, sha256, bytes, fetchedAt, source} ] }
  dump-<dataVersion>-<sha8>.json.gz   sha256/bytes in the index are of the UNCOMPRESSED dump
  last-check.json                 { checkedAt, ok, newestListed, error, failingSince }
--bin (default <store>/../bin) holds the pinned apkeep binary (sources.json app.apkeep).

Exit codes: 0 ok / up to date; 2 usage; 3 network or download-source failure;
            4 the dump failed validation (never stored); 5 local integrity failure
            (apkeep sha256 mismatch) - fatal, nothing unverified left behind.
Stdout carries one summary line; everything else goes to stderr.
"""
import argparse
import datetime
import fcntl
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(os.path.dirname(HERE), "sources.json")

MIN_DUMP_BYTES = 20 * 1024 * 1024
MIN_TABLES = 100
MIN_DATASHEETS = 900
MAX_DUMP_BYTES = 400 * 1024 * 1024   # read cap for assets/dump.json (zip-bomb guard)
MAX_APK_BYTES = 1200 * 1024 * 1024   # read cap for a nested APK held in memory
LIST_TIMEOUT = 120
DOWNLOAD_TIMEOUT = 1800


class Failure(Exception):
    code = 1


class NetFailure(Failure):
    code = 3


class Rejected(Failure):
    code = 4


class Integrity(Failure):
    code = 5


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_hex(b):
    return hashlib.sha256(b).hexdigest()


def write_atomic(path, data):
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=d)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_json_atomic(path, obj):
    write_atomic(path, (json.dumps(obj, indent=1, ensure_ascii=False) + "\n").encode("utf-8"))


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def vkey(v):
    return tuple(int(p) for p in v.split("."))


# ---------------------------------------------------------------- apkeep ----

def ensure_apkeep(bindir, pin):
    """Return the path of a sha256-verified apkeep. Mismatch is fatal and leaves no binary."""
    path = os.path.join(bindir, "apkeep")
    want = pin["sha256"].lower()
    if os.path.exists(path):
        with open(path, "rb") as f:
            have = hashlib.sha256(f.read()).hexdigest()
        if have == want:
            return path
        os.unlink(path)  # never leave an unverified binary that something might run later
        raise Integrity("apkeep at %s failed its sha256 pin (have %s, want %s); removed" % (path, have, want))
    os.makedirs(bindir, exist_ok=True)
    log("fetching apkeep %s ..." % pin["version"])
    try:
        with urllib.request.urlopen(pin["url"], timeout=120) as r:
            blob = r.read(64 * 1024 * 1024 + 1)
    except Exception as e:  # noqa: BLE001 - any transport error is a network failure
        raise NetFailure("could not download apkeep: %s" % e)
    if len(blob) > 64 * 1024 * 1024:
        raise Integrity("apkeep download unreasonably large; discarded")
    have = sha256_hex(blob)
    if have != want:
        raise Integrity("apkeep sha256 mismatch (have %s, want %s); nothing written" % (have, want))
    fd, tmp = tempfile.mkstemp(prefix=".apkeep-", dir=bindir)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(blob)
        os.chmod(tmp, 0o755)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return path


def apkeep_env(home):
    return {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": home, "LANG": "C.UTF-8"}


def list_versions(apkeep, package, scratch):
    try:
        p = subprocess.run([apkeep, "-l", "-a", package, "-d", "apk-pure"], capture_output=True,
                           timeout=LIST_TIMEOUT, env=apkeep_env(scratch), cwd=scratch)
    except subprocess.TimeoutExpired:
        raise NetFailure("apkeep -l timed out after %ds" % LIST_TIMEOUT)
    except OSError as e:
        raise Integrity("cannot run apkeep: %s" % e)
    out = p.stdout.decode("utf-8", "replace")
    if p.returncode != 0:
        raise NetFailure("apkeep -l failed (rc %d): %s" % (p.returncode, (p.stderr.decode("utf-8", "replace") or out).strip()[-400:]))
    vers = set()
    for line in out.splitlines():
        if line.startswith("|"):
            for tok in line[1:].split(","):
                tok = tok.strip()
                if re.fullmatch(r"\d+(\.\d+)*", tok):
                    vers.add(tok)
    if not vers:
        raise NetFailure("apkeep listed no versions for %s on APKPure" % package)
    return sorted(vers, key=vkey)


def download_package(apkeep, package, version, outdir):
    log("downloading %s@%s (about 100 MB) ..." % (package, version))
    try:
        p = subprocess.run([apkeep, "-a", "%s@%s" % (package, version), "-d", "apk-pure",
                            "-o", "acknowledge_dangers=true", outdir],
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=DOWNLOAD_TIMEOUT,
                           env=apkeep_env(outdir), cwd=outdir)
    except subprocess.TimeoutExpired:
        raise NetFailure("apkeep download timed out")
    except OSError as e:
        raise Integrity("cannot run apkeep: %s" % e)
    tail = p.stderr.decode("utf-8", "replace").strip()[-400:]
    if p.returncode != 0:
        raise NetFailure("apkeep download failed (rc %d): %s" % (p.returncode, tail))
    found = []
    for root, _dirs, files in os.walk(outdir):
        for fn in files:
            if fn.endswith((".xapk", ".apk", ".apks")):
                found.append(os.path.join(root, fn))
    found.sort(key=lambda x: (not x.endswith(".xapk"), x))
    if not found:
        raise NetFailure("apkeep produced no package file: %s" % tail)
    return found[0]


# ------------------------------------------------------------ extraction ----

def read_member(zf, name, cap):
    """Read one named zip member into memory, refusing anything over `cap` bytes."""
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.file_size > cap:
        raise Rejected("%s is %d bytes, over the %d cap" % (name, info.file_size, cap))
    with zf.open(info) as f:
        data = f.read(cap + 1)
    if len(data) > cap:
        raise Rejected("%s inflates past the %d cap" % (name, cap))
    return data


def dump_from_zip(zf, package):
    """(dump_bytes, package_manifest_dict_or_None) from an APK or an XAPK zip, all in memory."""
    names = set(zf.namelist())
    if "assets/dump.json" in names:
        return read_member(zf, "assets/dump.json", MAX_DUMP_BYTES), None
    manifest = None
    mraw = read_member(zf, "manifest.json", 1024 * 1024) if "manifest.json" in names else None
    if mraw:
        try:
            manifest = json.loads(mraw)
        except ValueError:
            manifest = None
    cands = ["%s.apk" % package] + sorted(n for n in names if n.endswith(".apk") and "/" not in n and n != "%s.apk" % package)
    for name in cands:
        if name not in names:
            continue
        raw = read_member(zf, name, MAX_APK_BYTES)
        try:
            inner = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile:
            continue
        if "assets/dump.json" in inner.namelist():
            return read_member(inner, "assets/dump.json", MAX_DUMP_BYTES), manifest
    raise Rejected("no assets/dump.json in the package (looked in the APK and %d nested APKs)" % len([n for n in cands if n in names]))


def load_dump_bytes(path, package):
    """Bytes of a dump.json from an .xapk / .apk / dump.json / dump.json.gz on disk."""
    with open(path, "rb") as f:
        head = f.read(4)
    if head[:2] == b"PK":
        try:
            with zipfile.ZipFile(path) as zf:
                data, manifest = dump_from_zip(zf, package)
        except zipfile.BadZipFile as e:
            raise Rejected("not a readable zip: %s" % e)
        return data, manifest
    if head[:2] == b"\x1f\x8b":
        try:
            with gzip.open(path, "rb") as f:
                data = f.read(MAX_DUMP_BYTES + 1)
        except (OSError, EOFError) as e:
            raise Rejected("bad gzip: %s" % e)
        if len(data) > MAX_DUMP_BYTES:
            raise Rejected("gzip inflates past the cap")
        return data, None
    if os.path.getsize(path) > MAX_DUMP_BYTES:
        raise Rejected("file over the %d cap" % MAX_DUMP_BYTES)
    with open(path, "rb") as f:
        return f.read(), None


def validate_dump(data):
    """Return the parsed metadata; raise Rejected on anything off. Never stores."""
    if len(data) < MIN_DUMP_BYTES:
        raise Rejected("dump is only %d bytes (< %d)" % (len(data), MIN_DUMP_BYTES))
    try:
        d = json.loads(data)
    except (ValueError, RecursionError) as e:
        raise Rejected("dump does not parse as JSON: %s" % e)
    if not isinstance(d, dict) or not isinstance(d.get("metadata"), dict) or not isinstance(d.get("data"), dict):
        raise Rejected("dump lacks metadata{} / data{}")
    dv = d["metadata"].get("data_version")
    if not isinstance(dv, int) or isinstance(dv, bool):
        raise Rejected("metadata.data_version is not an int: %r" % (dv,))
    tables = d["data"]
    if len(tables) < MIN_TABLES:
        raise Rejected("only %d tables (< %d)" % (len(tables), MIN_TABLES))
    ds = tables.get("datasheet")
    if not isinstance(ds, list) or len(ds) < MIN_DATASHEETS:
        raise Rejected("data.datasheet has %s rows (< %d)" % (len(ds) if isinstance(ds, list) else "no", MIN_DATASHEETS))
    return dv


# ----------------------------------------------------------------- store ----

class Store:
    def __init__(self, root, package):
        self.root = root
        self.package = package
        self.index_path = os.path.join(root, "index.json")
        self.check_path = os.path.join(root, "last-check.json")
        idx = read_json(self.index_path)
        if idx is None:
            idx = {"package": package, "dumps": []}
        if idx.get("package") != package:
            raise Integrity("%s is for package %r, not %r" % (self.index_path, idx.get("package"), package))
        self.index = idx

    def entry_ok(self, e):
        return os.path.isfile(os.path.join(self.root, e["file"]))

    def stored(self, app_version):
        return [e for e in self.index["dumps"] if e.get("appVersion") == app_version and self.entry_ok(e)]

    def newest_stored(self):
        es = [e for e in self.index["dumps"] if e.get("appVersion") and self.entry_ok(e)]
        return max(es, key=lambda e: vkey(e["appVersion"])) if es else None

    def add(self, data, data_version, app_version, version_code, source):
        sha = sha256_hex(data)
        fname = "dump-%d-%s.json.gz" % (data_version, sha[:8])
        fpath = os.path.join(self.root, fname)
        if not os.path.isfile(fpath):
            buf = io.BytesIO()
            with gzip.GzipFile(filename="", mode="wb", fileobj=buf, compresslevel=9, mtime=0) as g:
                g.write(data)
            write_atomic(fpath, buf.getvalue())
        for e in self.index["dumps"]:  # identical content under the same app version is already stored
            if e.get("file") == fname and e.get("appVersion") == app_version:
                return e
        entry = {"appVersion": app_version, "versionCode": version_code, "dataVersion": data_version,
                 "file": fname, "sha256": sha, "bytes": len(data), "fetchedAt": now_iso(), "source": source}
        # a version-less entry of the same file is superseded by a versioned one
        dumps = [e for e in self.index["dumps"]
                 if not (e.get("file") == fname and (e.get("appVersion") == app_version or (app_version and e.get("appVersion") is None)))]
        dumps.append(entry)
        dumps.sort(key=lambda e: (e["dataVersion"], e["fetchedAt"]))
        self.index["dumps"] = dumps
        write_json_atomic(self.index_path, self.index)
        return entry

    def record_check(self, ok, newest_listed=None, error=None):
        prev = read_json(self.check_path, {}) or {}
        if ok:
            failing = None
        elif prev.get("ok") is False and prev.get("failingSince"):
            failing = prev["failingSince"]  # same streak: the start must not move
        else:
            failing = now_iso()
        write_json_atomic(self.check_path, {
            "checkedAt": now_iso(), "ok": ok,
            "newestListed": newest_listed if newest_listed is not None else prev.get("newestListed"),
            "error": None if ok else error, "failingSince": failing})


# ------------------------------------------------------------------ main ----

def package_pin(sources_path, package_override):
    src = read_json(sources_path)
    if not src or not isinstance(src.get("app"), dict):
        raise Failure("%s has no app block" % sources_path)
    app = src["app"]
    return package_override or app["package"], app["apkeep"]


def do_import(store, path, app_version, package):
    if not os.path.isfile(path):
        raise Rejected("--import: no such file %s" % path)
    data, manifest = load_dump_bytes(path, package)
    dv = validate_dump(data)
    version_code = None
    if isinstance(manifest, dict):
        if manifest.get("package_name") not in (None, package):
            raise Rejected("package manifest is for %r, not %r" % (manifest.get("package_name"), package))
        app_version = app_version or manifest.get("version_name")
        version_code = manifest.get("version_code")
        try:
            version_code = int(version_code) if version_code is not None else None
        except (TypeError, ValueError):
            version_code = None
    if app_version is not None and not re.fullmatch(r"\d+(\.\d+)*", str(app_version)):
        raise Rejected("bad app version %r" % (app_version,))
    e = store.add(data, dv, app_version, version_code, "import")  # says nothing about the download source: last-check.json is left alone
    print("app: stored data %d (app %s, sha %s)" % (e["dataVersion"], e["appVersion"] or "unknown", e["sha256"][:8]))


def do_fetch(store, package, pin, bindir, check, want_version, scratch_root):
    apkeep = ensure_apkeep(bindir, pin)
    os.makedirs(scratch_root, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="app-fetch-", dir=scratch_root)
    try:
        versions = list_versions(apkeep, package, tmp)
        newest = versions[-1]
        target = want_version or newest
        if want_version and want_version not in versions:
            raise NetFailure("version %s is not listed by APKPure (newest %s)" % (want_version, newest))
        have = store.stored(target)
        if have:
            e = max(have, key=lambda x: x["dataVersion"])
            store.record_check(True, newest)
            print("app: up to date (app %s, data %d)" % (e["appVersion"], e["dataVersion"]))
            return
        if check:
            ns = store.newest_stored()
            store.record_check(True, newest)
            print("app: would fetch app %s (newest stored: %s)" % (target, ns["appVersion"] if ns else "none"))
            return
        pkg = download_package(apkeep, package, target, tmp)
        try:
            data, manifest = load_dump_bytes(pkg, package)
        finally:
            try:
                os.unlink(pkg)  # the package is gone as soon as the dump is in memory
            except OSError:
                pass
        dv = validate_dump(data)
        vcode = None
        if isinstance(manifest, dict):
            if manifest.get("package_name") not in (None, package):
                raise Rejected("package manifest is for %r, not %r" % (manifest.get("package_name"), package))
            if manifest.get("version_name") not in (None, target):
                log("note: package says version_name %r, requested %s" % (manifest.get("version_name"), target))
            try:
                vcode = int(manifest.get("version_code"))
            except (TypeError, ValueError):
                vcode = None
        e = store.add(data, dv, target, vcode, "apk-pure")
        store.record_check(True, newest)
        print("app: stored data %d (app %s, sha %s)" % (e["dataVersion"], e["appVersion"], e["sha256"][:8]))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(argv):
    ap = argparse.ArgumentParser(prog="app-fetch.py", description="Download GW's app package and store its data dump.")
    ap.add_argument("--store", required=True, help="dump store dir (app-dumps)")
    ap.add_argument("--bin", help="dir for the pinned apkeep (default <store>/../bin)")
    ap.add_argument("--check", action="store_true", help="list only; print what would be fetched, store nothing")
    ap.add_argument("--version", help="fetch this app version instead of the newest")
    ap.add_argument("--import", dest="imp", metavar="PATH", help="import an .xapk, .apk or dump.json from disk")
    ap.add_argument("--app-version", help="app version to record for --import")
    ap.add_argument("--sources", default=SOURCES, help=argparse.SUPPRESS)       # test hook
    ap.add_argument("--package", default=os.environ.get("YAAB_APP_PACKAGE"), help=argparse.SUPPRESS)  # test hook
    a = ap.parse_args(argv)
    if a.app_version and not a.imp:
        ap.error("--app-version only goes with --import")
    if a.imp and (a.check or a.version):
        ap.error("--import cannot be combined with --check / --version")
    if a.version and not re.fullmatch(r"\d+(\.\d+)*", a.version):
        ap.error("--version must look like 2.8.1")

    store_dir = os.path.abspath(a.store)
    bindir = os.path.abspath(a.bin) if a.bin else os.path.join(os.path.dirname(store_dir), "bin")
    scratch_root = os.path.join(os.path.dirname(store_dir), "scratch")
    os.makedirs(store_dir, exist_ok=True)
    lockf = open(os.path.join(store_dir, ".lock"), "w")
    try:
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("app-fetch: another run holds %s/.lock" % store_dir, file=sys.stderr)
        return 3

    store = None
    try:
        package, pin = package_pin(a.sources, a.package)
        store = Store(store_dir, package)
        if a.imp:
            do_import(store, a.imp, a.app_version, package)
            return 0
        do_fetch(store, package, pin, bindir, a.check, a.version, scratch_root)
        return 0
    except Failure as e:
        log("app-fetch: %s" % e)
        if store is not None and not a.imp:  # a bad local --import says nothing about the download source
            try:
                store.record_check(False, error=str(e)[:500])
            except OSError as oe:
                log("app-fetch: could not write last-check.json: %s" % oe)
        return e.code
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
