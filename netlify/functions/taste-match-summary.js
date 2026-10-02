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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
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

async function serviceGet({ supabaseUrl, serviceRoleKey, table, params }) {
  const rows = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?${params.toString()}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/json",
          Range: `${offset}-${offset + pageSize - 1}`,
          "Range-Unit": "items",
        },
      }
    );

    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(data?.message || `Could not read ${table}.`);
    }

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);

    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function overlapPercent(a, b) {
  if (!a.size && !b.size) return null;
  let shared = 0;
  a.forEach((value) => {
    if (b.has(value)) shared += 1;
  });
  return Math.round((2 * shared * 100) / (a.size + b.size));
}

function makeSets(rows, showMap) {
  const total = new Set();
  const completed = new Set();
  const watching = new Set();
  const airing = new Set();

  for (const row of rows || []) {
    if (!row?.show_id) continue;
    const showId = String(row.show_id);
    total.add(showId);

    const status = String(row.watch_status || "").toLowerCase();
    if (status === "completed") completed.add(showId);
    if (status === "watching") watching.add(showId);

    const showStatus = String(showMap.get(showId)?.status || "").toLowerCase();
    if (showStatus === "continuing") airing.add(showId);
  }

  return { total, completed, watching, airing };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey =
      process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Taste Match server configuration is incomplete.");
    }

    const authorization =
      event.headers.authorization || event.headers.Authorization || "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return jsonResponse(401, { error: "You must be logged in." });
    }

    const body = JSON.parse(event.body || "{}");
    const targetUserId = String(body?.targetUserId || "").trim();
    if (!isUuid(targetUserId)) {
      return jsonResponse(400, { error: "Invalid profile." });
    }

    const viewer = await verifyUser({ supabaseUrl, anonKey, accessToken });

    const userShowParams = new URLSearchParams({
      select: "user_id,show_id,watch_status,archived_at",
      user_id: `in.(${viewer.id},${targetUserId})`,
      archived_at: "is.null",
    });
    const userShows = await serviceGet({
      supabaseUrl,
      serviceRoleKey,
      table: "user_shows_new",
      params: userShowParams,
    });

    const showIds = Array.from(
      new Set(userShows.map((row) => row.show_id).filter(Boolean).map(String))
    );

    const showMap = new Map();
    for (let index = 0; index < showIds.length; index += 100) {
      const batch = showIds.slice(index, index + 100);
      const showParams = new URLSearchParams({
        select: "id,status",
        id: `in.(${batch.join(",")})`,
      });
      const shows = await serviceGet({
        supabaseUrl,
        serviceRoleKey,
        table: "shows",
        params: showParams,
      });
      shows.forEach((show) => showMap.set(String(show.id), show));
    }

    const viewerRows = userShows.filter(
      (row) => String(row.user_id) === String(viewer.id)
    );
    const targetRows = userShows.filter(
      (row) => String(row.user_id) === String(targetUserId)
    );

    const viewerSets = makeSets(viewerRows, showMap);
    const targetSets = makeSets(targetRows, showMap);

    const category = (name) => ({
      count: targetSets[name].size,
      viewerCount: viewerSets[name].size,
      match: overlapPercent(viewerSets[name], targetSets[name]),
    });

    return jsonResponse(200, {
      ok: true,
      categories: {
        total: category("total"),
        completed: category("completed"),
        watching: category("watching"),
        airing: category("airing"),
      },
    });
  } catch (error) {
    console.error("Taste Match summary failed:", error);
    return jsonResponse(500, {
      error: error?.message || "Could not calculate Taste Match summary.",
    });
  }
}
