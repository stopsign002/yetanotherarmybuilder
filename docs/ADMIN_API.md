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
- Newest-first ordering preferred. Pagination is fine to add later
  if the library grows; the client renders them all today.

### `DELETE /api/admin/images/:id`

Delete any user's image (moderation override).

- **Response 200** or 204 on success.
- **Response 404** if the id doesn't exist.

## 5. Bootstrap checklist

1. Run the schema migration in §1.
2. Manually `UPDATE users SET is_admin=TRUE, approved=TRUE WHERE
   username='stopsign002';` (and any other initial admins).
3. Backfill `approved=TRUE` for existing accounts (also in §1).
4. Implement the endpoint changes in §2 and §4.
5. Verify the registration path no longer issues a session cookie
   when `approved=FALSE`.
6. Test the 403 paths for `pending_approval` and `revoked` with
   curl.

## 6. Curl examples

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
```

## 7. Things explicitly NOT in scope

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
