import { persistDiscoveryShows } from "./_persistDiscoveryShows.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const SORT_OPTIONS = {
  popular: "popularity.desc",
  rating: "vote_average.desc",
  newest: "first_air_date.desc",
  az: "original_name.asc",
};

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=1800",
    },
  });
}

function tmdbHeaders() {
  const bearer = Netlify.env.get("TMDB_BEARER_TOKEN");
  return bearer
    ? { accept: "application/json", Authorization: `Bearer ${bearer}` }
    : { accept: "application/json" };
}

function withTmdbApiKey(url) {
  const apiKey = Netlify.env.get("TMDB_API_KEY");
  if (!apiKey) return url;

  const parsed = new URL(url);
  parsed.searchParams.set("api_key", apiKey);
  return parsed.toString();
}

async function fetchTmdb(path) {
  const response = await fetch(withTmdbApiKey(`${TMDB_BASE_URL}${path}`), {
    headers: tmdbHeaders(),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.status_message || `TMDB request failed with ${response.status}`
    );
  }

  return payload;
}

function normalizeProviderName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

async function enrichShow(show) {
  let tvdbId = null;

  try {
    const externalIds = await fetchTmdb(
      `/tv/${encodeURIComponent(show.id)}/external_ids`
    );
    tvdbId = normalizePositiveInteger(externalIds?.tvdb_id);
  } catch (error) {
    console.warn(`Failed to resolve TVDB id for TMDB ${show.id}`, error);
  }

  return {
    id: show.id,
    tmdb_id: show.id,
    tvdb_id: tvdbId,
    name: show.name || show.original_name || "Unknown title",
    original_name: show.original_name || null,
    overview: show.overview || "",
    poster_url: show.poster_path
      ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
      : null,
    backdrop_url: show.backdrop_path
      ? `https://image.tmdb.org/t/p/w780${show.backdrop_path}`
      : null,
    first_air_date: show.first_air_date || null,
    vote_average: Number(show.vote_average || 0) || null,
    vote_count: Number(show.vote_count || 0) || null,
    popularity: Number(show.popularity || 0),
    original_language: show.original_language || null,
    original_country: Array.isArray(show.origin_country)
      ? show.origin_country
      : [],
  };
}

export default async (request) => {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    if (
      !Netlify.env.get("TMDB_BEARER_TOKEN") &&
      !Netlify.env.get("TMDB_API_KEY")
    ) {
      return json({ error: "TMDB is not configured" }, 500);
    }

    const url = new URL(request.url);
    const requestedProviderId = normalizePositiveInteger(
      url.searchParams.get("providerId")
    );
    const requestedProviderName = url.searchParams.get("providerName") || "";
    const page = Math.min(
      500,
      Math.max(1, normalizePositiveInteger(url.searchParams.get("page")) || 1)
    );
    const sortKey = SORT_OPTIONS[url.searchParams.get("sort")]
      ? url.searchParams.get("sort")
      : "popular";
    const genreId = normalizePositiveInteger(url.searchParams.get("genre"));

    if (!requestedProviderId && !requestedProviderName) {
      return json({ error: "Missing streaming provider" }, 400);
    }

    const [providersPayload, genresPayload] = await Promise.all([
      fetchTmdb("/watch/providers/tv?language=en-GB&watch_region=GB"),
      fetchTmdb("/genre/tv/list?language=en-GB"),
    ]);

    const providers = Array.isArray(providersPayload?.results)
      ? providersPayload.results
      : [];

    let provider =
      providers.find(
        (item) => Number(item?.provider_id) === Number(requestedProviderId)
      ) || null;

    if (!provider && requestedProviderName) {
      const wantedName = normalizeProviderName(requestedProviderName);
      provider =
        providers.find(
          (item) => normalizeProviderName(item?.provider_name) === wantedName
        ) || null;
    }

    if (!provider) {
      return json({ error: "Streaming provider not found for the UK" }, 404);
    }

    const params = new URLSearchParams({
      language: "en-GB",
      watch_region: "GB",
      with_watch_providers: String(provider.provider_id),
      with_watch_monetization_types: "flatrate",
      include_adult: "false",
      include_null_first_air_dates: "false",
      sort_by: SORT_OPTIONS[sortKey],
      page: String(page),
    });

    if (genreId) {
      params.set("with_genres", String(genreId));
    }

    if (sortKey === "rating") {
      params.set("vote_count.gte", "25");
    }

    const discoverPayload = await fetchTmdb(
      `/discover/tv?${params.toString()}`
    );

    const rawShows = Array.isArray(discoverPayload?.results)
      ? discoverPayload.results
      : [];

    const shows = await Promise.all(rawShows.map(enrichShow));

    let persistence = null;
    try {
      persistence = await persistDiscoveryShows(shows);
    } catch (error) {
      console.error("Failed persisting streaming catalogue shows", error);
    }

    return json({
      provider: {
        id: provider.provider_id,
        name: provider.provider_name,
        logo_url: provider.logo_path
          ? `https://image.tmdb.org/t/p/w185${provider.logo_path}`
          : null,
      },
      genres: Array.isArray(genresPayload?.genres) ? genresPayload.genres : [],
      shows,
      page: Number(discoverPayload?.page || page),
      total_pages: Math.min(Number(discoverPayload?.total_pages || 1), 500),
      total_results: Number(discoverPayload?.total_results || 0),
      sort: sortKey,
      genre: genreId,
      persistence,
    });
  } catch (error) {
    console.error("getStreamingProviderShows error", error);
    return json(
      { error: error?.message || "Failed to load streaming provider shows" },
      500
    );
  }
};
