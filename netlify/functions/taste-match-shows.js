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
    const category = String(body?.category || "total").toLowerCase();
    const page = Math.max(1, Number(body?.page || 1));
    const pageSize = Math.min(80, Math.max(12, Number(body?.pageSize || 48)));

    if (!isUuid(targetUserId)) {
      return jsonResponse(400, { error: "Invalid profile." });
    }

    if (
      ![
        "total",
        "completed",
        "watching",
        "airing",
        "mutual",
        "both_completed",
        "both_watching",
        "only_them",
        "only_me",
      ].includes(category)
    ) {
      return jsonResponse(400, { error: "Invalid show filter." });
    }

    const viewer = await verifyUser({ supabaseUrl, anonKey, accessToken });

    const userShowParams = new URLSearchParams({
      select: "user_id,show_id,watch_status,added_at",
      user_id: `in.(${viewer.id},${targetUserId})`,
      archived_at: "is.null",
    });

    const userShows = await serviceGet({
      supabaseUrl,
      serviceRoleKey,
      table: "user_shows_new",
      params: userShowParams,
    });

    const viewerRows = userShows.filter(
      (row) => String(row.user_id) === String(viewer.id)
    );
    const targetRows = userShows.filter(
      (row) => String(row.user_id) === String(targetUserId)
    );

    const viewerMap = new Map(
      viewerRows.map((row) => [String(row.show_id), row])
    );
    const targetMap = new Map(
      targetRows.map((row) => [String(row.show_id), row])
    );

    let relevantUserShows;

    if (category === "mutual") {
      relevantUserShows = targetRows.filter((row) =>
        viewerMap.has(String(row.show_id))
      );
    } else if (category === "both_completed") {
      relevantUserShows = targetRows.filter((row) => {
        const mine = viewerMap.get(String(row.show_id));
        return (
          mine &&
          String(mine.watch_status || "").toLowerCase() === "completed" &&
          String(row.watch_status || "").toLowerCase() === "completed"
        );
      });
    } else if (category === "both_watching") {
      relevantUserShows = targetRows.filter((row) => {
        const mine = viewerMap.get(String(row.show_id));
        return (
          mine &&
          String(mine.watch_status || "").toLowerCase() === "watching" &&
          String(row.watch_status || "").toLowerCase() === "watching"
        );
      });
    } else if (category === "only_them") {
      relevantUserShows = targetRows.filter(
        (row) => !viewerMap.has(String(row.show_id))
      );
    } else if (category === "only_me") {
      relevantUserShows = viewerRows.filter(
        (row) => !targetMap.has(String(row.show_id))
      );
    } else {
      relevantUserShows = targetRows.filter((row) => {
        const watchStatus = String(row?.watch_status || "").toLowerCase();
        if (category === "completed") return watchStatus === "completed";
        if (category === "watching") return watchStatus === "watching";
        return true;
      });
    }

    const showIds = Array.from(
      new Set(relevantUserShows.map((row) => row.show_id).filter(Boolean).map(String))
    );

    const showRows = [];
    for (let index = 0; index < showIds.length; index += 100) {
      const batch = showIds.slice(index, index + 100);
      const showParams = new URLSearchParams({
        select: "id,name,poster_url,first_aired,status,tmdb_id,tvdb_id",
        id: `in.(${batch.join(",")})`,
      });

      const rows = await serviceGet({
        supabaseUrl,
        serviceRoleKey,
        table: "shows",
        params: showParams,
      });

      showRows.push(...rows);
    }

    const addedAtMap = new Map(
      relevantUserShows.map((row) => [String(row.show_id), row.added_at || null])
    );

    let filtered = showRows;
    if (category === "airing") {
      filtered = filtered.filter(
        (show) => String(show?.status || "").toLowerCase() === "continuing"
      );
    }

    filtered.sort((a, b) =>
      String(a?.name || "").localeCompare(String(b?.name || ""), "en-GB", {
        sensitivity: "base",
      })
    );

    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const items = filtered.slice(offset, offset + pageSize).map((show) => ({
      ...show,
      added_at: addedAtMap.get(String(show.id)) || null,
    }));

    return jsonResponse(200, {
      ok: true,
      category,
      page,
      pageSize,
      total,
      hasMore: offset + items.length < total,
      items,
    });
  } catch (error) {
    console.error("Taste Match show list failed:", error);
    return jsonResponse(500, {
      error: error?.message || "Could not load this user's shows.",
    });
  }
}
