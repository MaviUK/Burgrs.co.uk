const showExtrasCache = new Map();

function normalizeRoute(route) {
  const source = route?.source === "tmdb" ? "tmdb" : "tvdb";
  const id = Number(route?.id);

  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Missing valid show id");
  }

  return { source, id };
}

function buildExtrasUrl(route) {
  return route.source === "tmdb"
    ? `/.netlify/functions/getTmdbShowDetails?tmdbId=${encodeURIComponent(route.id)}`
    : `/.netlify/functions/getShowExtras?tvdbId=${encodeURIComponent(route.id)}`;
}

export async function fetchShowExtrasCached(route) {
  const normalizedRoute = normalizeRoute(route);
  const key = `${normalizedRoute.source}:${normalizedRoute.id}`;

  if (showExtrasCache.has(key)) {
    return showExtrasCache.get(key);
  }

  const request = (async () => {
    const response = await fetch(buildExtrasUrl(normalizedRoute));

    if (!response.ok) {
      throw new Error(
        `Failed to load show extras (${response.status})`
      );
    }

    return response.json();
  })();

  showExtrasCache.set(key, request);

  try {
    return await request;
  } catch (error) {
    showExtrasCache.delete(key);
    throw error;
  }
}

export function clearShowExtrasCache(route = null) {
  if (!route) {
    showExtrasCache.clear();
    return;
  }

  try {
    const normalizedRoute = normalizeRoute(route);
    showExtrasCache.delete(
      `${normalizedRoute.source}:${normalizedRoute.id}`
    );
  } catch {
    // Ignore invalid routes when clearing a best-effort cache entry.
  }
}
