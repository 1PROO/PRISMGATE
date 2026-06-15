/**
 * PrismGate - IPTV Proxy on Cloudflare Workers
 * 
 * This worker intercepts incoming IPTV player requests, extracts the credentials,
 * validates them against a Cloudflare KV namespace, and securely forwards
 * authorized requests to the user's designated origin IPTV server while hiding the backend.
 * 
 * Each user has their own origin server stored in KV as a JSON object:
 * { password, origin_host, origin_username, origin_password, status }
 */

// CORS headers to allow cross-origin requests from web-based IPTV players (e.g., IPTV n3u players)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle CORS Preflight (OPTIONS) requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    // 2. Extract username and password from the request
    let clientUsername = "";
    let clientPassword = "";
    let credentialSource = ""; // Track where credentials were found: "query" or "path"

    // A. Check URL Query Parameters (common in standard Xtream / M3U URLs)
    clientUsername = url.searchParams.get("username") || url.searchParams.get("user");
    clientPassword = url.searchParams.get("password") || url.searchParams.get("pass");

    if (clientUsername && clientPassword) {
      credentialSource = "query";
    }

    // B. Check URL Path Parameters (common in direct Xtream Codes stream paths, e.g. /live/username/password/stream_id.ts)
    if (!clientUsername || !clientPassword) {
      const pathParts = url.pathname.split("/").filter(Boolean);
      // Expected structure: [category, username, password, stream_id_or_file]
      // Examples: /live/user123/pass456/789.ts, /movie/user123/pass456/45.mp4
      if (pathParts.length >= 4) {
        const category = pathParts[0].toLowerCase();
        if (category === "live" || category === "movie" || category === "series") {
          clientUsername = pathParts[1];
          clientPassword = pathParts[2];
          credentialSource = "path";
        }
      }
    }

    // 3. Reject if credentials are missing
    if (!clientUsername || !clientPassword) {
      return new Response("Unauthorized: Missing IPTV credentials (username/password).", {
        status: 401,
        headers: {
          ...CORS_HEADERS,
          "WWW-Authenticate": "Basic realm=\"IPTV Proxy\""
        }
      });
    }

    // 4. Validate against Cloudflare KV namespace (IPTV_KV)
    if (!env.IPTV_KV) {
      return new Response("Internal Server Error: KV namespace 'IPTV_KV' is not bound.", {
        status: 500,
        headers: CORS_HEADERS
      });
    }

    const storedValue = await env.IPTV_KV.get(`user:${clientUsername}`);
    if (!storedValue) {
      return new Response("Unauthorized: Invalid username or password.", {
        status: 401,
        headers: CORS_HEADERS
      });
    }

    // 5. Parse user data from KV and validate
    let userData;
    try {
      userData = JSON.parse(storedValue);
    } catch (err) {
      return new Response("Internal Server Error: Malformed user data.", {
        status: 500,
        headers: CORS_HEADERS
      });
    }

    // Validate client password
    if (!userData || typeof userData !== "object" || userData.password !== clientPassword) {
      return new Response("Unauthorized: Invalid username or password.", {
        status: 401,
        headers: CORS_HEADERS
      });
    }

    // Check account status (reject if not active)
    if (userData.status !== "active") {
      return new Response("Forbidden: Account is inactive or disabled.", {
        status: 403,
        headers: CORS_HEADERS
      });
    }

    // Check expiration if set
    if (userData.expires && Date.now() > new Date(userData.expires).getTime()) {
      return new Response("Forbidden: Account has expired.", {
        status: 403,
        headers: CORS_HEADERS
      });
    }

    // 6. Extract origin connection details from user data
    const originHost = userData.origin_host;
    const originUsername = userData.origin_username;
    const originPassword = userData.origin_password;

    if (!originHost || !originUsername || !originPassword) {
      return new Response("Internal Server Error: Incomplete origin configuration for this user.", {
        status: 500,
        headers: CORS_HEADERS
      });
    }

    // 7. Construct the origin URL with credential replacement
    const originBase = `http://${originHost}`;
    let originUrl;
    try {
      originUrl = new URL(originBase);
    } catch (err) {
      return new Response("Internal Server Error: Invalid origin host configuration.", {
        status: 500,
        headers: CORS_HEADERS
      });
    }

    let targetUrl;

    if (credentialSource === "path") {
      // Path-based: /live/clientUser/clientPass/streamId.ts → /live/originUser/originPass/streamId.ts
      const pathParts = url.pathname.split("/").filter(Boolean);
      // pathParts[0] = category (live/movie/series), [1] = clientUser, [2] = clientPass, [3+] = rest
      pathParts[1] = originUsername;
      pathParts[2] = originPassword;
      const rewrittenPath = "/" + pathParts.join("/");
      targetUrl = new URL(rewrittenPath + url.search, originUrl);
    } else {
      // Query-based: ?username=clientUser&password=clientPass → ?username=originUser&password=originPass
      const targetParams = new URLSearchParams(url.searchParams);

      // Replace username param (support both "username" and "user" keys)
      if (targetParams.has("username")) {
        targetParams.set("username", originUsername);
      } else if (targetParams.has("user")) {
        targetParams.set("user", originUsername);
      }

      // Replace password param (support both "password" and "pass" keys)
      if (targetParams.has("password")) {
        targetParams.set("password", originPassword);
      } else if (targetParams.has("pass")) {
        targetParams.set("pass", originPassword);
      }

      targetUrl = new URL(url.pathname + "?" + targetParams.toString(), originUrl);
    }

    // 8. Set up forward request headers (with Host replacement)
    const forwardHeaders = new Headers(request.headers);
    
    // Replace the Host header with the target origin host (Crucial to bypass origin reverse proxy rejection)
    forwardHeaders.set("Host", originUrl.host);
    
    // Remove connection headers that Cloudflare manages
    forwardHeaders.delete("connection");
    forwardHeaders.delete("keep-alive");

    // Add proxy headers
    forwardHeaders.set("X-Forwarded-For", request.headers.get("CF-Connecting-IP") || "");
    forwardHeaders.set("X-Forwarded-Proto", "https");
    forwardHeaders.set("X-Forwarded-Host", url.host);

    const forwardOptions = {
      method: request.method,
      headers: forwardHeaders,
      redirect: "follow" // Worker will follow redirects on the backend to keep streaming origin hidden
    };

    // Forward the request body if present (e.g. on POST requests)
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
      forwardOptions.body = request.body;
    }

    // 9. Fetch from origin IPTV server and return the stream
    try {
      const originResponse = await fetch(targetUrl.toString(), forwardOptions);

      // Clone response headers to inject CORS headers
      const responseHeaders = new Headers(originResponse.headers);
      for (const [key, value] of Object.entries(CORS_HEADERS)) {
        responseHeaders.set(key, value);
      }

      // Return the streaming response directly (Cloudflare handles chunked/streaming responses without buffering)
      return new Response(originResponse.body, {
        status: originResponse.status,
        statusText: originResponse.statusText,
        headers: responseHeaders
      });
    } catch (error) {
      console.error("Error fetching from origin IPTV server:", error);
      return new Response(`Bad Gateway: Failed to connect to origin IPTV server. Error: ${error.message}`, {
        status: 502,
        headers: CORS_HEADERS
      });
    }
  }
};
