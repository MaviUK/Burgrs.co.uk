import { withPublicCache } from "./_publicDataCache.js";
import { handler as legacyStudioSearch } from "./studioSearchShows.js";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";
const DEFAULT_REGION = "GB";
const MAX_TMDB_PAGE = 500;

const NETWORK_ALIASES = new Map([
  ["peacock", { id: 3353, name: "Peacock" }],
  ["peacock tv", { id: 3353, name: "Peacock" }],
]);

const PROVIDER_ALIASES = new Map([
  ["netflix", ["Netflix"]],
  ["disney", ["Disney Plus", "Disney+"]],
  ["disney plus", ["Disney Plus", "Disney+"]],
  ["disney+", ["Disney Plus", "Disney+"]],
  ["prime", ["Amazon Prime Video", "Prime Video"]],
  ["prime video", ["Amazon Prime Video", "Prime Video"]],
  ["amazon prime", ["Amazon Prime Video", "Prime Video"]],
  ["amazon prime video", ["Amazon Prime Video", "Prime Video"]],
  ["apple", ["Apple TV Plus", "Apple TV+"]],
  ["apple tv", ["Apple TV Plus", "Apple TV+"]],
  ["apple tv plus", ["Apple TV Plus", "Apple TV+"]],
  ["apple tv+", ["Apple TV Plus", "Apple TV+"]],
  ["paramount", ["Paramount Plus", "Paramount+"]],
  ["paramount plus", ["Paramount Plus", "Paramount+"]],
  ["paramount+", ["Paramount Plus", "Paramount+"]],
  ["max", ["Max", "HBO Max"]],
  ["hbo max", ["Max", "HBO Max"]],
  ["bbc iplayer", ["BBC iPlayer"]],
  ["iplayer", ["BBC iPlayer"]],
  ["itvx", ["ITVX"]],
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
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function rankName(name, query) {
  const candidate = normalizeText(name);
  const wanted = normalizeText(query);

  if (!candidate || !wanted) return 0;
  if (candidate === wanted) return 100;
  if (candidate.startsWith(`${wanted} `)) return 80;
  if (candidate.startsWith(wanted)) return 70;
  if (candidate.includes(wanted)) return 45;
  return 0;
}

async function resolveCompany(query) {
  const data = await tmdbFetch("/search/company", {
    query,
    page: "1",
  });

  const ranked = (Array.isArray(data?.results) ? data.results : [])
    .map((company) => ({ company, score: rankName(company?.name, query) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.company?.id || 0) - Number(a.company?.id || 0)
    );

  return ranked[0]?.company || null;
}

async function resolveProvider(query, region) {
  const aliases = PROVIDER_ALIASES.get(normalizeText(query));
  if (!aliases) return null;

  const data = await tmdbFetch("/watch/providers/tv", {
    watch_region: region,
  });
  const providers = Array.isArray(data?.results) ? data.results : [];

  let best = null;
  for (const alias of aliases) {
    for (const provider of providers) {
      const score = rankName(provider?.provider_name, alias);
      if (!best || score > best.score) best = { provider, score };
    }
  }

  return best?.score > 0 ? best.provider : null;
}

async function getGenreMap() {
  const data = await tmdbFetch("/genre/tv/list");
  return new Map(
    (Array.isArray(data?.genres) ? data.genres : []).map((genre) => [
      Number(genre.id),
      genre.name,
    ])
  );
}

function normalizeResult(item, label, genreMap, matchType) {
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
    platform: matchType === "provider" ? label : null,
    studio: label,
    studios: [label],
    rating_average: item?.vote_average || null,
    rating_count: item?.vote_count || 0,
    popularity: item?.popularity || 0,
    original_language: item?.original_language || null,
    source: "tmdb",
  };
}

async function searchTmdbCatalogue(query, page, region) {
  const normalizedQuery = normalizeText(query);
  const network = NETWORK_ALIASES.get(normalizedQuery) || null;
  const provider = network ? null : await resolveProvider(query, region);
  const company = network || provider ? null : await resolveCompany(query);

  if (!network && !provider && !company) return null;

  const params = {
    page: String(Math.min(MAX_TMDB_PAGE, page)),
    sort_by: "popularity.desc",
    include_adult: "false",
    include_null_first_air_dates: "false",
  };

  let label = query;
  let matchType = "company";

  if (network) {
    params.with_networks = String(network.id);
    label = network.name;
    matchType = "network";
  } else if (provider) {
    params.with_watch_providers = String(provider.provider_id);
    params.watch_region = region;
    label = provider.provider_name;
    matchType = "provider";
  } else {
    params.with_companies = String(company.id);
    label = company.name;
  }

  const [discovered, genreMap] = await Promise.all([
    tmdbFetch("/discover/tv", params),
    getGenreMap(),
  ]);

  const results = (Array.isArray(discovered?.results) ? discovered.results : [])
    .map((item) => normalizeResult(item, label, genreMap, matchType))
    .filter((item) => item.tmdb_id);
  const totalPages = Math.min(
    MAX_TMDB_PAGE,
    Math.max(1, Number(discovered?.total_pages || 1))
  );

  return {
    matched: label,
    results,
    totalResults: Number(discovered?.total_results || results.length),
    totalPages,
    hasMore: page < totalPages,
    matchType: `tmdb-${matchType}`,
  };
}

async function handleRequest(event) {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return response(405, { message: "Method not allowed" });
  }

  try {
    const query = String(
      event.queryStringParameters?.q ||
        event.queryStringParameters?.query ||
        ""
    ).trim();
    const region = String(
      event.queryStringParameters?.region || DEFAULT_REGION
    )
      .trim()
      .toUpperCase();
    const requestedPage = Number(event.queryStringParameters?.page || 1);
    const page = Math.max(
      1,
      Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1
    );

    if (!query) {
      return response(400, { message: "Enter a studio or network name." });
    }

    const catalogue = await searchTmdbCatalogue(query, page, region);

    if (catalogue?.results?.length) {
      return response(200, {
        mode: "studio",
        query,
        matched: catalogue.matched,
        page,
        totalPages: catalogue.totalPages,
        totalResults: catalogue.totalResults,
        hasMore: catalogue.hasMore,
        results: catalogue.results,
        matchType: catalogue.matchType,
      });
    }

    return legacyStudioSearch(event);
  } catch (error) {
    console.error("studioCatalogueSearch error", error);

    try {
      return await legacyStudioSearch(event);
    } catch {
      return response(500, {
        message: error?.message || "Studio search failed.",
      });
    }
  }
}

export const handler = withPublicCache(handleRequest, {"ttl":300,"stale":60,"query":["q","query","region","page"]});
