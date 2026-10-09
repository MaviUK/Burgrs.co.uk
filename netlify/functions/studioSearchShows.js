import { withPublicCache } from "./_publicDataCache.js";
const TVDB_BASE = "https://api4.thetvdb.com/v4";
const PAGE_SIZE = 20;
const MAX_RESULTS = 5000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CATALOGUE_BUCKETS = [
  "a",
  "e",
  "i",
  "o",
  "u",
  "s",
  "t",
  "r",
  "n",
  "l",
  "m",
  "c",
  "p",
  "d",
  "b",
  "g",
];

let cachedToken = null;
let tokenExpiresAt = 0;
const catalogueCache = new Map();

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
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

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

  cachedToken = token;
  tokenExpiresAt = Date.now() + 27 * 24 * 60 * 60 * 1000;
  return token;
}

function normalizeGenres(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((genre) => {
      if (typeof genre === "string") return genre;
      return genre?.name || genre?.genre || genre?.value || null;
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

function normalizeResult(item, studioName) {
  const tvdbId = Number(item?.tvdb_id || item?.id);
  const image = item?.image_url || item?.image || item?.thumbnail || null;
  const firstAired =
    item?.first_air_time || item?.firstAired || item?.first_air_date || null;

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
    rating_average:
      Number(item?.score || item?.rating || item?.siteRating) || null,
    rating_count: Number(item?.rating_count || item?.siteRatingCount) || 0,
    popularity: Number(item?.score || 0),
    original_language: item?.primary_language || item?.language || null,
    source: "tvdb",
  };
}

function parseTotalResults(data) {
  const links = data?.links || {};
  const totalCandidates = [
    links?.total_items,
    links?.totalItems,
    links?.total,
    data?.total_items,
    data?.totalItems,
    data?.total,
  ];

  return (
    totalCandidates
      .map(Number)
      .find((value) => Number.isFinite(value) && value >= 0) || 0
  );
}

function parseSearchResponse(data, studioName) {
  const rawResults = Array.isArray(data?.data) ? data.data : [];
  const results = rawResults
    .filter((item) => {
      const type = normalizeText(item?.type);
      return !type || type === "series";
    })
    .map((item) => normalizeResult(item, studioName))
    .filter((item) => item.tvdb_id);

  const links = data?.links || {};
  const totalResults = parseTotalResults(data);

  return {
    results,
    totalResults,
    hasMore: Boolean(links?.next || links?.nextPage),
  };
}

async function requestTvdbSearch(token, paramsObject, studioName) {
  const params = new URLSearchParams();
  Object.entries(paramsObject).forEach(([key, value]) => {
    if (value !== null && value !== undefined) params.set(key, String(value));
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
    const error = new Error(data?.message || "TVDB studio search failed");
    error.statusCode = res.status;
    throw error;
  }

  return parseSearchResponse(data, studioName);
}

async function tryDirectCatalogueSearch(token, studioName, page) {
  const offset = Math.max(0, (page - 1) * PAGE_SIZE);
  const candidates = [
    { query: " ", company: studioName },
    { query: "*", company: studioName },
    { query: " ", network: studioName },
    { query: "*", network: studioName },
  ];

  let bestResult = null;

  for (const candidate of candidates) {
    try {
      const result = await requestTvdbSearch(
        token,
        {
          ...candidate,
          type: "series",
          offset,
          limit: PAGE_SIZE,
          language: "eng",
          meta: "translations",
        },
        studioName
      );

      if (
        !bestResult ||
        result.totalResults > bestResult.totalResults ||
        result.results.length > bestResult.results.length
      ) {
        bestResult = result;
      }

      if (
        result.results.length >= PAGE_SIZE ||
        result.totalResults > PAGE_SIZE ||
        result.hasMore
      ) {
        return {
          ...result,
          page,
          direct: true,
        };
      }
    } catch (error) {
      console.warn("TVDB direct catalogue attempt failed:", error.message);
    }
  }

  return bestResult
    ? {
        ...bestResult,
        page,
        direct: true,
      }
    : null;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runWorker)
  );
  return results;
}

async function buildCatalogueFromBuckets(token, studioName) {
  const cacheKey = normalizeText(studioName);
  const cached = catalogueCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.results;
  }

  const bucketResults = await mapWithConcurrency(
    CATALOGUE_BUCKETS,
    4,
    async (bucket) => {
      try {
        const result = await requestTvdbSearch(
          token,
          {
            query: bucket,
            company: studioName,
            type: "series",
            offset: 0,
            limit: 1000,
            language: "eng",
            meta: "translations",
          },
          studioName
        );
        return result.results;
      } catch (error) {
        console.warn(`TVDB catalogue bucket ${bucket} failed:`, error.message);
        return [];
      }
    }
  );

  const unique = new Map();
  bucketResults.flat().forEach((item) => {
    if (!item?.tvdb_id) return;
    const existing = unique.get(String(item.tvdb_id));
    if (!existing || Number(item.popularity || 0) > Number(existing.popularity || 0)) {
      unique.set(String(item.tvdb_id), item);
    }
  });

  const results = Array.from(unique.values())
    .sort(
      (a, b) =>
        Number(b.popularity || 0) - Number(a.popularity || 0) ||
        String(a.name || "").localeCompare(String(b.name || ""))
    )
    .slice(0, MAX_RESULTS);

  catalogueCache.set(cacheKey, {
    createdAt: Date.now(),
    results,
  });

  return results;
}

async function getStudioCatalogue(token, studioName, page) {
  const direct = await tryDirectCatalogueSearch(token, studioName, page);

  if (
    direct &&
    (direct.results.length > 1 || direct.totalResults > 1 || direct.hasMore)
  ) {
    const totalResults = direct.totalResults ||
      (direct.hasMore ? page * PAGE_SIZE + 1 : direct.results.length);

    return {
      results: direct.results,
      totalResults,
      hasMore:
        direct.hasMore ||
        (direct.results.length === PAGE_SIZE &&
          (direct.totalResults === 0 || page * PAGE_SIZE < direct.totalResults)),
      totalPages: direct.totalResults
        ? Math.ceil(Math.min(direct.totalResults, MAX_RESULTS) / PAGE_SIZE)
        : page + (direct.hasMore ? 1 : 0),
      matchType: "tvdb-company-direct",
    };
  }

  const catalogue = await buildCatalogueFromBuckets(token, studioName);
  const offset = Math.max(0, (page - 1) * PAGE_SIZE);
  const results = catalogue.slice(offset, offset + PAGE_SIZE);

  return {
    results,
    totalResults: catalogue.length,
    hasMore: offset + results.length < catalogue.length,
    totalPages: Math.max(1, Math.ceil(catalogue.length / PAGE_SIZE)),
    matchType: "tvdb-company-catalogue",
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
    const requestedPage = Number(event.queryStringParameters?.page || 1);
    const page = Math.max(
      1,
      Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1
    );

    if (!query) {
      return response(400, { message: "Enter a studio or network name." });
    }

    const token = await getToken();
    const studioSearch = await getStudioCatalogue(token, query, page);

    if (!studioSearch.results.length && page === 1) {
      return response(404, {
        message: `No studio, network or production company matched “${query}”.`,
      });
    }

    return response(200, {
      mode: "studio",
      query,
      matched: query,
      page,
      totalPages: studioSearch.totalPages,
      totalResults: studioSearch.totalResults,
      hasMore: studioSearch.hasMore,
      results: studioSearch.results,
      matchType: studioSearch.matchType,
    });
  } catch (error) {
    console.error("studioSearchShows error", error);
    return response(500, {
      message: error?.message || "Studio search failed.",
    });
  }
}

export const handler = withPublicCache(handleRequest, {"ttl":300,"stale":60,"query":["q","query","page"]});
