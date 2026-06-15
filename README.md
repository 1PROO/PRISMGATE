# PrismGate 🌌 - IPTV Proxy & Admin Dashboard

PrismGate is a high-performance, secure IPTV Proxy system built entirely on Cloudflare Workers and Cloudflare Pages. It hides your backend origin IPTV server credentials by validating client accounts against a Cloudflare KV namespace and swapping credentials on-the-fly for streaming. It includes a sleek, modern Glassmorphism Admin Dashboard for managing user accounts.

---

## 🏗️ Architecture & Project Structure

The project is split into three main modules:

1. **IPTV Proxy Worker (Root)**:
   - File: [index.js](file:///c:/Users/AHMED/Desktop/dev/2026/PrismGate/index.js)
   - Config: [wrangler.toml](file:///c:/Users/AHMED/Desktop/dev/2026/PrismGate/wrangler.toml)
   - Function: Intercepts client IPTV player requests, validates credentials against the KV namespace, swaps client credentials with their custom origin IPTV credentials, sets proper headers (including `Host`), and forwards requests to the origin server.

2. **Admin API Worker (`/admin-api/`)**:
   - Directory: [admin-api](file:///c:/Users/AHMED/Desktop/dev/2026/PrismGate/admin-api)
   - Function: A REST API that handles secure CRUD operations (Create, Read, Update, Delete) on the `IPTV_KV` namespace. Requires a custom `X-Admin-Secret` header for writes.

3. **Admin UI Dashboard (`/admin-ui/`)**:
   - Directory: [admin-ui](file:///c:/Users/AHMED/Desktop/dev/2026/PrismGate/admin-ui)
   - Function: A static Bootstrap 5 web app utilizing a premium Glassmorphism dark theme. It features user management forms, automatic password generation, clipboard copying of IPTV hosts, and is a fully installable PWA (Progressive Web App) with custom mobile/iOS install support.

---

## ⚡ Deployment Instructions

To deploy this project to your own Cloudflare account, follow these steps:

### Prerequisites
- Node.js & npm installed.
- A Cloudflare account with a KV namespace created.

### Step 1: Create KV Namespace
Create a KV namespace named `IPTV_KV` in your Cloudflare dashboard, or via Wrangler:
```bash
npx wrangler kv namespace create IPTV_KV
```
Take note of the generated **ID**.

### Step 2: Configure & Deploy the Main Proxy Worker
1. Open the root `wrangler.toml` and paste the generated KV namespace ID under `[[kv_namespaces]]`:
   ```toml
   [[kv_namespaces]]
   binding = "IPTV_KV"
   id = "YOUR_KV_NAMESPACE_ID"
   ```
2. (Optional) Set up a custom subdomain like `gate.yourdomain.com` for your IPTV player host:
   ```toml
   routes = [
     { pattern = "gate.yourdomain.com", custom_domain = true }
   ]
   ```
3. Deploy the proxy worker:
   ```bash
   npx wrangler deploy
   ```

### Step 3: Configure & Deploy the Admin API Worker
1. Navigate to the `admin-api` directory:
   ```bash
   cd admin-api
   ```
2. Open `admin-api/wrangler.toml` and bind the same KV namespace ID.
3. Set your secure admin key under `[vars]`:
   ```toml
   [vars]
   ADMIN_SECRET_KEY = "YourSecureKeyHere"
   ```
4. Deploy the API worker:
   ```bash
   npm install
   npx wrangler deploy
   ```
   Take note of your deployed Worker URL (e.g., `https://prismgate-admin-api.username.workers.dev`).

### Step 4: Configure & Deploy the Admin UI Dashboard
1. Open [admin-ui/app.js](file:///c:/Users/AHMED/Desktop/dev/2026/PrismGate/admin-ui/app.js) and update the `API_URL` constant with your deployed API Worker URL:
   ```javascript
   const API_URL = "https://prismgate-admin-api.username.workers.dev";
   ```
2. Return to the root directory and deploy the `admin-ui` folder to Cloudflare Pages:
   ```bash
   npx wrangler pages deploy admin-ui --project-name prismgate-admin-ui
   ```

---

## 🤖 Instructions for AI Coding Assistants (Claude, Codex, Agy)

If you are an AI coding assistant working on this repository, please read and adhere to the guidelines documented in **[AGENT_INSTRUCTIONS.md](file:///c:/Users/AHMED/Desktop/dev/2026/PrismGate/AGENT_INSTRUCTIONS.md)** for a description of the KV schema, CORS, and deployment scripts.
