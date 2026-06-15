# AI Agent Instructions (Claude, Codex, Agy, etc.)

Welcome AI Assistant! This repository contains a Cloudflare-based IPTV Proxy and Admin Panel named **PrismGate**. Please read this document carefully before making code edits or deployments.

---

## 💾 Database Schema (Cloudflare KV)

All user accounts are stored in a single Cloudflare KV namespace bound to `IPTV_KV`.

- **Key Format**: `user:{client_username}` (e.g., `user:john_doe`).
- **Value Format**: A JSON string containing client credentials and origin details.

### JSON Schema
```json
{
  "password": "clientPassword",
  "origin_host": "mhav1.com:2095",
  "origin_username": "315617399",
  "origin_password": "89487285635",
  "status": "active"
}
```

*Note on Fallbacks*: In older versions, values were plain text password strings. The API handles this by falling back to mapping the plain text as the `password` field and leaving `origin` fields empty.

---

## 🌐 API Specification (`admin-api`)

All endpoints are hosted under `/api/users`.

### Authentication
Every write request (`POST`, `DELETE`) and read request (`GET`) must include an authentication header. The Worker validates this header against the `ADMIN_SECRET_KEY` environment variable.
- Header: `X-Admin-Secret` or `Authorization` (supports `Bearer <token>`).

### CORS Configuration
CORS headers must be returned on all API responses, including `OPTIONS` preflight requests:
- Allow Origin: `*`
- Allow Methods: `GET, POST, DELETE, OPTIONS`
- Allow Headers: `Content-Type, X-Admin-Secret, Authorization`

### Endpoints
1. **`GET /api/users`**:
   - Lists all users.
   - **Crucial Bug Fix**: Because KV is eventually consistent, listing keys immediately after a deletion may return a key that no longer exists. If `env.IPTV_KV.get(key)` returns `null`, the code must skip/return `null` and filter it out to avoid `TypeError` (500 errors).

2. **`POST /api/users`**:
   - Adds or updates a user.
   - Body Parameters (JSON): `username`, `password`, `origin_host`, `origin_username`, `origin_password`.
   - Action: Stringifies the object and saves it under `user:{username}`.

3. **`DELETE /api/users?username={username}`**:
   - Deletes a user.

---

## 🎨 UI & Frontend Guidelines (`admin-ui`)

- **Design System**: Outlined with a premium, responsive glassmorphism dark theme using Bootstrap 5 and custom CSS.
- **Optimistic UI Updates**: To handle KV propagation latency, the frontend (`admin-ui/app.js`):
  1. Instantly modifies the local state (`USERS_CACHE`).
  2. Re-renders the table and stats immediately.
  3. Fires the API request.
  4. Performs a silent background fetch (`fetchUsers(true)`) 1.5 seconds later to sync state.
  5. Rolls back local state if the API call fails.
- **PWA Support**: Ensure `manifest.json`, `sw.js` (service worker), and `index.html` PWA registration remain intact. Custom iOS install guides must be triggered via `iosInstallModal` for Safari users.

---

## 🚀 Deployment Commands

### Deploy Main Proxy
From the root directory:
```bash
npx wrangler deploy
```

### Deploy Admin API
From the `/admin-api` directory:
```bash
cd admin-api
npx wrangler deploy
```

### Deploy Admin UI Pages
From the root directory:
```bash
npx wrangler pages deploy admin-ui --project-name prismgate-admin-ui
```
