# Admin + account-approval API

Reference for the deploying agent. The site runs in approval-gated
mode: anyone can register, but no one can sign in until an admin has
approved their account. The site operator (`stopsign002` initially)
also has a moderation panel for the user-uploaded card-back image
library that backs `docs/CARDS_IMAGES_API.md`.

This document specifies the database changes, new endpoints, and
behavioural changes the API needs. Client code already expects the
shapes below — see [js/app/admin.js](../js/app/admin.js),
[js/app/auth.js](../js/app/auth.js), and
[js/ui/auth-modal.js](../js/ui/auth-modal.js).

## 1. Schema changes

Add three columns to the `users` table (or its equivalent). Suggested
Postgres DDL:

```sql
ALTER TABLE users
  ADD COLUMN approved        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN approved_at     TIMESTAMPTZ NULL,
  ADD COLUMN approved_by     TEXT        NULL,
  ADD COLUMN revoked         BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN revoked_at      TIMESTAMPTZ NULL,
  ADD COLUMN is_admin        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN created_at      TIMESTAMPTZ NOT NULL DEFAULT now();

-- Bootstrap the site operator (run ONCE, manually):
UPDATE users
   SET approved = TRUE, approved_at = now(), is_admin = TRUE
 WHERE username = 'stopsign002';
```

If you don't have a `created_at` column already, the example above
adds one — adjust to your schema.

Existing accounts (created before this migration) should be back-
filled to `approved = TRUE` so they don't get locked out:

```sql
UPDATE users
   SET approved = TRUE, approved_at = COALESCE(created_at, now())
 WHERE approved = FALSE;
```

## 2. Auth endpoint behaviour changes

### `POST /api/auth/register`

When approval gating is enabled (always — no feature flag needed):

- Create the row with `approved = FALSE`, `revoked = FALSE`,
  `is_admin = FALSE`.
- **Do NOT issue a session cookie.**
- Respond 200 with the existing recovery-code body, **plus** a
  `pending: true` field:
  ```json
  {
    "username": "alice",
    "recoveryCode": "alpha-bravo-charlie-delta",
    "pending": true
  }
  ```
- Client UI (auth-modal.js, line ~228) reads `data.pending` and
  shows a "pending approval" message in the recovery-code modal,
  and skips the auto-sign-in path in `Auth.register`.

### `POST /api/auth/login`

- Look up the user. If not found OR password mismatch → existing 400
  / 401 path (do NOT distinguish the two; it leaks user enumeration).
- If user found and password matches BUT `approved = FALSE`:
  ```
  HTTP/1.1 403 Forbidden
  { "error": "pending_approval" }
  ```
  (No cookie issued.)
- If user found and password matches BUT `revoked = TRUE`:
  ```
  HTTP/1.1 403 Forbidden
  { "error": "revoked" }
  ```
- Otherwise issue cookie and respond 200 with:
  ```json
  { "username": "alice", "is_admin": false }
  ```
  (`is_admin` is new — auth.js stamps it onto `_user` so the admin
  menu entry can light up.)

### `GET /api/auth/me`

- Return `is_admin` alongside the existing `username`:
  ```json
  { "username": "alice", "is_admin": true }
  ```
- If the cookie's user has been `revoked` after sign-in, return 401
  so the client clears the session.

## 3. Image upload gate

The image-library endpoints documented in
[docs/CARDS_IMAGES_API.md](./CARDS_IMAGES_API.md) accept user
uploads. Optional but recommended hardening:

- Require `approved = TRUE` (already implied, since unapproved users
  can't sign in).
- Future: a per-user `can_upload_images` flag for finer-grained
  control. The admin panel already has the surface for "revoke" —
  add a separate "image upload" toggle if you want that distinction.

## 4. Admin endpoints

All endpoints below require `is_admin = TRUE`. Reject with 403 for
authenticated non-admins, 401 for unauthenticated.

### `GET /api/admin/users`

List every user in the system.

- **Response 200**: JSON array of user records:
  ```json
  [
    {
      "username": "alice",
      "approved": true,
      "revoked": false,
      "is_admin": false,
      "created_at": 1716412800000,
      "approved_at": 1716499200000,
      "approved_by": "stopsign002",
      "image_count": 5
    },
    ...
  ]
  ```
  - All timestamps are millisecond epoch (the client uses `new
    Date(ms).toLocaleString()`).
  - `image_count` is optional but nice — drives the "Images" column
    in the admin table. Leave it out and the column renders "—".

### `POST /api/admin/users/:username/approve`

Approve (or re-approve, after revoke) the named user.

- Sets `approved = TRUE`, `revoked = FALSE`, `approved_at = now()`,
  `approved_by = <admin-username>`.
- **Response 200**: `{ "ok": true }` (or the updated user record).
- **Response 404** if user doesn't exist.

### `POST /api/admin/users/:username/revoke`

Revoke an approved user's access.

- Sets `revoked = TRUE`, `revoked_at = now()`. (Keep `approved_at`
  for history.)
- Server **must** invalidate any active session cookies for that
  user — easiest: bump a per-user session token / version, or wipe
  their entry from a session table.
- Refuse with 403 if the target is `is_admin = TRUE` (admins can't
  revoke each other through the API; demote via DB if needed).
- **Response 200**: `{ "ok": true }`.

### `GET /api/admin/images`

List every uploaded image across all users (for moderation).

- **Response 200**: JSON array, same record shape as in
  `CARDS_IMAGES_API.md`, plus `owner` (the username):
  ```json
  [
    { "id": 17, "owner": "alice", "name": "necron.jpg",
      "dataUrl": "data:image/jpeg;base64,…", "addedAt": 1716412800000 },
    ...
  ]
  ```
- Newest-first ordering preferred. **There is no server-side
  pagination:** the response holds every user's data URLs (up to 30 images
  per user, each up to ~7 MB of text), so on a busy site it is the heaviest
  request the panel makes. The client paginates **client-side**, 20 images
  per page (Previous / Next above and below the grid), so only 20 `<img>`
  elements exist at a time; the download itself is still the whole list.
  Server pagination (`?limit=&before=`) is the follow-up if the response
  size becomes a problem. The page resets to 1 on every tab load and is
  clamped after a delete.

### `DELETE /api/admin/images/:id`

Delete any user's image (moderation override).

- **Response 200** or 204 on success.
- **Response 404** if the id doesn't exist.

### `GET /api/admin/users/pending-count`

Lightweight summary used by the admin-only "pending approvals" banner
in [js/app/pending-approval-banner.js](../js/app/pending-approval-banner.js).
Polled every 60 s while an admin is signed in.

- **Response 200**:
  ```json
  { "count": 3 }
  ```
  Just the integer count of users with `approved = FALSE AND revoked = FALSE`.
  The client falls back to fetching `/api/admin/users` and counting
  pending rows itself if this endpoint is missing — implementing it is
  recommended (the fallback is a heavier request) but optional.

## 5. Bug reports

User-submitted reports collected via the topbar bug-report icon
([js/app/bug-report.js](../js/app/bug-report.js)) and reviewed in the
admin panel's Reports tab ([js/app/admin.js](../js/app/admin.js)).

### Schema

```sql
CREATE TABLE bug_reports (
  id              BIGSERIAL PRIMARY KEY,
  username        TEXT        NOT NULL,
  kind            TEXT        NOT NULL DEFAULT 'bug',  -- 'bug' | 'feature'
  title           TEXT        NOT NULL,
  description     TEXT        NOT NULL,
  diagnostics     TEXT        NULL,
  attachment_file TEXT        NULL,                    -- server-generated filename under BUG_ATTACH_DIR (never sent to the client), or NULL
  attachment_mime TEXT        NULL,                    -- e.g. image/png, video/webm
  attachment_size BIGINT      NULL,                    -- bytes
  fixed        BOOLEAN     NOT NULL DEFAULT FALSE,
  fixed_at     TIMESTAMPTZ NULL,
  fixed_by     TEXT        NULL,
  fixed_note   TEXT        NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- added later; email is written by POST /bugs, the rest ONLY by the hourly fixer:
  email        TEXT        NULL,
  fix_mode     TEXT        NULL,
  fix_report   TEXT        NULL,
  escalated_at TIMESTAMPTZ NULL,
  attempts     INTEGER     NOT NULL DEFAULT 0,
  notified_at  TIMESTAMPTZ NULL
);
CREATE INDEX bug_reports_created_at_desc ON bug_reports (created_at DESC);
CREATE INDEX bug_reports_open            ON bug_reports (fixed) WHERE fixed = FALSE;
```

The column that stores the upload is **`attachment_file`** (a
server-generated filename). The row never holds a URL: `attachment_url` in
the admin API is *derived* by the mapper as
`/api/admin/bugs/<id>/attachment`, an admin-only route that streams the file
with its MIME, `nosniff` and a sandbox CSP.

**Fixer-owned columns.** `bug-fixer.py` (hourly, on the host) owns
`fix_mode` (`'auto'` = verified and applied unattended, `'intervention'` = a
human finished it), `fix_report` (JSON verdict), `escalated_at` (parked for a
human; stops the hourly retry), `attempts`, and `notified_at` (the reporter
has been told). The API and the admin panel never write them; marking a
report fixed from the panel is picked up by the fixer's next run, which then
emails the reporter (if they left an address). Consequence for the panel:
**"Mark fixed" sends email**, so a mis-click is not free and Cancel on its
dialog must abort.

`username` is the submitter at the time of the report — store it
literally (don't FK to `users.username`) so the row survives revoke /
deletion of the original user.

`kind` discriminates bug reports from feature requests; the admin
panel can filter or group on it. Default `'bug'` preserves the shape
for callers that don't send the field (legacy clients).

### `POST /api/bugs` (auth required, NOT admin-only)

Submit a bug report or feature request. Sender must be signed in
(`approved = TRUE`, `revoked = FALSE`).

Two request shapes:

**a) No attachment — JSON**:

```json
{
  "kind":        "bug",
  "title":       "Wardens of Ultramar shows wrong stats",
  "description": "Multi-stage repro …",
  "diagnostics": "App version: …\nDate/time: …\n…"
}
```

`kind` is `"bug"` or `"feature"`; missing/unknown values default to
`"bug"`. Server caps: `title` 200 chars, `description` 4000,
`diagnostics` 16000, `email` 254; empty `title` / `description` is a 400.
An optional `email` (reporter's address, used only for the "fixed" note) is
validated and a malformed one is a 400.

**Diagnostics length.** The server truncates over-long `diagnostics` to 16,000
characters (marker included) rather than rejecting the report. The client
still slices first, to `16000 - marker.length` plus its own
`\n…(truncated)…` marker, so the total never exceeds the cap on either path
(it used to send 16,014 characters and get a 400 for exactly the large-army
case it meant to handle).

**b) With attachment — `multipart/form-data`**:

Text fields `kind`, `title`, `description`, `diagnostics` as above,
plus an optional file part named `attachment`. The file MUST be an
image or video; reject any other MIME with 415. Cap at 50 MB; reject
larger uploads with 413. Persist to your file store (S3 / disk) and
record the public URL + MIME + size on the row.

- **Response 200**:
  ```json
  { "id": 42 }
  ```
- **Response 401** if not signed in (the client clears the session and
  prompts re-login; see `App.Auth.handleSessionExpired`).
- **Response 413** if the attachment exceeds the 50 MB cap.
- **Response 415** if the attachment isn't an image or video.

### `GET /api/admin/bugs`

List every report, newest first. Admin only.

- **Response 200**: array of records:
  ```json
  [
    {
      "id": 42,
      "username": "alice",
      "kind": "bug",
      "title": "Wardens of Ultramar shows wrong stats",
      "description": "…",
      "diagnostics": "…",
      "attachment_url": "https://files.yaab.example/bug-42.png",
      "attachment_mime": "image/png",
      "attachment_size": 184320,
      "fixed": false,
      "fixed_at": null,
      "fixed_by": null,
      "fixed_note": null,
      "created_at": 1730937600000
    },
    ...
  ]
  ```
  - `kind` is `"bug"` or `"feature"`. Rows from before the column
    existed should default to `"bug"`.
  - `attachment_url` / `_mime` / `_size` are `null` when no file was
    uploaded.
  - Timestamps are millisecond epoch (the client uses
    `new Date(ms).toLocaleString()`).
  - Server-side sort by `created_at DESC` is preferred; the client
    sorts defensively as well.
- Filter shape (`?status=open|fixed|all`) is **not** required —
  the client filters in-memory between the three Open / Fixed / All
  tabs. Adding a server-side filter is fine if the table grows large.
  Like `/admin/images`, this returns every row (diagnostics included) with
  no pagination.

### Panel load behaviour (client)

- A failed load (network, 5xx) shows an error state in the tab body with a
  **Retry** button; it is never rendered as "No open reports" / "No users".
  A `403` still closes the panel ("Admin access denied"); a `401` runs the
  session-expired path.
- Every load carries a request token: a response that arrives after the user
  has switched tab (or reloaded) is discarded, so tab A's rows cannot paint
  under tab B.
- Revoke, delete-image and delete-report confirm through `UI.askDialog`
  (styled `.modal`, `.btn-outline` Cancel beside a `.btn-danger` primary); no
  native `prompt()` / `confirm()` remains in `admin.js`.

### `POST /api/admin/bugs/:id/fix`

Mark a report fixed. Admin only.

- **Body** (optional):
  ```json
  { "note": "fixed in commit 4939e8e" }
  ```
- Sets `fixed = TRUE`, `fixed_at = now()`, `fixed_by = <admin-username>`,
  `fixed_note = body.note ?? NULL`. The note is trimmed, an empty one is
  stored as NULL, and over 4000 chars is a `400 note too long`.
- The panel asks for the note in a styled dialog (`UI.askDialog`); **Cancel
  aborts without sending the request** (an earlier `prompt() || ''` treated
  Cancel as "no note" and marked the report fixed anyway).
- **Response 200**: either `{ "ok": true }` or the updated record (the
  client merges in whatever it receives, falling back to a local patch
  if the response is just `{ ok: true }`).
- **Response 404** if the id doesn't exist.

### `POST /api/admin/bugs/:id/unfix`

Reopen a previously-fixed report.

- Sets `fixed = FALSE`, `fixed_at = NULL`, `fixed_by = NULL`,
  `fixed_note = NULL`.
- **Response 200**: same shape as `/fix`.

### `DELETE /api/admin/bugs/:id`

Permanently delete a report (used to purge spam / duplicates).

- **Response 200** or 204.
- **Response 404** if the id doesn't exist.

## 6. Bootstrap checklist

1. Run the schema migration in §1.
2. Manually `UPDATE users SET is_admin=TRUE, approved=TRUE WHERE
   username='stopsign002';` (and any other initial admins).
3. Backfill `approved=TRUE` for existing accounts (also in §1).
4. Implement the endpoint changes in §2 and §4.
5. Verify the registration path no longer issues a session cookie
   when `approved=FALSE`.
6. Test the 403 paths for `pending_approval` and `revoked` with
   curl.

## 7. Curl examples

```sh
# As stopsign002 (after signing in via the normal /login flow):

# List all users
curl -b cookies.txt https://yaab.example/api/admin/users

# Approve alice
curl -b cookies.txt -X POST \
  https://yaab.example/api/admin/users/alice/approve

# Revoke bob
curl -b cookies.txt -X POST \
  https://yaab.example/api/admin/users/bob/revoke

# Browse all uploaded images
curl -b cookies.txt https://yaab.example/api/admin/images

# Delete an image (any owner)
curl -b cookies.txt -X DELETE \
  https://yaab.example/api/admin/images/17

# Pending-approval count (banner uses this)
curl -b cookies.txt https://yaab.example/api/admin/users/pending-count

# List bug reports
curl -b cookies.txt https://yaab.example/api/admin/bugs

# Mark report 42 fixed with a note
curl -b cookies.txt -X POST -H 'Content-Type: application/json' \
  -d '{"note":"fixed in commit 4939e8e"}' \
  https://yaab.example/api/admin/bugs/42/fix

# Reopen report 42
curl -b cookies.txt -X POST \
  https://yaab.example/api/admin/bugs/42/unfix

# Submit a bug report (any signed-in user)
curl -b cookies.txt -X POST -H 'Content-Type: application/json' \
  -d '{"title":"…","description":"…","diagnostics":"…"}' \
  https://yaab.example/api/bugs
```

## 8. Things explicitly NOT in scope

- **Email notifications** when someone registers (no email infra).
  Site admins notice via the admin panel's "Pending" tab. Could be
  added later via webhook or polling.
- **Self-service profile edits** beyond the existing
  Auth.changePassword / Auth.recover. Username changes, deletion,
  etc. are out of scope.
- **Rate limiting on registration**. Recommended at the proxy /
  load-balancer layer if abuse becomes a problem.
- **Audit log of admin actions**. The schema already records
  `approved_at` / `approved_by` / `revoked_at`. A separate
  `admin_audit_log` table is a sensible follow-up if the user list
  grows.
- **Multi-admin promotion through the panel**. To make a second
  admin, set `is_admin=TRUE` directly in the DB — the panel
  intentionally has no "promote to admin" button so a compromised
  admin account can't hand the keys out.
