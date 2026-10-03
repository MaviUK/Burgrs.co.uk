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
      "Cache-Control": "no-store, no-cache, must-revalidate",
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

async function resolveCompany(query) {
  const data = await tmdbFetch("/search/company", {
    query,
    page: "1",
  });
  const companies = Array.isArray(data?.results) ? data.results : [];
  const match = bestMatch(companies, query);
  return match?.score > 0 ? match.item : null;
}

function readFilter(params, key) {
  return String(params?.[key] || "").trim();
}

function normalizeSort(value) {
  const sort = String(value || "default").trim().toLowerCase();
  return ["default", "highest-rated", "lowest-rated", "most-popular", "newest", "oldest", "a-z"].includes(sort)
    ? sort
    : "default";
}

function tmdbDiscoverSort(sort) {
  const map = {
    "highest-rated": "vote_average.desc",
    "lowest-rated": "vote_average.asc",
    "most-popular": "popularity.desc",
    newest: "first_air_date.desc",
    oldest: "first_air_date.asc",
    "a-z": "name.asc",
  };
  return map[sort] || "popularity.desc";
}

function sortTitleResults(items, sort) {
  const results = [...(items || [])];

  if (sort === "highest-rated") {
    return results.sort((a, b) => {
      const ratingDiff = Number(b?.vote_average || 0) - Number(a?.vote_average || 0);
      if (ratingDiff) return ratingDiff;
      return Number(b?.vote_count || 0) - Number(a?.vote_count || 0);
    });
  }

  if (sort === "lowest-rated") {
    return results.sort((a, b) => {
      const aRating = Number(a?.vote_average || 0);
      const bRating = Number(b?.vote_average || 0);

      if (aRating <= 0 && bRating <= 0) return 0;
      if (aRating <= 0) return 1;
      if (bRating <= 0) return -1;

      const ratingDiff = aRating - bRating;
      if (ratingDiff) return ratingDiff;
      return Number(b?.vote_count || 0) - Number(a?.vote_count || 0);
    });
  }

  if (sort === "most-popular") {
    return results.sort((a, b) => Number(b?.popularity || 0) - Number(a?.popularity || 0));
  }

  if (sort === "newest" || sort === "oldest") {
    const direction = sort === "newest" ? -1 : 1;
    return results.sort((a, b) => {
      const aDate = String(a?.first_air_date || "");
      const bDate = String(b?.first_air_date || "");
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return aDate.localeCompare(bDate) * direction;
    });
  }

  if (sort === "a-z") {
    return results.sort((a, b) =>
      String(a?.name || a?.original_name || "").localeCompare(
        String(b?.name || b?.original_name || ""),
        "en",
        { sensitivity: "base" }
      )
    );
  }

  return results;
}

function getProviderItems(regionData) {
  return [
    ...(regionData?.flatrate || []),
    ...(regionData?.free || []),
    ...(regionData?.ads || []),
    ...(regionData?.rent || []),
    ...(regionData?.buy || []),
  ];
}

function isWithinYearRange(firstAirDate, yearRange) {
  if (!yearRange) return true;
  const year = Number(String(firstAirDate || "").slice(0, 4));
  return Number.isFinite(year) && year >= yearRange.startYear && year <= yearRange.endYear;
}

function normalizeCombinedResult(item, context, genreMap) {
  const result = normalizeTmdbResult(item, context, genreMap);
  return {
    ...result,
    studio: context.studioName || null,
    studios: context.studioName ? [context.studioName] : [],
  };
}

function uniqueNames(items, key = "name", limit = 3) {
  const seen = new Set();
  const names = [];

  for (const item of items || []) {
    const name = String(item?.[key] || "").trim();
    const normalized = name.toLowerCase();
    if (!name || seen.has(normalized)) continue;
    seen.add(normalized);
    names.push(name);
    if (names.length >= limit) break;
  }

  return names;
}

function getStreamingProviders(regionData) {
  return uniqueNames(
    [
      ...(regionData?.flatrate || []),
      ...(regionData?.free || []),
      ...(regionData?.ads || []),
    ],
    "provider_name",
    3
  );
}

async function enrichSearchResults(results, region) {
  return Promise.all(
    (results || []).map(async (result) => {
      if (!result?.tmdb_id) return result;

      try {
        const detail = await tmdbFetch(`/tv/${result.tmdb_id}`, {
          append_to_response: "watch/providers",
        });

        const studios = uniqueNames(detail?.production_companies, "name", 2);
        const regionData = detail?.["watch/providers"]?.results?.[region] || {};
        const providers = getStreamingProviders(regionData);

        return {
          ...result,
          studio: studios[0] || result.studio || null,
          studios: studios.length ? studios : result.studios || [],
          platform: providers.length
            ? providers.join(", ")
            : result.platform || null,
          network: providers[0] || result.network || null,
          total_seasons:
            Number(detail?.number_of_seasons || 0) || result.total_seasons || null,
          total_episodes:
            Number(detail?.number_of_episodes || 0) || result.total_episodes || null,
        };
      } catch (detailError) {
        console.warn("Search result enrichment failed", result?.tmdb_id, detailError);
        return result;
      }
    })
  );
}

export async function handler(event) {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return response(405, { message: "Method not allowed" });
  }

  try {
    const params = event.queryStringParameters || {};
    const mode = String(params.mode || "").trim().toLowerCase();
    const query = String(params.q || "").trim();
    const region = String(params.region || DEFAULT_REGION).trim().toUpperCase();
    const requestedPage = Number(params.page || 1);
    const sort = normalizeSort(params.sort);
    const page = Math.max(
      1,
      Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1
    );

    const filters = {
      title: readFilter(params, "title"),
      genre: readFilter(params, "genre"),
      year: readFilter(params, "year"),
      platform: readFilter(params, "platform"),
      studio: readFilter(params, "studio"),
    };

    if (
      !Object.values(filters).some(Boolean) &&
      query &&
      ["title", "genre", "year", "platform", "studio"].includes(mode)
    ) {
      filters[mode] = query;
    }

    if (!Object.values(filters).some(Boolean)) {
      return response(400, {
        message: "Add at least one Title, Genre, Year, Platform or Studio filter.",
      });
    }

    const genres = await getGenres();
    const genreMap = new Map(genres.map((genre) => [Number(genre.id), genre.name]));
    const context = {};

    let genre = null;
    if (filters.genre) {
      genre = await resolveGenre(filters.genre);
      if (!genre) {
        return response(404, { message: `No TV genre matched “${filters.genre}”.` });
      }
      context.genreName = genre.name;
    }

    let provider = null;
    if (filters.platform) {
      provider = await resolveProvider(filters.platform, region);
      if (!provider) {
        return response(404, {
          message: `No streaming platform matched “${filters.platform}” in ${regionLabel(region)}.`,
        });
      }
      context.platformName = provider.provider_name;
    }

    let yearRange = null;
    if (filters.year) {
      yearRange = parseYearQuery(filters.year);
      if (!yearRange) {
        return response(400, {
          message: "Enter a four-digit year such as 1973, or a decade such as 1990s.",
        });
      }
      context.yearLabel = yearRange.label;
    }

    let company = null;
    if (filters.studio) {
      company = await resolveCompany(filters.studio);
      if (!company) {
        return response(404, {
          message: `No studio or production company matched “${filters.studio}”.`,
        });
      }
      context.studioName = company.name;
    }

    const appliedFilters = {
      ...(filters.title ? { title: filters.title } : {}),
      ...(genre ? { genre: genre.name } : {}),
      ...(yearRange ? { year: yearRange.label } : {}),
      ...(provider ? { platform: provider.provider_name } : {}),
      ...(company ? { studio: company.name } : {}),
    };

    if (filters.title) {
      const requestedTmdbPage = Math.min(MAX_TMDB_PAGE, page);
      const searched = await tmdbFetch("/search/tv", {
        query: filters.title,
        page: String(requestedTmdbPage),
        include_adult: "false",
      });

      const rawTotalPages = Math.min(
        MAX_TMDB_PAGE,
        Math.max(1, Number(searched?.total_pages || 1))
      );
      const globalSortPageLimit = provider || company ? 5 : 25;
      const canGloballySort =
        sort !== "default" && rawTotalPages <= globalSortPageLimit;

      let rawResults = Array.isArray(searched?.results) ? searched.results : [];

      if (canGloballySort && rawTotalPages > 1) {
        const otherPages = Array.from(
          { length: rawTotalPages },
          (_, index) => index + 1
        ).filter((pageNumber) => pageNumber !== requestedTmdbPage);

        const pageResponses = await Promise.all(
          otherPages.map((pageNumber) =>
            tmdbFetch("/search/tv", {
              query: filters.title,
              page: String(pageNumber),
              include_adult: "false",
            })
          )
        );

        rawResults = [
          ...rawResults,
          ...pageResponses.flatMap((result) =>
            Array.isArray(result?.results) ? result.results : []
          ),
        ];

        const uniqueResults = new Map();
        rawResults.forEach((item) => {
          if (item?.id) uniqueResults.set(Number(item.id), item);
        });
        rawResults = Array.from(uniqueResults.values());
      }

      if (genre) {
        rawResults = rawResults.filter((item) =>
          (item?.genre_ids || []).map(Number).includes(Number(genre.id))
        );
      }

      if (yearRange) {
        rawResults = rawResults.filter((item) =>
          isWithinYearRange(item?.first_air_date, yearRange)
        );
      }

      if (provider || company) {
        const checked = await Promise.all(
          rawResults.map(async (item) => {
            try {
              const detail = await tmdbFetch(`/tv/${item.id}`, {
                append_to_response: "watch/providers",
              });

              if (
                company &&
                !(detail?.production_companies || []).some(
                  (entry) => Number(entry?.id) === Number(company.id)
                )
              ) {
                return null;
              }

              if (provider) {
                const regionData = detail?.["watch/providers"]?.results?.[region] || {};
                const available = getProviderItems(regionData).some(
                  (entry) => Number(entry?.provider_id) === Number(provider.provider_id)
                );
                if (!available) return null;
              }

              return item;
            } catch (detailError) {
              console.warn("Combined title filter detail lookup failed", item?.id, detailError);
              return null;
            }
          })
        );
        rawResults = checked.filter(Boolean);
      }

      rawResults = sortTitleResults(rawResults, sort);

      const hasRefinements = Boolean(
        filters.genre || filters.year || filters.platform || filters.studio
      );

      if (canGloballySort) {
        const totalFilteredResults = rawResults.length;
        const totalPages = Math.max(1, Math.ceil(totalFilteredResults / PAGE_SIZE));
        const startIndex = (page - 1) * PAGE_SIZE;
        const pagedRawResults = rawResults.slice(
          startIndex,
          startIndex + PAGE_SIZE
        );
        let results = pagedRawResults
          .map((item) => normalizeCombinedResult(item, context, genreMap))
          .filter((item) => item.tmdb_id);
        results = await enrichSearchResults(results, region);

        return response(200, {
          mode: "combined",
          query: filters.title,
          matched: Object.values(appliedFilters).join(" + "),
          appliedFilters,
          page,
          totalPages,
          totalResults: totalFilteredResults,
          hasMore: page < totalPages,
          results,
          matchType: "combined-title-global-sort",
          sort,
        });
      }

      const totalPages = rawTotalPages;
      let results = rawResults
        .map((item) => normalizeCombinedResult(item, context, genreMap))
        .filter((item) => item.tmdb_id);
      results = await enrichSearchResults(results, region);

      return response(200, {
        mode: "combined",
        query: filters.title,
        matched: Object.values(appliedFilters).join(" + "),
        appliedFilters,
        page,
        totalPages,
        totalResults: hasRefinements
          ? null
          : Number(searched?.total_results || results.length),
        hasMore: page < totalPages,
        results,
        matchType: "combined-title",
        sort,
      });
    }

    const discoverParams = {
      page: String(Math.min(MAX_TMDB_PAGE, page)),
      sort_by: tmdbDiscoverSort(sort),
      include_adult: "false",
      include_null_first_air_dates: "false",
    };

    if (sort === "lowest-rated") {
      discoverParams["vote_count.gte"] = "1";
    }

    if (genre) {
      discoverParams.with_genres = String(genre.id);
    }

    if (provider) {
      discoverParams.with_watch_providers = String(provider.provider_id);
      discoverParams.watch_region = region;
    }

    if (yearRange) {
      discoverParams["first_air_date.gte"] = `${yearRange.startYear}-01-01`;
      discoverParams["first_air_date.lte"] = `${yearRange.endYear}-12-31`;
    }

    if (company) {
      discoverParams.with_companies = String(company.id);
    }

    const discovered = await tmdbFetch("/discover/tv", discoverParams);
    const rawTotalPages = Number(discovered?.total_pages || 1);
    const totalPages = Math.min(MAX_TMDB_PAGE, Math.max(1, rawTotalPages));
    let results = (Array.isArray(discovered?.results) ? discovered.results : [])
      .map((item) => normalizeCombinedResult(item, context, genreMap))
      .filter((item) => item.tmdb_id);
    results = await enrichSearchResults(results, region);

    return response(200, {
      mode: "combined",
      query: Object.values(filters).filter(Boolean).join(" + "),
      matched: Object.values(appliedFilters).join(" + "),
      appliedFilters,
      page,
      totalPages,
      totalResults: Number(discovered?.total_results || results.length),
      hasMore: page < totalPages,
      results,
      matchType: "combined-discover",
      sort,
    });
  } catch (error) {
    console.error("advancedSearchShows error", error);
    return response(500, {
      message: error?.message || "Advanced show search failed.",
    });
  }
}
