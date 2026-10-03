function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
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

export default async (request) => {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Netlify.env.get("SUPABASE_URL");
    const anonKey =
      Netlify.env.get("SUPABASE_ANON_KEY") ||
      Netlify.env.get("VITE_SUPABASE_ANON_KEY");
    const serviceRoleKey =
      Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Netlify.env.get("SUPABASE_SECRET_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Admin server configuration is incomplete.");
    }

    const authorization = request.headers.get("authorization") || "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();

    if (!accessToken) {
      return jsonResponse({ error: "You must be logged in." }, 401);
    }

    const user = await verifyUser({ supabaseUrl, anonKey, accessToken });
    const burgrsTvId = "add17d5c-c8fd-4430-904f-271342100bf9";

    if (String(user.id) !== burgrsTvId) {
      return jsonResponse({ error: "Burgrs TV admin access required." }, 403);
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/get_admin_dashboard_snapshot`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: "{}",
      }
    );

    const data = await readJson(response);

    if (!response.ok) {
      throw new Error(data?.message || "Could not load admin dashboard.");
    }

    return jsonResponse({
      ok: true,
      dashboard: data,
      health: data?.health || null,
    });
  } catch (error) {
    console.error("Admin dashboard failed:", error);
    return jsonResponse(
      { error: error?.message || "Could not load admin dashboard." },
      500
    );
  }
};
