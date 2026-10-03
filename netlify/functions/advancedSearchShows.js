const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";
const TVDB_BASE = "https://api4.thetvdb.com/v4";
const DEFAULT_REGION = "GB";
const PAGE_SIZE = 20;
const MAX_TMDB_PAGE = 500;
const MAX_TVDB_RESULTS = 5000;

let tvdbToken = null;
let tvdbTokenExpiresAt = 0;

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
    body: JSON.stringify(body),
  };
}

async function tmdbFetch(path, params = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error("Missing TMDB API key");

  const searchParams = new URLSearchParams({
    api_key: apiKey,
    language: "en-GB",
    ...params,
  });

  const res = await fetch(`${TMDB_BASE}${path}?${searchParams.toString()}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.status_message || `TMDB request failed (${res.status})`);
  }

  return data;
}

async function getTvdbToken() {
  if (tvdbToken && Date.now() < tvdbTokenExpiresAt) return tvdbToken;

  const apiKey = process.env.TVDB_API_KEY;
  if (!apiKey) throw new Error("Missing TVDB API key");

  const payload = { apikey: apiKey };
  if (process.env.TVDB_PIN) payload.pin = process.env.TVDB_PIN;

  const res = await fetch(`${TVDB_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  const token = data?.data?.token;

  if (!res.ok || !token) {
    throw new Error(data?.message || "TVDB login failed");
  }

  tvdbToken = token;
  tvdbTokenExpiresAt = Date.now() + 27 * 24 * 60 * 60 * 1000;
  return token;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rankNameMatch(name, query) {
  const normalizedName = normalizeText(name);
  const normalizedQuery = normalizeText(query);

  if (!normalizedName || !normalizedQuery) return 0;
  if (normalizedName === normalizedQuery) return 100;
  if (normalizedName.startsWith(normalizedQuery)) return 70;
  if (normalizedName.includes(normalizedQuery)) return 45;

  const queryWords = normalizedQuery.split(" ");
  const matchedWords = queryWords.filter((word) => normalizedName.includes(word));
  return matchedWords.length * 10;
}

function platformAliases(query) {
  const normalized = normalizeText(query);
  const aliases = {
    "amazon prime": ["amazon prime video", "prime video"],
    "amazon prime video": ["amazon prime video", "prime video"],
    prime: ["amazon prime video", "prime video"],
    "prime video": ["amazon prime video", "prime video"],
    disney: ["disney plus", "disney+"],
    "disney plus": ["disney plus", "disney+"],
    "disney+": ["disney plus", "disney+"],
    max: ["max", "hbo max"],
    hbo: ["max", "hbo max", "hbo"],
    "hbo max": ["max", "hbo max"],
    apple: ["apple tv plus", "apple tv+"],
    "apple tv": ["apple tv plus", "apple tv+"],
    "apple tv plus": ["apple tv plus", "apple tv+"],
    "apple tv+": ["apple tv plus", "apple tv+"],
    paramount: ["paramount plus", "paramount+"],
    "paramount plus": ["paramount plus", "paramount+"],
    "paramount+": ["paramount plus", "paramount+"],
    bbc: ["bbc iplayer"],
    iplayer: ["bbc iplayer"],
    itv: ["itvx"],
  };

  return aliases[normalized] || [query];
}

function bestMatch(items, query, getName = (item) => item?.name) {
  return [...(items || [])]
    .map((item) => ({ item, score: rankNameMatch(getName(item), query) }))
    .sort((a, b) => b.score - a.score)[0] || null;
}

async function getGenres() {
  const data = await tmdbFetch("/genre/tv/list");
  return Array.isArray(data?.genres) ? data.genres : [];
}

async function resolveGenre(query) {
  const genres = await getGenres();
  const match = bestMatch(genres, query);
  return match?.score > 0 ? match.item : null;
}

async function resolveProvider(query, region) {
  const data = await tmdbFetch("/watch/providers/tv", {
    watch_region: region,
  });
  const providers = Array.isArray(data?.results) ? data.results : [];
  const candidates = platformAliases(query);

  let best = null;
  for (const alias of candidates) {
    const match = bestMatch(providers, alias, (item) => item?.provider_name);
    if (!best || (match?.score || 0) > best.score) best = match;
  }

  return best?.score > 0 ? best.item : null;
}

function normalizeGenres(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((genre) => {
      if (typeof genre === "string") return genre;
      if (genre && typeof genre === "object") {
        return genre.name || genre.genre || genre.value || null;
      }
      return null;
    })
    .filter(Boolean);
}

function extractRemoteId(item, wantedSource) {
  const wanted = normalizeText(wantedSource);
  const pools = [
    item?.remoteIds,
    item?.remote_ids,
    item?.externalIds,
    item?.external_ids,
    item?.ids,
  ].filter(Array.isArray);

  for (const pool of pools) {
    for (const entry of pool) {
      const source = normalizeText(
        entry?.sourceName ||
          entry?.source_name ||
          entry?.sourceType ||
          entry?.source_type ||
          entry?.type ||
          entry?.name
      );
      if (source && !source.includes(wanted)) continue;

      const value = Number(
        entry?.id ||
          entry?.remoteId ||
          entry?.remote_id ||
          entry?.value ||
          entry?.externalId ||
          entry?.external_id
      );
      if (Number.isFinite(value) && value > 0) return value;
    }
  }

  return null;
}

function normalizeTvdbStudioResult(item, studioName) {
  const tvdbId = Number(item?.tvdb_id || item?.id);
  const image = item?.image_url || item?.image || item?.thumbnail || null;
  const firstAired = item?.first_air_time || item?.firstAired || item?.first_air_date || null;

  return {
    tvdb_id: Number.isFinite(tvdbId) && tvdbId > 0 ? tvdbId : null,
    tmdb_id: extractRemoteId(item, "tmdb"),
    name: item?.name || item?.seriesName || item?.title || "Unknown title",
    overview: item?.overview || item?.description || "",
    first_aired: firstAired,
    first_air_time: firstAired,
    image_url: image,
    poster_url: image,
    backdrop_url: item?.background || item?.background_url || null,
    genres: normalizeGenres(item?.genres || item?.genre),
    network: null,
    platform: null,
    studio: studioName,
    studios: [studioName],
    rating_average: Number(item?.score || item?.rating || item?.siteRating) || null,
    rating_count: Number(item?.rating_count || item?.siteRatingCount) || 0,
    popularity: Number(item?.score || 0),
    original_language: item?.primary_language || item?.language || null,
    source: "tvdb",
  };
}

async function searchTvdbCompany(query, page) {
  const token = await getTvdbToken();
  const offset = Math.max(0, (page - 1) * PAGE_SIZE);
  const params = new URLSearchParams({
    type: "series",
    company: query,
    offset: String(offset),
    limit: String(PAGE_SIZE),
    language: "eng",
    meta: "translations",
  });

  const res = await fetch(`${TVDB_BASE}/search?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "eng",
    },
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.message || "TVDB studio search failed");
  }

  const rawResults = Array.isArray(data?.data) ? data.data : [];
  const results = rawResults
    .filter((item) => {
      const type = normalizeText(item?.type);
      return !type || type === "series";
    })
    .map((item) => normalizeTvdbStudioResult(item, query))
    .filter((item) => item.tvdb_id);

  const links = data?.links || {};
  const totalCandidates = [
    links?.total_items,
    links?.totalItems,
    links?.total,
    data?.total_items,
    data?.totalItems,
    data?.total,
  ];
  const totalResults = totalCandidates
    .map(Number)
    .find((value) => Number.isFinite(value) && value >= 0) || 0;

  const nextLink = links?.next || links?.nextPage || null;
  const hasMore = Boolean(nextLink) || (
    results.length === PAGE_SIZE &&
    offset + results.length < MAX_TVDB_RESULTS &&
    (!totalResults || offset + results.length < totalResults)
  );

  return {
    results,
    totalResults,
    hasMore,
    totalPages: totalResults
      ? Math.ceil(Math.min(totalResults, MAX_TVDB_RESULTS) / PAGE_SIZE)
      : page + (hasMore ? 1 : 0),
  };
}

function normalizeTmdbResult(item, context, genreMap) {
  const genreNames = (item?.genre_ids || [])
    .map((id) => genreMap.get(Number(id)))
    .filter(Boolean);

  return {
    tvdb_id: null,
    tmdb_id: item?.id || null,
    name: item?.name || item?.original_name || "Unknown title",
    overview: item?.overview || "",
    first_aired: item?.first_air_date || null,
    first_air_time: item?.first_air_date || null,
    image_url: item?.poster_path ? `${IMAGE_BASE}/w500${item.poster_path}` : null,
    poster_url: item?.poster_path ? `${IMAGE_BASE}/w500${item.poster_path}` : null,
    backdrop_url: item?.backdrop_path
      ? `${IMAGE_BASE}/original${item.backdrop_path}`
      : null,
    genres: genreNames,
    network: context.platformName || null,
    platform: context.platformName || null,
    studio: null,
    studios: [],
    rating_average: item?.vote_average || null,
    rating_count: item?.vote_count || 0,
    popularity: item?.popularity || 0,
    original_language: item?.original_language || null,
    source: "tmdb",
  };
}

function regionLabel(region) {
  return region === "GB" ? "the UK" : region;
}

function parseYearQuery(query) {
  const normalized = String(query || "").trim().toLowerCase();

  const exactMatch = normalized.match(/^(\d{4})$/);
  if (exactMatch) {
    const year = Number(exactMatch[1]);
    if (year >= 1900 && year <= 2100) {
      return {
        startYear: year,
        endYear: year,
        label: String(year),
      };
    }
  }

  const decadeMatch = normalized.match(/^(\d{4})s$/);
  if (decadeMatch) {
    const decade = Number(decadeMatch[1]);
    if (decade >= 1900 && decade <= 2090 && decade % 10 === 0) {
      return {
        startYear: decade,
        endYear: decade + 9,
        label: `${decade}s`,
      };
    }
  }

  return null;
}

export async function handler(event) {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return response(405, { message: "Method not allowed" });
  }

  try {
    const mode = String(event.queryStringParameters?.mode || "")
      .trim()
      .toLowerCase();
    const query = String(event.queryStringParameters?.q || "").trim();
    const region = String(event.queryStringParameters?.region || DEFAULT_REGION)
      .trim()
      .toUpperCase();
    const requestedPage = Number(event.queryStringParameters?.page || 1);
    const page = Math.max(
      1,
      Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1
    );

    if (!query || !["genre", "year", "platform", "studio"].includes(mode)) {
      return response(400, {
        message: "Choose Genre, Year, Platform or Studio and enter a search term.",
      });
    }

    if (mode === "studio") {
      const studioSearch = await searchTvdbCompany(query, page);

      if (!studioSearch.results.length && page === 1) {
        return response(404, {
          message: `No studio, network or production company matched “${query}”.`,
        });
      }

      return response(200, {
        mode,
        query,
        matched: query,
        page,
        totalPages: studioSearch.totalPages,
        totalResults: studioSearch.totalResults,
        hasMore: studioSearch.hasMore,
        results: studioSearch.results,
        matchType: "tvdb-company",
      });
    }

    const genres = await getGenres();
    const genreMap = new Map(genres.map((genre) => [Number(genre.id), genre.name]));
    const discoverParams = {
      page: String(Math.min(MAX_TMDB_PAGE, page)),
      sort_by: "popularity.desc",
      include_adult: "false",
      include_null_first_air_dates: "false",
    };
    const context = {};

    if (mode === "genre") {
      const genre = await resolveGenre(query);
      if (!genre) {
        return response(404, { message: `No TV genre matched “${query}”.` });
      }
      discoverParams.with_genres = String(genre.id);
      context.genreName = genre.name;
    }

    if (mode === "platform") {
      const provider = await resolveProvider(query, region);
      if (!provider) {
        return response(404, {
          message: `No streaming platform matched “${query}” in ${regionLabel(region)}.`,
        });
      }
      discoverParams.with_watch_providers = String(provider.provider_id);
      discoverParams.watch_region = region;
      context.platformName = provider.provider_name;
    }

    if (mode === "year") {
      const yearRange = parseYearQuery(query);
      if (!yearRange) {
        return response(400, {
          message: "Enter a four-digit year such as 1973, or a decade such as 1990s.",
        });
      }

      discoverParams["first_air_date.gte"] = `${yearRange.startYear}-01-01`;
      discoverParams["first_air_date.lte"] = `${yearRange.endYear}-12-31`;
      context.yearLabel = yearRange.label;
    }

    const discovered = await tmdbFetch("/discover/tv", discoverParams);
    const rawTotalPages = Number(discovered?.total_pages || 1);
    const totalPages = Math.min(MAX_TMDB_PAGE, Math.max(1, rawTotalPages));
    const results = (Array.isArray(discovered?.results) ? discovered.results : [])
      .map((item) => normalizeTmdbResult(item, context, genreMap))
      .filter((item) => item.tmdb_id);

    return response(200, {
      mode,
      query,
      matched: context.genreName || context.platformName || context.yearLabel || query,
      page,
      totalPages,
      totalResults: Number(discovered?.total_results || results.length),
      hasMore: page < totalPages,
      results,
      matchType: mode,
    });
  } catch (error) {
    console.error("advancedSearchShows error", error);
    return response(500, {
      message: error?.message || "Advanced show search failed.",
    });
  }
}
