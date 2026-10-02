import { getSupabaseAdmin } from "./_supabaseAdmin.js";

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

    const admin = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(accessToken);

    if (authError || !user?.id) {
      return jsonResponse(401, { error: "Your session could not be verified." });
    }

    const viewerUserId = user.id;

    const { data: userShows, error: showsError } = await admin
      .from("user_shows_new")
      .select("user_id, show_id, watch_status")
      .in("user_id", [viewerUserId, targetUserId])
      .is("archived_at", null);

    if (showsError) throw showsError;

    const showIds = Array.from(
      new Set((userShows || []).map((row) => row.show_id).filter(Boolean))
    );

    let showMap = new Map();
    if (showIds.length) {
      const { data: shows, error: showError } = await admin
        .from("shows")
        .select("id, status")
        .in("id", showIds);

      if (showError) throw showError;
      showMap = new Map((shows || []).map((show) => [String(show.id), show]));
    }

    const viewerRows = (userShows || []).filter(
      (row) => String(row.user_id) === String(viewerUserId)
    );
    const targetRows = (userShows || []).filter(
      (row) => String(row.user_id) === String(targetUserId)
    );

    const viewer = makeSets(viewerRows, showMap);
    const target = makeSets(targetRows, showMap);

    const category = (name) => ({
      count: target[name].size,
      viewerCount: viewer[name].size,
      match: overlapPercent(viewer[name], target[name]),
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
