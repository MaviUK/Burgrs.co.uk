import { withPublicCache } from "./_publicDataCache.js";
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";
const MAX_TMDB_PAGE = 500;

const TV_TYPE_ALIASES = new Map([
  ["mini series", { value: "2", label: "Mini-Series" }],
  ["miniseries", { value: "2", label: "Mini-Series" }],
  ["limited series", { value: "2", label: "Limited Series" }],
  ["limited tv series", { value: "2", label: "Limited Series" }],
  ["documentary series", { value: "0", label: "Documentary Series" }],
  ["docuseries", { value: "0", label: "Documentary Series" }],
  ["news", { value: "1", label: "News" }],
  ["reality", { value: "3", label: "Reality" }],
  ["reality series", { value: "3", label: "Reality" }],
  ["scripted", { value: "4", label: "Scripted" }],
  ["scripted series", { value: "4", label: "Scripted" }],
  ["talk show", { value: "5", label: "Talk Show" }],
  ["talkshow", { value: "5", label: "Talk Show" }],
  ["video", { value: "6", label: "Video" }],
]);

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

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rankName(name, query) {
  const candidate = normalizeText(name);
  const wanted = normalizeText(query);
  if (!candidate || !wanted) return 0;
  if (candidate === wanted) return 100;
  if (candidate.startsWith(wanted)) return 70;
  if (candidate.includes(wanted)) return 45;
  return 0;
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

async function getGenres() {
  const data = await tmdbFetch("/genre/tv/list");
  return Array.isArray(data?.genres) ? data.genres : [];
}

function resolveType(query) {
  return TV_TYPE_ALIASES.get(normalizeText(query)) || null;
}

async function resolveGenre(query) {
  const genres = await getGenres();
  const ranked = genres
    .map((genre) => ({ genre, score: rankName(genre?.name, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.genre || null;
}

function normalizeResult(item, label, genreMap) {
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
    genres: (item?.genre_ids || [])
      .map((id) => genreMap.get(Number(id)))
      .filter(Boolean),
    network: null,
    platform: null,
    studio: null,
    studios: [],
    search_category: label,
    rating_average: item?.vote_average || null,
    rating_count: item?.vote_count || 0,
    popularity: item?.popularity || 0,
    original_language: item?.original_language || null,
    source: "tmdb",
  };
}

async function handleRequest(event) {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return response(405, { message: "Method not allowed" });
  }

  try {
    const query = String(event.queryStringParameters?.q || "").trim();
    const requestedPage = Number(event.queryStringParameters?.page || 1);
    const page = Math.min(
      MAX_TMDB_PAGE,
      Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1)
    );

    if (!query) {
      return response(400, { message: "Enter a genre or TV type." });
    }

    const [genres, typeMatch, genreMatch] = await Promise.all([
      getGenres(),
      Promise.resolve(resolveType(query)),
      resolveGenre(query),
    ]);

    if (!typeMatch && !genreMatch) {
      return response(404, {
        message: `No TV genre or series type matched “${query}”.`,
      });
    }

    const discoverParams = {
      page: String(page),
      sort_by: "first_air_date.desc",
      include_adult: "false",
      include_null_first_air_dates: "false",
    };

    let matched;
    let matchType;

    if (typeMatch) {
      discoverParams.with_type = typeMatch.value;
      matched = typeMatch.label;
      matchType = "tv-type";
    } else {
      discoverParams.with_genres = String(genreMatch.id);
      matched = genreMatch.name;
      matchType = "genre";
    }

    const discovered = await tmdbFetch("/discover/tv", discoverParams);
    const genreMap = new Map(genres.map((genre) => [Number(genre.id), genre.name]));
    const totalPages = Math.min(
      MAX_TMDB_PAGE,
      Math.max(1, Number(discovered?.total_pages || 1))
    );
    const results = (Array.isArray(discovered?.results) ? discovered.results : [])
      .map((item) => normalizeResult(item, matched, genreMap))
      .filter((item) => item.tmdb_id);

    return response(200, {
      mode: "genre",
      query,
      matched,
      page,
      totalPages,
      totalResults: Number(discovered?.total_results || results.length),
      hasMore: page < totalPages,
      results,
      matchType,
    });
  } catch (error) {
    console.error("genreSearchShows error", error);
    return response(500, {
      message: error?.message || "Genre search failed.",
    });
  }
}

export const handler = withPublicCache(handleRequest, {"ttl":300,"stale":60,"query":["q","page"]});
