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
    let credentialSource = ""; // Track where credentials were found: "query", "path", "post-form", or "post-json"
    let requestBodyText = ""; // Store POST body for later forwarding and rewriting

    console.log(`[PRISMGATE] Request: ${request.method} ${url.pathname}`);
    console.log(`[PRISMGATE] Headers: ${JSON.stringify(Object.fromEntries(request.headers.entries()))}`);

    // A. If POST, check request body first (IPTV Smarters on Tizen TV often uses POST)
    if (request.method === "POST") {
      try {
        const clonedRequest = request.clone();
        requestBodyText = await clonedRequest.text();
        console.log(`[PRISMGATE] Request Body: ${requestBodyText}`);

        const contentType = request.headers.get("Content-Type") || "";
        if (contentType.includes("application/json")) {
          const bodyJson = JSON.parse(requestBodyText);
          clientUsername = bodyJson.username || bodyJson.user;
          clientPassword = bodyJson.password || bodyJson.pass;
          if (clientUsername && clientPassword) {
            credentialSource = "post-json";
          }
        } else {
          // Default to url-encoded parameters
          const bodyParams = new URLSearchParams(requestBodyText);
          clientUsername = bodyParams.get("username") || bodyParams.get("user");
          clientPassword = bodyParams.get("password") || bodyParams.get("pass");
          if (clientUsername && clientPassword) {
            credentialSource = "post-form";
          }
        }
      } catch (err) {
        console.error("[PRISMGATE] Error parsing POST body:", err);
      }
    }

    // B. Check URL Query Parameters if not found in POST body (common in standard Xtream / M3U URLs)
    if (!clientUsername || !clientPassword) {
      clientUsername = url.searchParams.get("username") || url.searchParams.get("user");
      clientPassword = url.searchParams.get("password") || url.searchParams.get("pass");

      if (clientUsername && clientPassword) {
        credentialSource = "query";
      }
    }

    // C. Check URL Path Parameters (common in direct Xtream Codes stream paths, e.g. /live/username/password/stream_id.ts)
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

    // Case-insensitive lookup check
    const lookupKey = `user:${clientUsername.trim()}`;
    let storedValue = await env.IPTV_KV.get(lookupKey);
    
    // Fallback: If not found, try lowercase lookup
    if (!storedValue) {
      const lowerKey = `user:${clientUsername.trim().toLowerCase()}`;
      storedValue = await env.IPTV_KV.get(lowerKey);
    }

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
    
    // Clean up Origin and Referer headers to prevent origin IPTV server CSRF/origin blocks on Smart TVs (Tizen, webOS)
    forwardHeaders.delete("origin");
    forwardHeaders.delete("referer");

    // Ensure a valid standard IPTV Player User-Agent is set to prevent 403 blocks on TVs or script requests
    const userAgent = request.headers.get("User-Agent") || "";
    if (!userAgent || 
        userAgent.toLowerCase().includes("curl") || 
        userAgent.toLowerCase().includes("cloudflare") ||
        userAgent.toLowerCase().includes("tizen") ||
        userAgent.toLowerCase().includes("webos") ||
        userAgent.toLowerCase().includes("smarttv") ||
        userAgent.toLowerCase().includes("smart-tv")) {
      forwardHeaders.set("User-Agent", "IPTVSmarters/1.0.3 (iPad; iOS 16.1; Scale/2.00)");
    }
    
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
      if (credentialSource === "post-form" && requestBodyText) {
        const bodyParams = new URLSearchParams(requestBodyText);
        
        // Replace username param (support both "username" and "user" keys)
        if (bodyParams.has("username")) {
          bodyParams.set("username", originUsername);
        } else if (bodyParams.has("user")) {
          bodyParams.set("user", originUsername);
        }

        // Replace password param (support both "password" and "pass" keys)
        if (bodyParams.has("password")) {
          bodyParams.set("password", originPassword);
        } else if (bodyParams.has("pass")) {
          bodyParams.set("pass", originPassword);
        }

        forwardOptions.body = bodyParams.toString();
        forwardHeaders.set("Content-Type", "application/x-www-form-urlencoded");
        const encodedBody = new TextEncoder().encode(forwardOptions.body);
        forwardHeaders.set("Content-Length", encodedBody.length.toString());
        console.log(`[PRISMGATE] Forwarding rewritten URL-encoded body: ${forwardOptions.body}`);
      } else if (credentialSource === "post-json" && requestBodyText) {
        try {
          const bodyJson = JSON.parse(requestBodyText);
          if (bodyJson.username) bodyJson.username = originUsername;
          else if (bodyJson.user) bodyJson.user = originUsername;

          if (bodyJson.password) bodyJson.password = originPassword;
          else if (bodyJson.pass) bodyJson.pass = originPassword;

          forwardOptions.body = JSON.stringify(bodyJson);
          forwardHeaders.set("Content-Type", "application/json; charset=utf-8");
          const encodedBody = new TextEncoder().encode(forwardOptions.body);
          forwardHeaders.set("Content-Length", encodedBody.length.toString());
          console.log(`[PRISMGATE] Forwarding rewritten JSON body: ${forwardOptions.body}`);
        } catch (e) {
          forwardOptions.body = requestBodyText;
        }
      } else {
        forwardOptions.body = request.body;
      }
    }

    // 9. Fetch from origin IPTV server and return the modified response
    try {
      const originResponse = await fetch(targetUrl.toString(), forwardOptions);
      console.log(`[PRISMGATE] Origin response status: ${originResponse.status} ${originResponse.statusText}`);

      // Build clean response headers that mimic a standard Xtream Codes server
      // Smart TV IPTV apps (Smarters Pro on Tizen/webOS) reject responses with Cloudflare-specific headers
      const buildCleanHeaders = (extraHeaders = {}) => {
        const clean = new Headers();
        // Preserve essential origin headers
        const originContentType = originResponse.headers.get("Content-Type");
        if (originContentType) clean.set("Content-Type", originContentType);
        
        const cacheControl = originResponse.headers.get("Cache-Control");
        if (cacheControl) clean.set("Cache-Control", cacheControl);

        // Set standard IPTV server headers
        clean.set("Server", "nginx");
        clean.set("X-Powered-By", "PHP/7.4.5");
        clean.set("Access-Control-Allow-Origin", "*");
        clean.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
        clean.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
        clean.set("Access-Control-Allow-Credentials", "true");
        clean.set("Access-Control-Max-Age", "86400");
        clean.set("Vary", "Accept-Encoding");
        clean.set("Connection", "keep-alive");

        // Apply any extra headers
        for (const [k, v] of Object.entries(extraHeaders)) {
          clean.set(k, v);
        }
        return clean;
      };

      // Check if we need to rewrite this response (API calls and playlists)
      const contentType = originResponse.headers.get("Content-Type") || "";
      const isJson = contentType.includes("json") || url.pathname.includes("player_api.php");
      const isPlaylist = url.pathname.includes("get.php") || 
                         url.pathname.includes("xmltv.php") || 
                         url.pathname.endsWith(".m3u") || 
                         url.pathname.endsWith(".m3u8");

      // Only read as text if it's JSON or Playlist, and NOT a TS/MP4 file chunk
      if ((isJson || isPlaylist) && !url.pathname.endsWith(".ts") && !url.pathname.endsWith(".mp4")) {
        let text = await originResponse.text();

        if (isJson) {
          // Use text-based JSON rewriting to preserve exact origin formatting
          // (escaped forward slashes, field order, etc.) which Smart TV apps validate
          try {
            const data = JSON.parse(text);

            if (data && data.server_info) {
              // Rewrite server_info fields using exact text replacement on the raw JSON
              const origUrl = data.server_info.url;
              const origPort = data.server_info.port;
              const origHttpsPort = data.server_info.https_port;
              const origProtocol = data.server_info.server_protocol;
              const newPort = url.port || (url.protocol === "https:" ? "443" : "80");
              const newHttpsPort = url.protocol === "https:" ? (url.port || "443") : "443";
              const newProtocol = url.protocol.replace(":", "");

              // Replace server_info fields in the raw text (handles both escaped and unescaped)
              if (origUrl) {
                text = text.replaceAll(`"url":"${origUrl}"`, `"url":"${url.hostname}"`);
                text = text.replaceAll(`"url": "${origUrl}"`, `"url": "${url.hostname}"`);
              }
              if (origPort) {
                text = text.replaceAll(`"port":"${origPort}"`, `"port":"${newPort}"`);
                text = text.replaceAll(`"port": "${origPort}"`, `"port": "${newPort}"`);
              }
              if (origHttpsPort) {
                text = text.replaceAll(`"https_port":"${origHttpsPort}"`, `"https_port":"${newHttpsPort}"`);
                text = text.replaceAll(`"https_port": "${origHttpsPort}"`, `"https_port": "${newHttpsPort}"`);
              }
              if (origProtocol) {
                text = text.replaceAll(`"server_protocol":"${origProtocol}"`, `"server_protocol":"${newProtocol}"`);
                text = text.replaceAll(`"server_protocol": "${origProtocol}"`, `"server_protocol": "${newProtocol}"`);
              }
            }

            if (data && data.user_info) {
              // Rewrite user_info fields using text replacement
              const origUser = data.user_info.username;
              const origPass = data.user_info.password;
              if (origUser) {
                text = text.replaceAll(`"username":"${origUser}"`, `"username":"${clientUsername}"`);
                text = text.replaceAll(`"username": "${origUser}"`, `"username": "${clientUsername}"`);
              }
              if (origPass) {
                text = text.replaceAll(`"password":"${origPass}"`, `"password":"${clientPassword}"`);
                text = text.replaceAll(`"password": "${origPass}"`, `"password": "${clientPassword}"`);
              }
            }
          } catch (e) {
            // Fallback: if JSON parsing fails, just do basic text replacements below
          }
        }

        // Apply text replacements for playlists, XMLTV, and fallback JSON
        if (originHost) {
          text = text.replaceAll(originHost, url.host);
          const hostWithoutPort = originHost.split(":")[0];
          if (hostWithoutPort && hostWithoutPort.length > 3) {
            text = text.replaceAll(hostWithoutPort, url.hostname);
          }
        }
        
        if (originUsername) {
          text = text.replaceAll(originUsername, clientUsername);
        }
        if (originPassword) {
          text = text.replaceAll(originPassword, clientPassword);
        }
        
        if (url.protocol === "https:") {
          text = text.replaceAll(`http://${url.host}`, `https://${url.host}`);
        }

        // Build a clean response with explicit Content-Length (no chunked encoding)
        const encodedText = new TextEncoder().encode(text);
        const cleanHeaders = buildCleanHeaders({
          "Content-Length": encodedText.length.toString(),
        });
        // Ensure Content-Type is set for JSON
        if (isJson) {
          cleanHeaders.set("Content-Type", "application/json; charset=utf-8");
        }

        return new Response(encodedText, {
          status: originResponse.status,
          statusText: originResponse.statusText,
          headers: cleanHeaders
        });
      }

      // Default: Return the streaming response directly (e.g. for .ts stream chunks)
      const streamHeaders = buildCleanHeaders();
      return new Response(originResponse.body, {
        status: originResponse.status,
        statusText: originResponse.statusText,
        headers: streamHeaders
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
