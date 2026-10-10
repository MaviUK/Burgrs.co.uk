function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text);
  }
}

async function verifyUser({ supabaseUrl, anonKey, accessToken }) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await readJson(response);
  if (!response.ok || !data?.id) {
    throw new Error("Your session could not be verified.");
  }
  return data;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey =
      process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Recommendation server configuration is incomplete.");
    }

    const authorization =
      event.headers.authorization || event.headers.Authorization || "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();

    if (!accessToken) {
      return jsonResponse(401, { error: "You must be logged in." });
    }

    const user = await verifyUser({ supabaseUrl, anonKey, accessToken });

    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/get_hidden_gems`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          p_user_id: user.id,
          p_limit: 36,
        }),
      }
    );

    const data = await readJson(response);

    if (!response.ok) {
      throw new Error(data?.message || "Could not build Hidden Gems.");
    }

    return jsonResponse(200, {
      ok: true,
      recommendations: Array.isArray(data) ? data : [],
    });
  } catch (error) {
    console.error("Hidden Gems failed:", error);
    return jsonResponse(500, {
      error: error?.message || "Could not load Hidden Gems.",
    });
  }
}
