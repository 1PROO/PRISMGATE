/**
 * PrismGate Admin API
 * 
 * Provides REST endpoints for managing users inside the IPTV_KV namespace.
 * Uses X-Admin-Secret custom header for authentication and includes CORS.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret, Authorization",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle CORS OPTIONS preflight request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // 2. Validate X-Admin-Secret key
    const authHeader = request.headers.get("X-Admin-Secret") || request.headers.get("Authorization");
    const secret = env.ADMIN_SECRET_KEY || "SUPER_SECURE_ADMIN_SECRET";
    
    // Support either direct header match or Bearer token format
    const isAuthorized = authHeader === secret || authHeader === `Bearer ${secret}`;
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid secret key." }), {
        status: 401,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
      });
    }

    // 3. Routing
    try {
      if (url.pathname === "/api/users" || url.pathname === "/api/users/") {
        if (request.method === "GET") {
          return await handleGetUsers(env);
        } else if (request.method === "POST") {
          return await handlePostUser(request, env);
        } else if (request.method === "DELETE") {
          return await handleDeleteUser(request, env, url);
        }
      }

      // 404 Route
      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("API error:", error);
      return new Response(JSON.stringify({ error: "Internal Server Error", message: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  }
};

async function handleGetUsers(env) {
  if (!env.IPTV_KV) {
    return new Response(JSON.stringify({ error: "KV Namespace IPTV_KV is not bound." }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // List all keys starting with 'user:'
  const listResult = await env.IPTV_KV.list({ prefix: "user:" });
  const keys = listResult.keys;

  const users = (await Promise.all(
    keys.map(async (keyObj) => {
      const value = await env.IPTV_KV.get(keyObj.name);
      if (value === null) {
        return null;
      }
      let userData = {};
      try {
        userData = JSON.parse(value);
      } catch {
        // Fallback if the KV value is a plain text password string
        userData = { password: value, status: "active", origin_host: "", origin_username: "", origin_password: "" };
      }
      if (!userData) {
        userData = {};
      }
      return {
        username: keyObj.name.replace(/^user:/, ""),
        password: userData.password || "",
        origin_host: userData.origin_host || "",
        origin_username: userData.origin_username || "",
        origin_password: userData.origin_password || "",
        status: userData.status || "active",
      };
    })
  )).filter(Boolean);

  return new Response(JSON.stringify(users), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function handlePostUser(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Bad Request: Invalid JSON body." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { username, password, origin_host, origin_username, origin_password } = body;
  if (!username || !password || !origin_host || !origin_username || !origin_password) {
    return new Response(JSON.stringify({ error: "Bad Request: username, password, origin_host, origin_username, and origin_password are all required." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Format key and value
  const kvKey = `user:${username.trim()}`;
  const kvValue = JSON.stringify({
    password: password,
    origin_host: origin_host,
    origin_username: origin_username,
    origin_password: origin_password,
    status: "active",
  });

  await env.IPTV_KV.put(kvKey, kvValue);

  return new Response(JSON.stringify({ message: "User saved successfully.", username }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function handleDeleteUser(request, env, url) {
  let username = url.searchParams.get("username");

  if (!username) {
    try {
      const body = await request.json();
      username = body.username;
    } catch {
      // Ignored: username might be in query param
    }
  }

  if (!username) {
    return new Response(JSON.stringify({ error: "Bad Request: Username is required." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const kvKey = `user:${username.trim()}`;
  
  // Verify it exists before deleting
  const exists = await env.IPTV_KV.get(kvKey);
  if (!exists) {
    return new Response(JSON.stringify({ error: "Not Found: User does not exist." }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  await env.IPTV_KV.delete(kvKey);

  return new Response(JSON.stringify({ message: "User deleted successfully.", username }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
