# Cards mode: image library API

Reference for the deploying agent. The Cards-mode feature
([js/ui/cards-mode.js](../js/ui/cards-mode.js)) lets users save
card-back images they re-use across print jobs. **Anonymous users**
keep their library in browser-local IndexedDB. **Signed-in users**
need their library on the server so it follows them across devices
(the user's stated workflow: "prep cards on one computer, print from
another").

This document specifies the server-side API the client expects. The
client wrapper that calls it is `ImageStore` in
[cards-mode.js](../js/ui/cards-mode.js). It already exists and falls
back to `YaabDB.images` (browser IndexedDB) when not signed in, so
the IDB path keeps working before the API is deployed; until the
server endpoints exist, signed-in users will see an empty library
+ a "Couldn't save to your account — check your connection." toast
on upload.

## 1. Endpoints

All routes are same-origin under `/api/images*`. Authentication is
the existing cookie session (same as `/api/armies`, `/api/state`,
`/api/auth/*`). Reject unauthenticated callers with 401 and let the
client's `App.Auth.handleSessionExpired()` path kick in.

### `GET /api/images`

List the signed-in user's library.

- **Auth**: required (401 otherwise).
- **Response 200**: JSON array of records, newest first.
  ```json
  [
    { "id": 17, "name": "necron-back.jpg",
      "dataUrl": "data:image/jpeg;base64,/9j/4AAQ…",
      "addedAt": 1716412800000 }
  ]
  ```
  - `id` may be a number or a string (UUID) — the client treats it
    opaquely and round-trips via `String(id)` for comparisons.
  - `dataUrl` is a `data:` URL with the embedded image bytes.
  - `addedAt` is a millisecond epoch.
- **Response 401**: `{ "error": "unauthorized" }`.

### `POST /api/images`

Add a new image to the signed-in user's library.

- **Auth**: required.
- **Request body** (JSON):
  ```json
  { "name": "necron-back.jpg",
    "dataUrl": "data:image/jpeg;base64,/9j/4AAQ…" }
  ```
  - `name`: any non-empty string. Trim and cap to ~200 chars
    server-side.
  - `dataUrl`: a `data:` URL. Validate the MIME prefix
    (`image/png`, `image/jpeg`, `image/webp`, `image/gif`,
    `image/svg+xml`). Reject otherwise with 400.
- **Response 200**: the created record, same shape as items in the
  list response. The client treats whatever `id` you return as
  authoritative.
- **Response 400**: malformed body. Body: `{ "error": "<reason>" }`.
- **Response 409 or 413** when the user is at the cap (30 images):
  ```json
  { "error": "limit", "limit": 30, "count": 30 }
  ```
  Either status code works — the client checks for both. Include
  `limit` and `count` so the toast can surface accurate numbers.
  Prefer 409 ("Conflict") for a soft cap, 413 ("Payload Too Large")
  for individual-image-too-big violations.
- **Response 413** (payload too large) for individual image files
  bigger than your chosen per-image cap. Suggested: 5 MB per image,
  matching what most printers can render meaningfully.

### `DELETE /api/images/:id`

Delete an image owned by the signed-in user.

- **Auth**: required.
- `:id` is the same opaque id the client received from `GET /api/images`.
- **Response 200** or 204 on success.
- **Response 404** if the id doesn't exist OR doesn't belong to the
  caller — never leak that the id exists for someone else.

## 2. Server-side enforcement

These rules MUST hold server-side; client checks are best-effort:

1. **Owner scoping**. Every read/write filters on the authenticated
   user. Never trust an `owner`/`username` field from the client.
2. **30-image cap per user**. Enforce on `POST` in the same DB
   transaction as the insert (count + insert under the same lock).
3. **Per-image size cap**. Reject overly large data URLs at the
   request-body limit AND at the application layer.
4. **MIME allowlist**. Reject anything that isn't an image MIME.

## 3. Schema sketch

If using SQL:

```sql
CREATE TABLE card_back_images (
  id          BIGSERIAL PRIMARY KEY,
  username    TEXT        NOT NULL
              REFERENCES users(username) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  data_url    TEXT        NOT NULL,         -- data:image/...;base64,...
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_card_back_images_username
  ON card_back_images (username, added_at DESC);
```

Or store the bytes in object storage (S3/etc) and only keep
`{ id, username, name, content_type, blob_key, added_at }` in the
DB; on `GET` re-emit the `dataUrl` by reading the blob and base64-
encoding it. Either approach is fine — the API surface is the
contract.

A row-count constraint can be enforced in the app layer:

```sql
-- Pseudo-ish: in a single transaction
BEGIN;
SELECT count(*) FROM card_back_images WHERE username = :u FOR UPDATE;
-- if >= 30 → roll back, return 409
INSERT INTO card_back_images (username, name, data_url)
  VALUES (:u, :name, :dataUrl) RETURNING id, added_at;
COMMIT;
```

(Or rely on a `CHECK` trigger that maintains a per-user count.)

## 4. Body-size limit

Image data URLs can be hundreds of KB to a few MB. Whatever JSON
body limit Fastify (or whatever the server uses) is configured for
needs to allow at least **8 MB** to comfortably accept a 5 MB image
encoded as base64 (≈ 6.7 MB) plus the JSON envelope. Without this
the `POST` will fail before the route handler runs.

Existing `/api/armies` PUT bodies are tiny — bumping the limit just
for `/api/images` (e.g. via a route-level `bodyLimit`) is safer than
raising the global limit.

## 5. Curl examples

```sh
# List
curl -b cookies.txt https://yaab.example/api/images

# Upload (image needs to be base64-d into a data URL first)
DATA=$(printf 'data:image/jpeg;base64,%s' "$(base64 -w0 back.jpg)")
curl -b cookies.txt -X POST https://yaab.example/api/images \
  -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg n back.jpg --arg d "$DATA" \
            '{name:$n, dataUrl:$d}')"

# Delete
curl -b cookies.txt -X DELETE https://yaab.example/api/images/17
```

## 6. Things NOT in scope

- **Migrating an anon library to a signed-in account**. The client
  doesn't auto-import IDB images on sign-in. Could be a follow-up if
  users complain.
- **Cross-user sharing**. Images are private to their owner.
- **Image editing on the server**. The client uploads exactly what
  the user picked; server stores/returns the same bytes.
- **Sync-bag inclusion**. These images are NOT in the small KV bag
  (`/api/state`) — they're too big. Treat them as a separate
  resource like `/api/armies`, not part of the bag.
