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

function makeLibrarySets(rows, showMap) {
  const total = new Set();
  const completed = new Set();
  const watching = new Set();
  const airing = new Set();

  for (const row of rows || []) {
    if (!row?.show_id) continue;
    const showId = String(row.show_id);
    total.add(showId);

    const watchStatus = String(row.watch_status || "").toLowerCase();
    if (watchStatus === "completed") completed.add(showId);
    if (watchStatus === "watching") watching.add(showId);

    const showStatus = String(showMap.get(showId)?.status || "").toLowerCase();
    if (showStatus === "continuing") airing.add(showId);
  }

  return { total, completed, watching, airing };
}

function calculateLibraryScore(viewer, target) {
  const categories = [
    { key: "total", weight: 45 },
    { key: "completed", weight: 30 },
    { key: "airing", weight: 20 },
    { key: "watching", weight: 5, minimumCombinedShows: 4 },
  ];

  const usable = categories
    .map((item) => {
      const match = overlapPercent(viewer[item.key], target[item.key]);
      const combined = viewer[item.key].size + target[item.key].size;
      return { ...item, match, combined };
    })
    .filter(
      (item) =>
        Number.isFinite(Number(item.match)) &&
        item.combined >= Number(item.minimumCombinedShows || 0)
    );

  if (!usable.length) return null;

  const weight = usable.reduce((sum, item) => sum + item.weight, 0);
  const total = usable.reduce(
    (sum, item) => sum + Number(item.match) * item.weight,
    0
  );

  return weight ? Math.round(total / weight) : null;
}

function calculateRatingsScore(
  viewerRatings,
  targetRatings,
  viewerRanks,
  targetRanks
) {
  const shared = [];

  viewerRatings.forEach((viewerRating, showId) => {
    const targetRating = targetRatings.get(showId);
    if (!Number.isFinite(viewerRating) || !Number.isFinite(targetRating)) return;

    shared.push({
      showId,
      viewerRating,
      targetRating,
      difference: Math.abs(viewerRating - targetRating),
    });
  });

  if (shared.length < 3) {
    return {
      score: null,
      sharedRatings: shared.length,
      ratingSimilarity: null,
      rankSimilarity: null,
      sharedFavourites: 0,
    };
  }

  const ratingSimilarity =
    shared.reduce(
      (sum, item) => sum + Math.max(0, 100 - item.difference),
      0
    ) / shared.length;

  const viewerFavouriteIds = new Set(
    [...viewerRatings.entries()]
      .filter(([, rating]) => rating >= 80)
      .map(([showId]) => showId)
  );
  const targetFavouriteIds = new Set(
    [...targetRatings.entries()]
      .filter(([, rating]) => rating >= 80)
      .map(([showId]) => showId)
  );
  const sharedFavourites = [...viewerFavouriteIds].filter((showId) =>
    targetFavouriteIds.has(showId)
  ).length;
  const favouriteBase = Math.min(
    viewerFavouriteIds.size,
    targetFavouriteIds.size
  );
  const favouriteSimilarity = favouriteBase
    ? (sharedFavourites / favouriteBase) * 100
    : null;

  const sharedRanks = [];
  viewerRanks.forEach((viewerRank, showId) => {
    const targetRank = targetRanks.get(showId);
    if (!targetRank) return;
    sharedRanks.push(
      Math.max(
        0,
        100 - Math.abs(viewerRank.percentile - targetRank.percentile) * 100
      )
    );
  });
  const rankSimilarity =
    sharedRanks.length >= 2
      ? sharedRanks.reduce((sum, value) => sum + value, 0) / sharedRanks.length
      : null;

  const components = [{ value: ratingSimilarity, weight: 70 }];
  if (rankSimilarity != null) components.push({ value: rankSimilarity, weight: 20 });
  if (favouriteSimilarity != null) {
    components.push({ value: favouriteSimilarity, weight: 10 });
  }

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.round(
    components.reduce((sum, item) => sum + item.value * item.weight, 0) /
      totalWeight
  );

  return {
    score,
    sharedRatings: shared.length,
    ratingSimilarity: Math.round(ratingSimilarity),
    rankSimilarity:
      rankSimilarity == null ? null : Math.round(rankSimilarity),
    sharedFavourites,
  };
}

function makeRankMap(rows) {
  const sorted = [...rows].sort(
    (a, b) => Number(a.ladder_position || 0) - Number(b.ladder_position || 0)
  );
  return new Map(
    sorted.map((row, index) => [
      String(row.show_id),
      {
        position: Number(row.ladder_position) || index + 1,
        percentile:
          sorted.length <= 1 ? 0 : index / Math.max(1, sorted.length - 1),
      },
    ])
  );
}

function confidenceLabel(sharedRatings, usedRatingsScore) {
  if (!usedRatingsScore) return "Library-based";
  if (sharedRatings >= 20) return "High confidence";
  if (sharedRatings >= 10) return "Good confidence";
  if (sharedRatings >= 5) return "Growing confidence";
  return "Early match";
}

function isBurgrsTvProfile(profile) {
  if (!profile) return false;
  if (
    String(profile.id || "") ===
    "add17d5c-c8fd-4430-904f-271342100bf9"
  ) {
    return true;
  }

  return [profile.username, profile.display_name, profile.full_name]
    .map((value) => String(value || "").trim().toLowerCase())
    .includes("burgrs tv");
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
      throw new Error("Taste Match server configuration is incomplete.");
    }

    const authorization =
      event.headers.authorization || event.headers.Authorization || "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return jsonResponse(401, { error: "You must be logged in." });
    }

    const viewer = await verifyUser({ supabaseUrl, anonKey, accessToken });
    const mode = String(event.queryStringParameters?.mode || "closest").toLowerCase();
    const minShared = Math.max(
      0,
      Math.min(100, Number(event.queryStringParameters?.minShared || 0))
    );
    const limit = Math.max(
      1,
      Math.min(50, Number(event.queryStringParameters?.limit || 30))
    );

    const [
      profiles,
      blocks,
      userShows,
      ratings,
      rankings,
      follows,
    ] = await Promise.all([
      serviceGet({
        supabaseUrl,
        serviceRoleKey,
        table: "profiles",
        params: new URLSearchParams({
          select:
            "id,username,display_name,full_name,avatar_url",
        }),
      }),
      serviceGet({
        supabaseUrl,
        serviceRoleKey,
        table: "user_blocks",
        params: new URLSearchParams({
          select: "blocker_id,blocked_id",
          or: `(blocker_id.eq.${viewer.id},blocked_id.eq.${viewer.id})`,
        }),
      }),
      serviceGet({
        supabaseUrl,
        serviceRoleKey,
        table: "user_shows_new",
        params: new URLSearchParams({
          select: "user_id,show_id,watch_status",
          archived_at: "is.null",
        }),
      }),
      serviceGet({
        supabaseUrl,
        serviceRoleKey,
        table: "burgr_ratings",
        params: new URLSearchParams({
          select: "user_id,show_id,rating",
        }),
      }),
      serviceGet({
        supabaseUrl,
        serviceRoleKey,
        table: "user_show_rankings",
        params: new URLSearchParams({
          select: "user_id,show_id,ladder_position",
          ladder_position: "not.is.null",
        }),
      }),
      serviceGet({
        supabaseUrl,
        serviceRoleKey,
        table: "user_follows",
        params: new URLSearchParams({
          select: "following_id",
          follower_id: `eq.${viewer.id}`,
        }),
      }),
    ]);

    const blockedIds = new Set();
    blocks.forEach((row) => {
      if (String(row.blocker_id) === String(viewer.id)) {
        blockedIds.add(String(row.blocked_id));
      }
      if (String(row.blocked_id) === String(viewer.id)) {
        blockedIds.add(String(row.blocker_id));
      }
    });

    const candidates = profiles.filter(
      (profile) =>
        String(profile.id) !== String(viewer.id) &&
        !blockedIds.has(String(profile.id)) &&
        !isBurgrsTvProfile(profile)
    );

    const relevantUserIds = new Set([
      String(viewer.id),
      ...candidates.map((profile) => String(profile.id)),
    ]);

    const relevantShows = userShows.filter((row) =>
      relevantUserIds.has(String(row.user_id))
    );
    const allShowIds = Array.from(
      new Set(relevantShows.map((row) => String(row.show_id)).filter(Boolean))
    );

    const showMap = new Map();
    for (let index = 0; index < allShowIds.length; index += 100) {
      const batch = allShowIds.slice(index, index + 100);
      const showRows = await serviceGet({
        supabaseUrl,
        serviceRoleKey,
        table: "shows",
        params: new URLSearchParams({
          select: "id,status",
          id: `in.(${batch.join(",")})`,
        }),
      });
      showRows.forEach((show) => showMap.set(String(show.id), show));
    }

    const showsByUser = new Map();
    relevantShows.forEach((row) => {
      const key = String(row.user_id);
      const rows = showsByUser.get(key) || [];
      rows.push(row);
      showsByUser.set(key, rows);
    });

    const ratingsByUser = new Map();
    ratings.forEach((row) => {
      const userId = String(row.user_id);
      if (!relevantUserIds.has(userId)) return;
      const map = ratingsByUser.get(userId) || new Map();
      const rating = Number(row.rating);
      if (Number.isFinite(rating)) map.set(String(row.show_id), rating);
      ratingsByUser.set(userId, map);
    });

    const rankingsByUserRows = new Map();
    rankings.forEach((row) => {
      const userId = String(row.user_id);
      if (!relevantUserIds.has(userId)) return;
      const rows = rankingsByUserRows.get(userId) || [];
      rows.push(row);
      rankingsByUserRows.set(userId, rows);
    });

    const rankMaps = new Map();
    rankingsByUserRows.forEach((rows, userId) => {
      rankMaps.set(userId, makeRankMap(rows));
    });

    const followingIds = new Set(
      follows.map((row) => String(row.following_id)).filter(Boolean)
    );

    const viewerId = String(viewer.id);
    const viewerLibrary = makeLibrarySets(
      showsByUser.get(viewerId) || [],
      showMap
    );
    const viewerRatings = ratingsByUser.get(viewerId) || new Map();
    const viewerRanks = rankMaps.get(viewerId) || new Map();

    const matches = candidates
      .map((profile) => {
        const userId = String(profile.id);
        const targetLibrary = makeLibrarySets(
          showsByUser.get(userId) || [],
          showMap
        );
        const targetRatings = ratingsByUser.get(userId) || new Map();
        const targetRanks = rankMaps.get(userId) || new Map();

        const ratingResult = calculateRatingsScore(
          viewerRatings,
          targetRatings,
          viewerRanks,
          targetRanks
        );

        const libraryScore = calculateLibraryScore(
          viewerLibrary,
          targetLibrary
        );

        const usedRatingsScore = ratingResult.score != null;
        const score = usedRatingsScore ? ratingResult.score : libraryScore;

        return {
          profile,
          score,
          score_source: usedRatingsScore ? "ratings" : "library",
          confidence: confidenceLabel(
            ratingResult.sharedRatings,
            usedRatingsScore
          ),
          shared_ratings: ratingResult.sharedRatings,
          rating_similarity: ratingResult.ratingSimilarity,
          rank_similarity: ratingResult.rankSimilarity,
          shared_favourites: ratingResult.sharedFavourites,
          total_show_match: overlapPercent(
            viewerLibrary.total,
            targetLibrary.total
          ),
          completed_match: overlapPercent(
            viewerLibrary.completed,
            targetLibrary.completed
          ),
          airing_match: overlapPercent(
            viewerLibrary.airing,
            targetLibrary.airing
          ),
          following: followingIds.has(userId),
        };
      })
      .filter((item) => Number.isFinite(Number(item.score)))
      .filter((item) => Number(item.shared_ratings || 0) >= minShared)
      .filter((item) => (mode === "new" ? !item.following : true))
      .sort((a, b) => {
        if (mode === "opposites") {
          return (
            Number(a.score) - Number(b.score) ||
            Number(b.shared_ratings) - Number(a.shared_ratings)
          );
        }
        if (mode === "favourites") {
          return (
            Number(b.shared_favourites || 0) - Number(a.shared_favourites || 0) ||
            Number(b.score) - Number(a.score)
          );
        }
        return (
          Number(b.score) - Number(a.score) ||
          Number(b.shared_ratings) - Number(a.shared_ratings) ||
          String(a.profile?.display_name || a.profile?.username || "").localeCompare(
            String(b.profile?.display_name || b.profile?.username || ""),
            "en-GB",
            { sensitivity: "base" }
          )
        );
      })
      .slice(0, limit);

    return jsonResponse(200, {
      ok: true,
      matches,
    });
  } catch (error) {
    console.error("Taste Match user discovery failed:", error);
    return jsonResponse(500, {
      error: error?.message || "Could not find Taste Matches.",
    });
  }
}
