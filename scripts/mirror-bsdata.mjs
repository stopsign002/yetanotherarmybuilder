#!/usr/bin/env node
// scripts/mirror-bsdata.mjs
//
// Mirrors BSData/wh40k-10e XML (.cat + .gst) into data/bsdata/files/ so the
// site can serve faction data from its own origin instead of having every
// client hammer raw.githubusercontent.com (and the 60-req/hr GitHub tree
// API). Run by .github/workflows/mirror-bsdata.yml on a 6h cron.
//
// Strategy:
//   1. Fetch the BSData tree at refs/heads/main.
//   2. Diff against the existing data/bsdata/index.json (per-blob SHA).
//   3. Download only files whose SHA changed; delete files no longer upstream.
//   4. Write a fresh index.json with version + sourceCommit + per-file SHA.
//
// Idempotent: re-running with no upstream changes does nothing.
// No deps — just node:fs / node:fetch (Node 20+).

import { readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MIRROR_DIR = join(REPO_ROOT, 'data', 'bsdata');
const FILES_DIR = join(MIRROR_DIR, 'files');
const INDEX_PATH = join(MIRROR_DIR, 'index.json');

const SOURCE_REPO = 'BSData/wh40k-10e';
const SOURCE_BRANCH = 'main';
const TREE_API = `https://api.github.com/repos/${SOURCE_REPO}/git/trees/${SOURCE_BRANCH}?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${SOURCE_REPO}/${SOURCE_BRANCH}`;
const CONCURRENCY = 6;

// GITHUB_TOKEN lifts the unauthenticated 60 req/hr ceiling to 5000 req/hr —
// only used for the tree API call. Raw blob downloads are unauthenticated.
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

function ghHeaders() {
  const h = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'yaab-bsdata-mirror' };
  if (GH_TOKEN) h.Authorization = `Bearer ${GH_TOKEN}`;
  return h;
}

async function fetchTree() {
  const resp = await fetch(TREE_API, { headers: ghHeaders() });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`GitHub tree API ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  if (!data.tree) throw new Error('Tree response missing .tree');
  if (data.truncated) {
    // wh40k-10e is well under the 100k-entry truncation threshold today, but
    // bail loudly rather than silently mirror a partial set.
    throw new Error('GitHub tree response was truncated; mirror would be incomplete');
  }
  return data;
}

async function fetchHeadCommit() {
  const resp = await fetch(
    `https://api.github.com/repos/${SOURCE_REPO}/commits/${SOURCE_BRANCH}`,
    { headers: ghHeaders() },
  );
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  return data && data.sha ? data.sha : null;
}

async function fetchBlob(path) {
  const url = `${RAW_BASE}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download ${path} → HTTP ${resp.status}`);
  return await resp.text();
}

async function readExistingIndex() {
  try {
    const raw = await readFile(INDEX_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function listMirroredFiles(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...await listMirroredFiles(join(dir, entry.name), rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

async function writeFileEnsuringDir(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function runWorkers(items, worker) {
  let cursor = 0;
  const results = [];
  async function loop() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, loop));
  return results;
}

function classify(path) {
  if (path.endsWith('.gst')) return 'gamesystem';
  if (path.endsWith('.cat')) return 'catalogue';
  return null;
}

async function main() {
  console.log(`[mirror] fetching tree ${SOURCE_REPO}@${SOURCE_BRANCH}`);
  const tree = await fetchTree();

  const remoteFiles = tree.tree
    .filter(item => item.type === 'blob' && (item.path.endsWith('.cat') || item.path.endsWith('.gst')))
    .map(item => ({
      path: item.path,
      name: item.path.replace(/\.(cat|gst)$/, ''),
      type: classify(item.path),
      sha: item.sha,
      size: item.size,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  console.log(`[mirror] remote has ${remoteFiles.length} faction files`);

  const existing = await readExistingIndex();
  const existingByPath = new Map();
  if (existing && Array.isArray(existing.files)) {
    for (const f of existing.files) existingByPath.set(f.path, f);
  }

  // Diff
  const toDownload = [];
  for (const remote of remoteFiles) {
    const prior = existingByPath.get(remote.path);
    const localPath = join(FILES_DIR, `${remote.path}.xml`);
    if (!prior || prior.sha !== remote.sha || !existsSync(localPath)) {
      toDownload.push(remote);
    }
  }

  // Find local files no longer upstream (need to be deleted)
  const remotePathSet = new Set(remoteFiles.map(f => `${f.path}.xml`));
  const localRel = await listMirroredFiles(FILES_DIR);
  const toDelete = localRel.filter(rel => !remotePathSet.has(rel));

  console.log(`[mirror] ${toDownload.length} to download, ${toDelete.length} to delete`);

  if (toDownload.length === 0 && toDelete.length === 0 && existing) {
    console.log('[mirror] no changes detected; index untouched');
    // Still rewrite the timestamp? No — leaving the file untouched keeps git
    // happy and means the workflow's "is anything changed?" check skips the
    // commit cleanly.
    return { changed: false };
  }

  // Download
  let downloaded = 0;
  await runWorkers(toDownload, async (remote) => {
    const xml = await fetchBlob(remote.path);
    await writeFileEnsuringDir(join(FILES_DIR, `${remote.path}.xml`), xml);
    downloaded++;
    if (downloaded % 25 === 0 || downloaded === toDownload.length) {
      console.log(`[mirror]   downloaded ${downloaded}/${toDownload.length}`);
    }
  });

  // Delete obsolete
  for (const rel of toDelete) {
    const full = join(FILES_DIR, rel);
    await rm(full, { force: true });
    console.log(`[mirror]   removed obsolete ${rel}`);
  }

  // Compute on-disk sizes for the index (lets the client show progress
  // without a HEAD request per file).
  const sourceCommit = tree.sha || (await fetchHeadCommit()) || null;
  const filesWithSize = await Promise.all(remoteFiles.map(async (f) => {
    const localPath = join(FILES_DIR, `${f.path}.xml`);
    let size = f.size;
    try {
      const s = await stat(localPath);
      size = s.size;
    } catch (_) {}
    return {
      path: f.path,
      name: f.name,
      type: f.type,
      sha: f.sha,
      size,
    };
  }));

  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceRepo: SOURCE_REPO,
    sourceBranch: SOURCE_BRANCH,
    sourceCommit,
    files: filesWithSize,
  };

  await mkdir(MIRROR_DIR, { recursive: true });
  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');
  console.log(`[mirror] wrote ${INDEX_PATH} (commit ${sourceCommit ? sourceCommit.slice(0, 7) : 'unknown'})`);
  return { changed: true, downloaded, deleted: toDelete.length };
}

main().then((r) => {
  if (r && r.changed) {
    console.log(`[mirror] done — downloaded=${r.downloaded ?? 0} deleted=${r.deleted ?? 0}`);
  } else {
    console.log('[mirror] done — no changes');
  }
}).catch((err) => {
  console.error('[mirror] FAILED:', err.stack || err.message || err);
  process.exit(1);
});
