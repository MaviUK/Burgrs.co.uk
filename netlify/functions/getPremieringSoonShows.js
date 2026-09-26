import { persistDiscoveryShows } from "./_persistDiscoveryShows.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TVDB_BASE_URL = "https://api4.thetvdb.com/v4";
const MAX_DISCOVER_PAGES = 20;
const MAX_SHOWS = 36;
const TVDB_MARKETS = ["usa", "gbr", "can", "aus", "irl", "nzl"];

let cachedTvdbToken = null;
let cachedTvdbTokenExpiresAt = 0;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300, s-maxage=900",
      ...CORS_HEADERS,
    },
    body: JSON.stringify(body),
  };
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

async function readJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getTmdbHeaders() {
  const headers = { accept: "application/json" };
  if (process.env.TMDB_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${process.env.TMDB_BEARER_TOKEN}`;
  }
  return headers;
}

function withTmdbApiKey(url) {
  if (!process.env.TMDB_API_KEY) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("api_key", process.env.TMDB_API_KEY);
  return parsed.toString();
}

async function fetchTmdb(url) {
  const response = await fetch(withTmdbApiKey(url), {
    headers: getTmdbHeaders(),
  });
  const payload = await readJsonSafe(response);

  if (!response.ok) {
    throw new Error(
      payload?.status_message || `TMDB request failed with ${response.status}`
    );
  }

  return payload;
}

async function getTvdbToken() {
  if (cachedTvdbToken && Date.now() < cachedTvdbTokenExpiresAt) {
    return cachedTvdbToken;
  }

  if (!process.env.TVDB_API_KEY) {
    throw new Error("Missing TVDB_API_KEY");
  }

  const response = await fetch(`${TVDB_BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: process.env.TVDB_API_KEY,
      ...(process.env.TVDB_PIN ? { pin: process.env.TVDB_PIN } : {}),
    }),
  });
  const payload = await readJsonSafe(response);

  if (!response.ok || !payload?.data?.token) {
    throw new Error(payload?.message || "TVDB login failed");
  }

  cachedTvdbToken = payload.data.token;
  cachedTvdbTokenExpiresAt = Date.now() + 27 * 24 * 60 * 60 * 1000;
  return cachedTvdbToken;
}

async function fetchTvdb(path) {
  const token = await getTvdbToken();
  const response = await fetch(`${TVDB_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "eng",
    },
  });
  const payload = await readJsonSafe(response);

  if (!response.ok) {
    throw new Error(
      payload?.message || `TVDB request failed with ${response.status}`
    );
  }

  return payload;
}

function buildTmdbDiscoverUrl({ from, to, page }) {
  const params = new URLSearchParams({
    language: "en-GB",
    sort_by: "first_air_date.asc",
    first_air_date_gte: from,
    first_air_date_lte: to,
    include_adult: "false",
    include_null_first_air_dates: "false",
    page: String(page),
  });

  return `${TMDB_BASE_URL}/discover/tv?${params.toString()}`;
}

async function fetchTmdbS01E01(tmdbId) {
  const season = await fetchTmdb(
    `${TMDB_BASE_URL}/tv/${encodeURIComponent(tmdbId)}/season/1?language=en-GB`
  );

  return (season?.episodes || []).find(
    (episode) => Number(episode?.episode_number) === 1
  );
}

async function fetchTmdbExternalIds(tmdbId) {
  return fetchTmdb(
    `${TMDB_BASE_URL}/tv/${encodeURIComponent(tmdbId)}/external_ids`
  );
}

function normalizeTmdbShow(show, episode) {
  if (!show?.id || !show?.poster_path || !episode?.air_date) return null;

  return {
    id: show.id,
    tmdb_id: show.id,
    tvdb_id: null,
    name: show.name || show.original_name || "Unknown title",
    image: `https://image.tmdb.org/t/p/w500${show.poster_path}`,
    poster_url: `https://image.tmdb.org/t/p/w500${show.poster_path}`,
    overview: show.overview || "",
    first_air_date: episode.air_date,
    premiere_date: episode.air_date,
    premiere_season_number: 1,
    premiere_episode_number: 1,
    premiere_episode_name: episode.name || "Episode 1",
    popularity: Number(show.popularity || 0),
    vote_average: Number(show.vote_average || 0) || null,
    vote_count: Number(show.vote_count || 0) || null,
    source: "tmdb",
  };
}

function getTvdbSeriesId(show) {
  return Number(show?.id || show?.tvdb_id || show?.tvdbId || 0) || null;
}

function getTvdbFirstAired(show) {
  return show?.firstAired || show?.first_aired || show?.firstAirTime || null;
}

async function fetchTvdbCandidates(from, to) {
  const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
  const requests = [];

  for (const country of TVDB_MARKETS) {
    for (const year of years) {
      const params = new URLSearchParams({
        country,
        lang: "eng",
        year: String(year),
        sort: "firstAired",
        sortType: "asc",
      });

      requests.push(
        fetchTvdb(`/series/filter?${params.toString()}`).catch((error) => {
          console.warn(`TVDB series filter failed for ${country}/${year}`, error);
          return { data: [] };
        })
      );
    }
  }

  const payloads = await Promise.all(requests);
  const candidates = new Map();

  payloads.forEach((payload) => {
    (Array.isArray(payload?.data) ? payload.data : []).forEach((show) => {
      const id = getTvdbSeriesId(show);
      const firstAired = getTvdbFirstAired(show);
      if (!id || !firstAired || firstAired < from || firstAired > to) return;
      candidates.set(String(id), show);
    });
  });

  return [...candidates.values()];
}

async function verifyTvdbS01E01(show, from, to) {
  const tvdbId = getTvdbSeriesId(show);
  if (!tvdbId) return null;

  const params = new URLSearchParams({
    page: "0",
    season: "1",
    episodeNumber: "1",
    language: "eng",
    meta: "translations",
  });

  const payload = await fetchTvdb(
    `/series/${encodeURIComponent(tvdbId)}/episodes/default?${params.toString()}`
  );
  const episode = (payload?.data?.episodes || []).find(
    (item) =>
      Number(item?.seasonNumber ?? item?.season_number) === 1 &&
      Number(item?.number ?? item?.episodeNumber ?? item?.episode_number) === 1
  );
  const airDate = episode?.aired || episode?.airDate || episode?.aired_date || null;

  if (!airDate || airDate < from || airDate > to) return null;

  const poster = show?.image || show?.poster || show?.thumbnail || null;
  if (!poster) return null;

  return {
    id: tvdbId,
    tvdb_id: tvdbId,
    tmdb_id: null,
    name: show?.name || show?.seriesName || "Unknown title",
    image: poster,
    poster_url: poster,
    overview: show?.overview || "",
    first_air_date: airDate,
    premiere_date: airDate,
    premiere_season_number: 1,
    premiere_episode_number: 1,
    premiere_episode_name: episode?.name || "Episode 1",
    popularity: Number(show?.score || 0),
    source: "tvdb",
  };
}

async function mapInBatches(items, batchSize, mapper) {
  const results = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    results.push(...(await Promise.all(batch.map(mapper))));
  }

  return results;
}

async function loadTmdbPremieres(from, to) {
  if (!process.env.TMDB_BEARER_TOKEN && !process.env.TMDB_API_KEY) return [];

  const firstPage = await fetchTmdb(
    buildTmdbDiscoverUrl({ from, to, page: 1 })
  );
  const totalPages = Math.max(
    1,
    Math.min(Number(firstPage?.total_pages || 1), MAX_DISCOVER_PAGES)
  );
  const otherPages =
    totalPages > 1
      ? await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, index) =>
            fetchTmdb(buildTmdbDiscoverUrl({ from, to, page: index + 2 }))
          )
        )
      : [];
  const candidates = new Map();

  [firstPage, ...otherPages].forEach((payload) => {
    (payload?.results || []).forEach((show) => {
      if (show?.id && show?.poster_path) candidates.set(String(show.id), show);
    });
  });

  return mapInBatches([...candidates.values()], 8, async (show) => {
    try {
      const episode = await fetchTmdbS01E01(show.id);
      if (!episode?.air_date || episode.air_date < from || episode.air_date > to) {
        return null;
      }
      const normalized = normalizeTmdbShow(show, episode);
      if (!normalized) return null;

      try {
        const externalIds = await fetchTmdbExternalIds(show.id);
        normalized.tvdb_id = Number(externalIds?.tvdb_id || 0) || null;
      } catch (externalIdError) {
        console.warn(`TMDB external ID lookup failed for ${show.id}`, externalIdError);
      }

      return normalized;
    } catch (error) {
      console.warn(`TMDB S01E01 verification failed for ${show.id}`, error);
      return null;
    }
  });
}

async function loadTvdbPremieres(from, to) {
  if (!process.env.TVDB_API_KEY) return [];

  const candidates = await fetchTvdbCandidates(from, to);
  return mapInBatches(candidates, 6, async (show) => {
    try {
      return await verifyTvdbS01E01(show, from, to);
    } catch (error) {
      console.warn(`TVDB S01E01 verification failed for ${getTvdbSeriesId(show)}`, error);
      return null;
    }
  });
}

function mergePremieres(items) {
  const merged = new Map();

  items.filter(Boolean).forEach((show) => {
    const key = `${String(show.name || "").trim().toLowerCase()}|${show.premiere_date}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, show);
      return;
    }

    merged.set(key, {
      ...existing,
      ...show,
      tmdb_id: existing.tmdb_id || show.tmdb_id || null,
      tvdb_id: existing.tvdb_id || show.tvdb_id || null,
      poster_url: existing.poster_url || show.poster_url,
      image: existing.image || show.image,
      popularity: Math.max(Number(existing.popularity || 0), Number(show.popularity || 0)),
    });
  });

  return [...merged.values()]
    .sort((a, b) => {
      if (a.premiere_date !== b.premiere_date) {
        return a.premiere_date.localeCompare(b.premiere_date);
      }
      return Number(b.popularity || 0) - Number(a.popularity || 0);
    })
    .slice(0, MAX_SHOWS);
}

export async function handler(event) {
  if (event?.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  try {
    if (
      !process.env.TVDB_API_KEY &&
      !process.env.TMDB_BEARER_TOKEN &&
      !process.env.TMDB_API_KEY
    ) {
      return jsonResponse(500, { message: "No TV data API credentials configured" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const inSevenDays = new Date(today);
    inSevenDays.setDate(inSevenDays.getDate() + 7);
    const from = formatDateOnly(today);
    const to = formatDateOnly(inSevenDays);

    const [tmdbResults, tvdbResults] = await Promise.all([
      loadTmdbPremieres(from, to).catch((error) => {
        console.error("TMDB premiere source failed", error);
        return [];
      }),
      loadTvdbPremieres(from, to).catch((error) => {
        console.error("TVDB premiere source failed", error);
        return [];
      }),
    ]);

    const shows = mergePremieres([...tmdbResults, ...tvdbResults]);

    let persistence = null;
    try {
      persistence = await persistDiscoveryShows(shows);
    } catch (persistError) {
      console.error("Failed to persist premiering shows", persistError);
    }

    return jsonResponse(200, {
      shows,
      meta: {
        persistence,
        from,
        to,
        count: shows.length,
        tmdbCount: tmdbResults.filter(Boolean).length,
        tvdbCount: tvdbResults.filter(Boolean).length,
        criteria: "verified season 1 episode 1 airing within the next 7 days",
      },
    });
  } catch (error) {
    console.error("getPremieringSoonShows error", error);
    return jsonResponse(500, {
      message: error?.message || "Failed to load S01E01 premieres",
    });
  }
}
