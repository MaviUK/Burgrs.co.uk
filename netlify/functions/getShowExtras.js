const TVDB_BASE_URL = "https://api4.thetvdb.com/v4";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const TMDB_BACKDROP_BASE_URL = "https://image.tmdb.org/t/p/original";

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control":
        statusCode === 200
          ? "public, max-age=300, stale-while-revalidate=1800"
          : "no-store",
    },
    body: JSON.stringify(body),
  };
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

async function getTvdbToken() {
  const now = Date.now();

  if (cachedToken && now < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const apikey = process.env.TVDB_API_KEY;
  const pin = process.env.TVDB_PIN;

  if (!apikey) {
    throw new Error("Missing TVDB_API_KEY environment variable");
  }

  const payload = { apikey };

  if (pin) {
    payload.pin = pin;
  }

  const loginRes = await fetch(`${TVDB_BASE_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const loginJson = await readJsonSafe(loginRes);

  if (!loginRes.ok) {
    throw new Error(
      `TVDB login failed (${loginRes.status}): ${
        loginJson?.message || loginJson?.status || "Unknown error"
      }`
    );
  }

  const token = loginJson?.data?.token;

  if (!token) {
    throw new Error("TVDB login succeeded but no token was returned");
  }

  cachedToken = token;
  cachedTokenExpiresAt = now + 27 * 24 * 60 * 60 * 1000;

  return token;
}

async function tvdbGet(path) {
  const token = await getTvdbToken();

  const separator = path.includes("?") ? "&" : "?";
  const url = `${TVDB_BASE_URL}${path}${separator}language=eng&meta=translations`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "eng",
    },
  });

  const json = await readJsonSafe(res);

  if (!res.ok) {
    throw new Error(
      `TVDB request failed (${res.status}) for ${url}: ${
        json?.message || json?.status || "Unknown error"
      }`
    );
  }

  return json;
}

function extractEnglishTranslationValue(translations, key) {
  if (!translations) return null;

  const candidateBuckets = [
    translations?.eng,
    translations?.en,
    translations?.english,
    translations?.ENG,
    translations?.EN,
  ].filter(Boolean);

  for (const bucket of candidateBuckets) {
    if (bucket && typeof bucket === "object") {
      const value = bucket[key] ?? bucket?.[key?.toLowerCase?.() ?? key] ?? null;
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }

  const flatArrays = [
    Array.isArray(translations) ? translations : null,
    Array.isArray(translations?.translations) ? translations.translations : null,
    Array.isArray(translations?.overviewTranslations) ? translations.overviewTranslations : null,
    Array.isArray(translations?.nameTranslations) ? translations.nameTranslations : null,
  ].filter(Boolean);

  for (const arr of flatArrays) {
    for (const item of arr) {
      const lang = String(
        item?.language || item?.languageCode || item?.lang || item?.iso639_2 || item?.iso639_1 || ""
      ).trim().toLowerCase();
      if (!["eng", "en", "english"].includes(lang)) continue;

      const value =
        key === "name"
          ? item?.[key] ?? item?.name ?? item?.value ?? item?.text ?? null
          : key === "overview"
          ? item?.[key] ?? item?.overview ?? item?.value ?? item?.text ?? null
          : item?.[key] ?? item?.value ?? item?.text ?? null;
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }

  return null;
}

function applyEnglishSeriesText(series) {
  if (!series || typeof series !== "object") return series;

  const englishName =
    extractEnglishTranslationValue(series?.translations, "name") ||
    extractEnglishTranslationValue(series?.nameTranslations, "name");
  const englishOverview =
    extractEnglishTranslationValue(series?.translations, "overview") ||
    extractEnglishTranslationValue(series?.overviewTranslations, "overview");

  return {
    ...series,
    english_name: englishName || null,
    english_overview: englishOverview || null,
    name: englishName || series?.name || null,
    overview: englishOverview || series?.overview || null,
  };
}

function applyEnglishEpisodeText(episode) {
  if (!episode || typeof episode !== "object") return episode;

  const englishName =
    extractEnglishTranslationValue(episode?.translations, "name") ||
    extractEnglishTranslationValue(episode?.nameTranslations, "name");
  const englishOverview =
    extractEnglishTranslationValue(episode?.translations, "overview") ||
    extractEnglishTranslationValue(episode?.overviewTranslations, "overview");

  return {
    ...episode,
    name: englishName || episode?.name || null,
    overview: englishOverview || episode?.overview || null,
  };
}

function pickImage(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];

  return values
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        return (
          item.name ??
          item.genre ??
          item.type ??
          item.setting ??
          item.label ??
          item.value ??
          null
        );
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeShow(seriesData, tvdbId, tmdbBackdropUrl = null) {
  if (!seriesData || typeof seriesData !== "object") return null;

  const companies = Array.isArray(seriesData?.companies)
    ? seriesData.companies
    : [];
  const originalNetwork = companies.find(
    (company) =>
      company?.primaryCompanyType === 1 ||
      company?.companyType?.companyTypeId === 1 ||
      String(company?.companyType?.name || "").toLowerCase() === "network"
  );

  const genres = normalizeStringArray(seriesData?.genres);
  const relationshipTypes = normalizeStringArray(
    seriesData?.relationship_types || seriesData?.relationshipTypes
  );
  const settings = normalizeStringArray(seriesData?.settings);

  const score =
    seriesData?.score != null && !Number.isNaN(Number(seriesData.score))
      ? Number(seriesData.score)
      : null;

  return {
    tvdb_id: tvdbId,
    name:
      seriesData?.english_name ||
      extractEnglishTranslationValue(seriesData?.translations, "name") ||
      seriesData?.name ||
      seriesData?.seriesName ||
      seriesData?.translations?.name ||
      "Unknown title",
    overview:
      seriesData?.english_overview ||
      extractEnglishTranslationValue(seriesData?.translations, "overview") ||
      seriesData?.overview ||
      seriesData?.translations?.overview ||
      "",
    status: seriesData?.status?.name || seriesData?.status || null,
    poster_url: pickImage(
      seriesData?.image,
      seriesData?.image_url,
      seriesData?.poster,
      seriesData?.poster_url,
      seriesData?.thumbnail
    ),
    banner_url: tmdbBackdropUrl,
    backdrop_url: tmdbBackdropUrl,
    background_url: tmdbBackdropUrl,
    first_aired:
      seriesData?.firstAired ||
      seriesData?.first_aired ||
      seriesData?.year ||
      null,
    network:
      originalNetwork?.name ||
      seriesData?.originalNetwork?.name ||
      seriesData?.network ||
      "",
    genres,
    original_language:
      seriesData?.originalLanguage ||
      seriesData?.original_language ||
      "",
    relationship_types: relationshipTypes,
    settings,
    rating_average: score,
    rating_count:
      seriesData?.scoreCount != null &&
      !Number.isNaN(Number(seriesData.scoreCount))
        ? Number(seriesData.scoreCount)
        : null,
  };
}

function normalizeEpisodes(seriesData, tvdbId) {
  const rawEpisodes = Array.isArray(seriesData?.episodes)
    ? seriesData.episodes
    : [];

  return rawEpisodes
    .map((ep, index) => ({
      id: ep?.id || `${tvdbId}-ep-${index}`,
      tvdb_id: ep?.id || ep?.tvdb_id || ep?.tvdbId || null,
      season_number:
        ep?.seasonNumber ??
        ep?.season_number ??
        ep?.airedSeason ??
        0,
      episode_number:
        ep?.number ??
        ep?.episodeNumber ??
        ep?.episode_number ??
        ep?.airedEpisodeNumber ??
        0,
      episode_code:
        ep?.productionCode ||
        ep?.episodeCode ||
        ep?.episode_code ||
        null,
      name:
        extractEnglishTranslationValue(ep?.translations, "name") ||
        ep?.name ||
        "Untitled episode",
      overview:
        extractEnglishTranslationValue(ep?.translations, "overview") ||
        ep?.overview ||
        "",
      aired_date:
        ep?.aired ||
        ep?.airDate ||
        ep?.aired_date ||
        null,
      image_url: pickImage(ep?.image, ep?.image_url, ep?.thumbnail),
    }))
    .sort((a, b) => {
      const seasonDiff = Number(a.season_number) - Number(b.season_number);
      if (seasonDiff !== 0) return seasonDiff;
      return Number(a.episode_number) - Number(b.episode_number);
    });
}

async function getSeriesEpisodesDefault(tvdbId) {
  try {
    const json = await tvdbGet(`/series/${tvdbId}/episodes/default`);
    const data = Array.isArray(json?.data?.episodes)
      ? json.data.episodes
      : Array.isArray(json?.data)
      ? json.data
      : [];

    return data
      .map((ep, index) => ({
        id: ep?.id || `${tvdbId}-ep-default-${index}`,
        tvdb_id: ep?.id || ep?.tvdb_id || ep?.tvdbId || null,
        season_number:
          ep?.seasonNumber ??
          ep?.season_number ??
          ep?.airedSeason ??
          0,
        episode_number:
          ep?.number ??
          ep?.episodeNumber ??
          ep?.episode_number ??
          ep?.airedEpisodeNumber ??
          0,
        episode_code:
          ep?.productionCode ||
          ep?.episodeCode ||
          ep?.episode_code ||
          null,
        name: ep?.name || "Untitled episode",
        overview: ep?.overview || "",
        aired_date:
          ep?.aired ||
          ep?.airDate ||
          ep?.aired_date ||
          null,
        image_url: pickImage(ep?.image, ep?.image_url, ep?.thumbnail),
      }))
      .sort((a, b) => {
        const seasonDiff = Number(a.season_number) - Number(b.season_number);
        if (seasonDiff !== 0) return seasonDiff;
        return Number(a.episode_number) - Number(b.episode_number);
      });
  } catch (error) {
    console.error("default episodes fetch failed:", error);
    return [];
  }
}

function normalizeCastFromSeries(seriesData) {
  const rawCharacters = Array.isArray(seriesData?.characters)
    ? seriesData.characters
    : [];

  return rawCharacters
    .map((item, index) => {
      const personName =
        item?.personName ||
        item?.person_name ||
        item?.people?.name ||
        item?.person?.name ||
        item?.name ||
        null;

      const characterName =
        item?.name ||
        item?.characterName ||
        item?.character_name ||
        item?.role ||
        null;

      const image = pickImage(
        item?.image,
        item?.image_url,
        item?.personImgURL,
        item?.personImgUrl,
        item?.people?.image,
        item?.person?.image
      );

      return {
        id: item?.id || item?.peopleId || item?.personId || `cast-${index}`,
        personName,
        characterName,
        image,
        sort: typeof item?.sort === "number" ? item.sort : index,
      };
    })
    .filter((item) => item.personName)
    .sort((a, b) => a.sort - b.sort)
    .slice(0, 18)
    .map(({ id, personName, characterName, image }) => ({
      id,
      personName,
      characterName,
      image,
    }));
}

function normalizeCrewFromTmdb(creditsJson) {
  const allowedJobs = new Set([
    "Director",
    "Writer",
    "Screenplay",
    "Executive Producer",
    "Producer",
    "Creator",
  ]);

  const seen = new Set();
  const crew = Array.isArray(creditsJson?.crew) ? creditsJson.crew : [];

  return crew
    .filter((person) => allowedJobs.has(person?.job))
    .filter((person) => {
      const key = `${person?.id || "no-id"}-${person?.job || "no-job"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((person, index) => ({
      id: person?.id || `crew-${index}`,
      personName: person?.name || "Unknown crew",
      role: person?.job || "Crew",
      image: person?.profile_path
        ? `${TMDB_IMAGE_BASE_URL}${person.profile_path}`
        : null,
      sort:
        person?.order != null && !Number.isNaN(Number(person.order))
          ? Number(person.order)
          : index,
    }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, 18)
    .map(({ id, personName, role, image }) => ({
      id,
      personName,
      role,
      image,
    }));
}

function buildRecommendationItem(item, index, prefix = "rec") {
  const tvdbId =
    item?.tvdb_id ||
    item?.tvdbId ||
    item?.id ||
    item?.seriesId ||
    item?.series_id ||
    item?.remoteIds?.tvdb ||
    null;

  const name =
    item?.name ||
    item?.seriesName ||
    item?.series_name ||
    item?.translations?.name ||
    null;

  const posterUrl = pickImage(
    item?.poster_url,
    item?.posterUrl,
    item?.poster,
    item?.image,
    item?.image_url,
    item?.thumbnail
  );

  const firstAired =
    item?.firstAired ||
    item?.first_aired ||
    item?.year ||
    null;

  return {
    id: item?.id || `${prefix}-${index}`,
    tvdb_id: tvdbId,
    tvdbId,
    name,
    poster_url: posterUrl,
    posterUrl,
    first_aired: firstAired,
    firstAired,
  };
}

function dedupeRecommendations(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key = String(
      item.tvdb_id ||
        item.tvdbId ||
        item.tmdb_id ||
        item.name ||
        ""
    );
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePeopleAlsoWatch(seriesData) {
  const candidates = [
    ...(Array.isArray(seriesData?.peopleAlsoWatch)
      ? seriesData.peopleAlsoWatch
      : []),
    ...(Array.isArray(seriesData?.people_also_watch)
      ? seriesData.people_also_watch
      : []),
  ];

  return dedupeRecommendations(
    candidates
      .map((item, index) => buildRecommendationItem(item, index, "paw"))
      .filter((item) => item.tvdb_id && item.name)
  ).slice(0, 12);
}

function normalizeRecommendations(seriesData) {
  const candidates = [
    ...(Array.isArray(seriesData?.recommendations)
      ? seriesData.recommendations
      : []),
    ...(Array.isArray(seriesData?.similar) ? seriesData.similar : []),
    ...(Array.isArray(seriesData?.relatedSeries)
      ? seriesData.relatedSeries
      : []),
    ...(Array.isArray(seriesData?.related_series)
      ? seriesData.related_series
      : []),
  ];

  return dedupeRecommendations(
    candidates
      .map((item, index) => buildRecommendationItem(item, index, "rec"))
      .filter((item) => item.tvdb_id && item.name)
  ).slice(0, 12);
}

async function getPeopleAlsoWatch(tvdbId) {
  try {
    const json = await tvdbGet(`/series/${tvdbId}/filter`);
    const data = Array.isArray(json?.data) ? json.data : [];

    return dedupeRecommendations(
      data
        .map((item, index) => ({
          id: item?.id || `paw-${index}`,
          tvdb_id: item?.id || item?.tvdb_id || item?.tvdbId || null,
          tvdbId: item?.id || item?.tvdb_id || item?.tvdbId || null,
          name:
            item?.name ||
            item?.seriesName ||
            item?.series_name ||
            item?.translations?.name ||
            null,
          poster_url: pickImage(
            item?.image,
            item?.thumbnail,
            item?.poster,
            item?.poster_url,
            item?.posterUrl
          ),
          posterUrl: pickImage(
            item?.image,
            item?.thumbnail,
            item?.poster,
            item?.poster_url,
            item?.posterUrl
          ),
          first_aired:
            item?.firstAired || item?.first_aired || item?.year || null,
          firstAired:
            item?.firstAired || item?.first_aired || item?.year || null,
        }))
        .filter((item) => item.tvdb_id && item.name)
    ).slice(0, 12);
  } catch (error) {
    console.error("peopleAlsoWatch fetch failed:", error);
    return [];
  }
}

async function findTmdbTvIdByTvdbId(tvdbId, showName = "", firstAired = "") {
  const apiKey = process.env.TMDB_API_KEY;

  const debug = {
    hasApiKey: !!apiKey,
    findStatus: null,
    findOk: false,
    findResultCount: 0,
    searchStatus: null,
    searchOk: false,
    searchResultCount: 0,
    matchedBy: null,
  };

  if (!apiKey) {
    return { tmdbId: null, debug };
  }

  try {
    const findRes = await fetch(
      `${TMDB_BASE_URL}/find/${tvdbId}?api_key=${encodeURIComponent(
        apiKey
      )}&external_source=tvdb_id`
    );

    debug.findStatus = findRes.status;
    debug.findOk = findRes.ok;

    const findJson = await readJsonSafe(findRes);
    const findResults = Array.isArray(findJson?.tv_results)
      ? findJson.tv_results
      : [];

    debug.findResultCount = findResults.length;

    if (findRes.ok && findResults.length > 0) {
      debug.matchedBy = "tvdb_id";
      return { tmdbId: findResults[0].id, debug };
    }
  } catch (error) {
    console.error("TMDB find by TVDB id failed:", error);
  }

  if (!showName) {
    return { tmdbId: null, debug };
  }

  try {
    const searchRes = await fetch(
      `${TMDB_BASE_URL}/search/tv?api_key=${encodeURIComponent(
        apiKey
      )}&query=${encodeURIComponent(showName)}`
    );

    debug.searchStatus = searchRes.status;
    debug.searchOk = searchRes.ok;

    const searchJson = await readJsonSafe(searchRes);
    const results = Array.isArray(searchJson?.results) ? searchJson.results : [];

    debug.searchResultCount = results.length;

    const targetYear = firstAired ? String(firstAired).slice(0, 4) : "";

    const ranked = [...results].sort((a, b) => {
      const aName = String(a?.name || a?.original_name || "").toLowerCase();
      const bName = String(b?.name || b?.original_name || "").toLowerCase();
      const wanted = String(showName).toLowerCase();

      const aExact = aName === wanted ? 1 : 0;
      const bExact = bName === wanted ? 1 : 0;
      if (bExact !== aExact) return bExact - aExact;

      const aYear = String(a?.first_air_date || "").slice(0, 4);
      const bYear = String(b?.first_air_date || "").slice(0, 4);
      const aYearMatch = targetYear && aYear === targetYear ? 1 : 0;
      const bYearMatch = targetYear && bYear === targetYear ? 1 : 0;
      if (bYearMatch !== aYearMatch) return bYearMatch - aYearMatch;

      return Number(b?.popularity || 0) - Number(a?.popularity || 0);
    });

    if (searchRes.ok && ranked.length > 0) {
      debug.matchedBy = "search";
      return { tmdbId: ranked[0].id, debug };
    }
  } catch (error) {
    console.error("TMDB search fallback failed:", error);
  }

  return { tmdbId: null, debug };
}

async function getTmdbRecommendations(tmdbId) {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey || !tmdbId) return [];

    const res = await fetch(
      `${TMDB_BASE_URL}/tv/${tmdbId}/recommendations?api_key=${encodeURIComponent(
        apiKey
      )}`
    );

    const json = await readJsonSafe(res);

    if (!res.ok) {
      console.error("TMDB recommendations fetch failed:", res.status, json);
      return [];
    }

    const results = Array.isArray(json?.results) ? json.results : [];

    return dedupeRecommendations(
      results.slice(0, 12).map((item, index) => ({
        id: item?.id || `tmdb-rec-${index}`,
        tmdb_id: item?.id || null,
        source: "tmdb",
        name: item?.name || item?.original_name || "Unknown show",
        poster_path: item?.poster_path || null,
        poster_url: item?.poster_path
          ? `${TMDB_IMAGE_BASE_URL}${item.poster_path}`
          : null,
        posterUrl: item?.poster_path
          ? `${TMDB_IMAGE_BASE_URL}${item.poster_path}`
          : null,
        first_air_date: item?.first_air_date || null,
        first_aired: item?.first_air_date || null,
        overview: item?.overview || "",
      }))
    );
  } catch (error) {
    console.error("TMDB recommendations fetch failed:", error);
    return [];
  }
}

async function getTmdbProvidersTrailerBackdropAndCrew(
  tvdbId,
  showName = "",
  firstAired = ""
) {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) {
      return {
        providers: [],
        trailer: null,
        backdropUrl: null,
        crew: [],
        tmdbId: null,
        backdropCount: 0,
        tmdbLookupDebug: {
          hasApiKey: false,
          findStatus: null,
          findOk: false,
          findResultCount: 0,
          searchStatus: null,
          searchOk: false,
          searchResultCount: 0,
          matchedBy: null,
        },
      };
    }

    const lookup = await findTmdbTvIdByTvdbId(tvdbId, showName, firstAired);
    const tmdbId = lookup.tmdbId;
    const tmdbLookupDebug = lookup.debug;

    if (!tmdbId) {
      return {
        providers: [],
        trailer: null,
        backdropUrl: null,
        crew: [],
        tmdbId: null,
        backdropCount: 0,
        tmdbLookupDebug,
      };
    }

    const [imagesRes, providersRes, videosRes, creditsRes] = await Promise.all([
      fetch(
        `${TMDB_BASE_URL}/tv/${tmdbId}/images?api_key=${encodeURIComponent(
          apiKey
        )}&language=en-US&include_image_language=en-US,null`
      ),
      fetch(
        `${TMDB_BASE_URL}/tv/${tmdbId}/watch/providers?api_key=${encodeURIComponent(
          apiKey
        )}`
      ),
      fetch(
        `${TMDB_BASE_URL}/tv/${tmdbId}/videos?api_key=${encodeURIComponent(
          apiKey
        )}`
      ),
      fetch(
        `${TMDB_BASE_URL}/tv/${tmdbId}/credits?api_key=${encodeURIComponent(
          apiKey
        )}`
      ),
    ]);

    const imagesJson = await readJsonSafe(imagesRes);
    const providersJson = await readJsonSafe(providersRes);
    const videosJson = await readJsonSafe(videosRes);
    const creditsJson = await readJsonSafe(creditsRes);

    const backdrops = Array.isArray(imagesJson?.backdrops)
      ? imagesJson.backdrops
      : [];

    let bestBackdrop = null;

    if (backdrops.length > 0) {
      bestBackdrop = [...backdrops].sort((a, b) => {
        const aLangNull = a?.iso_639_1 == null ? 1 : 0;
        const bLangNull = b?.iso_639_1 == null ? 1 : 0;
        if (bLangNull !== aLangNull) return bLangNull - aLangNull;

        const voteDiff =
          Number(b?.vote_average || 0) - Number(a?.vote_average || 0);
        if (voteDiff !== 0) return voteDiff;

        return Number(b?.width || 0) - Number(a?.width || 0);
      })[0];
    }

    const backdropUrl = bestBackdrop?.file_path
      ? `${TMDB_BACKDROP_BASE_URL}${bestBackdrop.file_path}`
      : null;

    const providerRegion =
      providersJson?.results?.GB ||
      providersJson?.results?.US ||
      null;

    const providerItems = [
      ...(providerRegion?.flatrate || []),
      ...(providerRegion?.free || []),
      ...(providerRegion?.ads || []),
    ];

    const seenProviders = new Set();
    const providers = providerItems
      .filter((p) => {
        const key = String(p?.provider_id || p?.provider_name || "");
        if (!key || seenProviders.has(key)) return false;
        seenProviders.add(key);
        return true;
      })
      .map((p) => ({
        id: p.provider_id,
        name: p.provider_name,
        logo: p.logo_path
          ? `https://image.tmdb.org/t/p/w92${p.logo_path}`
          : null,
      }));

    const videos = Array.isArray(videosJson?.results) ? videosJson.results : [];

    const trailerCandidate =
      videos.find(
        (v) => v.site === "YouTube" && v.type === "Trailer" && v.official
      ) ||
      videos.find((v) => v.site === "YouTube" && v.type === "Trailer") ||
      null;

    const trailer = trailerCandidate?.key
      ? {
          name: trailerCandidate.name || "Watch Trailer",
          url: `https://www.youtube.com/watch?v=${trailerCandidate.key}`,
        }
      : null;

    const crew = normalizeCrewFromTmdb(creditsJson);

    return {
      providers,
      trailer,
      backdropUrl,
      crew,
      tmdbId,
      backdropCount: backdrops.length,
      tmdbLookupDebug,
    };
  } catch (err) {
    console.error("TMDB fetch failed:", err);
    return {
      providers: [],
      trailer: null,
      backdropUrl: null,
      crew: [],
      tmdbId: null,
      backdropCount: 0,
      tmdbLookupDebug: null,
    };
  }
}

export async function handler(event) {
  try {
    const tvdbIdRaw = event.queryStringParameters?.tvdbId;
    const tvdbId = Number(tvdbIdRaw);

    if (!tvdbIdRaw || Number.isNaN(tvdbId) || tvdbId <= 0) {
      return jsonResponse(400, { error: "Missing or invalid tvdbId" });
    }

    const seriesJson = await tvdbGet(`/series/${tvdbId}/extended`);
    const seriesData = applyEnglishSeriesText(seriesJson?.data || {});

    const {
      providers,
      trailer,
      backdropUrl: tmdbBackdropUrl,
      crew,
      tmdbId,
      backdropCount,
      tmdbLookupDebug,
    } = await getTmdbProvidersTrailerBackdropAndCrew(
      tvdbId,
      seriesData?.name || "",
      seriesData?.firstAired || seriesData?.first_aired || ""
    );

    const [
      tmdbRecommendations,
      fetchedEpisodes,
      fetchedPeopleAlsoWatch,
    ] = await Promise.all([
      getTmdbRecommendations(tmdbId),
      getSeriesEpisodesDefault(tvdbId),
      getPeopleAlsoWatch(tvdbId),
    ]);

    const show = normalizeShow(seriesData, tvdbId, tmdbBackdropUrl);

    const inlineEpisodes = normalizeEpisodes(seriesData, tvdbId);
    const episodes =
      fetchedEpisodes.length > 0 ? fetchedEpisodes : inlineEpisodes;

    const cast = normalizeCastFromSeries(seriesData);

    const inlinePeopleAlsoWatch = normalizePeopleAlsoWatch(seriesData);
    const peopleAlsoWatch =
      fetchedPeopleAlsoWatch.length > 0
        ? fetchedPeopleAlsoWatch
        : inlinePeopleAlsoWatch;

    const fallbackRecommendations = normalizeRecommendations(seriesData);

    const recommendations =
      tmdbRecommendations.length > 0
        ? tmdbRecommendations
        : fallbackRecommendations;

    return jsonResponse(200, {
      show,
      banner_url: show?.banner_url || null,
      bannerUrl: show?.banner_url || null,
      backdrop_url: show?.backdrop_url || null,
      backdropUrl: show?.backdrop_url || null,
      background_url: show?.background_url || null,
      backgroundUrl: show?.background_url || null,
      episodes,
      cast,
      crew,
      providers,
      trailer,
      peopleAlsoWatch,
      recommendations,
      debug: {
        showFound: !!show,
        inlineEpisodeCount: inlineEpisodes.length,
        fetchedEpisodeCount: fetchedEpisodes.length,
        episodeCount: episodes.length,
        castCount: cast.length,
        crewCount: crew.length,
        providerCount: providers.length,
        hasTrailer: !!trailer,
        hasTmdbBackdrop: !!show?.backdrop_url,
        tmdbId: tmdbId || null,
        tmdbBackdropCount: backdropCount || 0,
        tmdbRecommendationCount: tmdbRecommendations.length,
        fallbackRecommendationCount: fallbackRecommendations.length,
        peopleAlsoWatchCount: peopleAlsoWatch.length,
        sourceShowName: seriesData?.name || null,
        sourceFirstAired:
          seriesData?.firstAired || seriesData?.first_aired || null,
        tmdbLookupDebug,
      },
    });
  } catch (error) {
    console.error("getShowExtras failed:", error);

    return jsonResponse(500, {
      error: error.message || "Failed to load show extras",
      show: null,
      banner_url: null,
      bannerUrl: null,
      backdrop_url: null,
      backdropUrl: null,
      background_url: null,
      backgroundUrl: null,
      episodes: [],
      cast: [],
      crew: [],
      providers: [],
      trailer: null,
      peopleAlsoWatch: [],
      recommendations: [],
    });
  }
}
