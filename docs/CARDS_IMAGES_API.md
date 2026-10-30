# Cards mode: image library API

Reference for the card-back image library behind Cards mode
([js/ui/cards-mode.js](../js/ui/cards-mode.js)). This is the **deployed**
contract (server: `api/images.js`, table `card_back_images`), not a spec.

**Anonymous users** keep their library in browser-local IndexedDB
(`YaabDB.images`, owner `'anon'`). **Signed-in users** use the server so the
library follows them across devices ("prep cards on one computer, print from
another"). The client wrapper is `ImageStore` in `cards-mode.js`; it returns
the same `{ id, name, dataUrl, addedAt }` shape either way.

## 1. Endpoints

All routes are same-origin under `/api/images*`, authenticated with the
cookie session (`yaab_sid`). Unauthenticated callers get 401 and the client
runs `App.Auth.handleSessionExpired()`.

### `GET /api/images`

The signed-in user's library, newest first. **No pagination** — every row,
with its full data URL, comes back in one response (up to 30 images, each up
to ~7 MB of text). The client calls it once at Cards-mode mount and again on
sign-in/out.

```json
[ { "id": 17, "name": "necron-back.jpg",
    "dataUrl": "data:image/jpeg;base64,/9j/4AAQ…",
    "addedAt": 1716412800000 } ]
```

- `id` is a JS number (BIGSERIAL cast by the server); the client treats it
  opaquely and compares via `String(id)`.
- `addedAt` is a millisecond epoch.

### `POST /api/images`

Body `{ "name": string, "dataUrl": string }`. Success: `200` with the created
record (same shape as above).

| Status | Body | Client reading |
|---|---|---|
| `400` | `{ error: 'name required' \| 'name too long' \| 'dataUrl required' \| 'unsupported image type' }` | `unsupported image type` -> "Unsupported image type. Use PNG, JPEG, WebP or GIF."; other 400s -> "The server rejected that image (<error>)" |
| `401` | `{ error: 'unauthorized' }` | sign-in expired toast |
| `409` | `{ error: 'limit', limit: 30, count: 30 }` | "Library is full (30 images)" — **only** 409 means the library cap |
| `413` | `{ error: 'image too large' }` | "Image too large (max 5 MB)" — a per-image cap, **not** the library cap |
| other / 5xx | — | "The server couldn't save that image (error N)" |
| network failure | — | "check your connection" |

In every failure case the image is still applied to the current print job
locally; it just isn't saved to the library.

### `DELETE /api/images/:id`

`204` on success. `404` when the id does not exist **or belongs to another
user** (existence is never leaked). `401` unauthenticated.

## 2. Limits (all enforced server-side)

| Limit | Value | Where |
|---|---|---|
| Images per user | **30** | `LIMIT` in `images.js`; count + insert run in one transaction under `pg_advisory_xact_lock(user_id)` so concurrent POSTs cannot pass the cap |
| `name` | 1-200 chars, trimmed | the client slices the file name to 200 before sending |
| `dataUrl` length | **<= 7,000,000 chars** (~5 MB of binary after base64) | `DATA_URL_MAX`; over -> `413` |
| Route body limit | **10,000,000 bytes** | route-level `bodyLimit` on `POST /images`; the global Fastify limit stays 2 MB for the small `/armies` and `/state` PUTs |
| MIME | `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/svg+xml` by `data:` prefix | `DATA_URL_RE`; payload beyond the prefix is not decoded or validated |

The server accepts SVG; **the client does not offer it**: the file input is
`accept="image/png,image/jpeg,image/webp,image/gif"` and the change handler
re-checks `file.type` against that list (the `accept` attribute is only a
hint — drag/drop and "All files" bypass it).

Every read and write is scoped to `req.user.user_id`; an `owner` or
`username` sent by the client is ignored.

## 3. Schema

```sql
CREATE TABLE card_back_images (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  data_url    TEXT        NOT NULL,         -- data:image/...;base64,...
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX card_back_images_user_idx
  ON card_back_images (user_id, added_at DESC);
```

Keyed on `user_id`, not `username`. The bytes live in the row as the full data
URL, so the table (and every `GET /images`) is as large as the library.

## 4. Client behaviour worth knowing

- **A failed library fetch is not an empty library.** `ImageStore.list()`
  resolves `null` on a network error, 5xx or 401 (an array only on success).
  `reloadSavedImages()` then marks the library *unavailable*, keeps the
  thumbnails it already had for that owner, and shows "Image library
  unavailable right now" with a Retry button. `rehydrateCardBack()` and
  preset loading leave `cardBack.activeId` / `enabled` alone in that state;
  clearing them would be persisted by `savePrefs()` and synced (the prefs
  live in `yaab_cards_prefs`, a synced bag key), wiping the user's choice on
  one transient failure. Only a *successful* list that lacks the id means
  "that image was deleted".
- Preferences store only the image **id** (`cardBack.activeId`); the bytes
  stay in the library and are resolved by `rehydrateCardBack()` after the
  list loads.
- Library fetch happens at mount for signed-in users and downloads every
  data URL. There is no lazy or thumbnail endpoint.

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

## 6. Not in scope

- **Migrating an anon library to a signed-in account.** The client does not
  auto-import IndexedDB images on sign-in.
- **Cross-user sharing.** Images are private to their owner (admins can list
  and delete any image through `/api/admin/images`, see `ADMIN_API.md`).
- **Image editing on the server.** The server stores and returns the bytes
  the client uploaded.
- **Sync-bag inclusion.** Images are not in the small KV bag (`/api/state`);
  they are too large.
