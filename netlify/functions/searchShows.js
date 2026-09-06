function normalizeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function extractRemoteId(series, wantedSource) {
  const wanted = String(wantedSource || "").trim().toLowerCase();
  const pools = [
    series?.remoteIds,
    series?.remote_ids,
    series?.externalIds,
    series?.external_ids,
    series?.ids,
  ].filter(Array.isArray);

  for (const pool of pools) {
    for (const item of pool) {
      if (!item || typeof item !== "object") continue;

      const source = String(
        item.sourceName ||
          item.source_name ||
          item.sourceType ||
          item.source_type ||
          item.type ||
          item.name ||
          item.provider ||
          ""
      ).trim().toLowerCase();

      if (source && !source.includes(wanted)) continue;

      const value =
        item.id ??
        item.remoteId ??
        item.remote_id ??
        item.value ??
        item.externalId ??
        item.external_id ??
        null;

      const num = Number(value);
      if (Number.isFinite(num) && num > 0) return num;
    }
  }

  const direct = series?.tmdb_id ?? series?.tmdbId ?? series?.themoviedb_id ?? null;
  const directNum = Number(direct);
  return Number.isFinite(directNum) && directNum > 0 ? directNum : null;
}

function normalizeGenres(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((genre) => {
      if (typeof genre === "string") return genre;
      if (genre && typeof genre === "object") {
        return genre.name ?? genre.genre ?? null;
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        return (
          item.name ??
          item.type ??
          item.label ??
          item.value ??
          item.setting ??
          item.relationship ??
          item.title ??
          item.alias ??
          null
        );
      }
      return null;
    })
    .filter(Boolean);
}

function dedupeByValue(values) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function extractAliases(series) {
  if (!series || typeof series !== "object") return [];

  const pools = [
    series.aliases,
    series.alias,
    series.alternateNames,
    series.alternate_names,
    series.alternativeNames,
    series.alternative_names,
  ];

  const aliases = [];

  for (const pool of pools) {
    if (Array.isArray(pool)) {
      aliases.push(...normalizeStringArray(pool));
    } else if (typeof pool === "string") {
      aliases.push(pool);
    } else if (pool && typeof pool === "object") {
      aliases.push(...normalizeStringArray(Object.values(pool)));
    }
  }

  return dedupeByValue(aliases);
}

function findMatchingAlias(show, query) {
  const queryLower = String(query || "").trim().toLowerCase();
  if (!queryLower) return null;

  const aliases = normalizeStringArray(show?.aliases);
  const exact = aliases.find((alias) => alias.toLowerCase() === queryLower);
  if (exact) return exact;

  const starts = aliases.find((alias) => alias.toLowerCase().startsWith(queryLower));
  if (starts) return starts;

  return aliases.find((alias) => alias.toLowerCase().includes(queryLower)) || null;
}

function normalizeNetwork(value) {
  if (!value) return null;

  if (Array.isArray(value)) {
    const names = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") return item.name ?? null;
        return null;
      })
      .filter(Boolean);

    return names.length ? names.join(", ") : null;
  }

  if (typeof value === "object") {
    return value.name ?? null;
  }

  return value;
}

function normalizeLanguage(value) {
  if (!value) return "";

  const str = String(value).trim().toLowerCase();

  const map = {
    eng: "english",
    en: "english",
    english: "english",
    jpn: "japanese",
    ja: "japanese",
    japanese: "japanese",
    kor: "korean",
    ko: "korean",
    korean: "korean",
    spa: "spanish",
    es: "spanish",
    spanish: "spanish",
    fra: "french",
    fr: "french",
    french: "french",
    deu: "german",
    de: "german",
    german: "german",
    swe: "swedish",
    sv: "swedish",
    swedish: "swedish",
  };

  return map[str] || str;
}

function looksMostlyLatin(text) {
  if (!text) return true;

  return /^[\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}]+$/u.test(
    String(text)
  );
}

function getYear(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear();
}

function dedupeByTvdbId(items) {
  const map = new Map();

  for (const item of items) {
    if (!item?.tvdb_id) continue;

    if (!map.has(item.tvdb_id)) {
      map.set(item.tvdb_id, item);
      continue;
    }

    const existing = map.get(item.tvdb_id);
    const aliases = dedupeByValue([
      ...normalizeStringArray(existing.aliases),
      ...normalizeStringArray(item.aliases),
    ]);

    const existingScore =
      (existing.image_url ? 1 : 0) +
      (existing.overview ? 1 : 0) +
      ((existing.genres || []).length ? 1 : 0) +
      (existing.network ? 1 : 0) +
      (existing.rating_average != null ? 1 : 0) +
      (existing.original_language ? 1 : 0);

    const nextScore =
      (item.image_url ? 1 : 0) +
      (item.overview ? 1 : 0) +
      ((item.genres || []).length ? 1 : 0) +
      (item.network ? 1 : 0) +
      (item.rating_average != null ? 1 : 0) +
      (item.original_language ? 1 : 0);

    if (nextScore >= existingScore) {
      map.set(item.tvdb_id, { ...existing, ...item, aliases });
    } else {
      map.set(item.tvdb_id, { ...item, ...existing, aliases });
    }
  }

  return Array.from(map.values());
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

function normalizeSearchResult(item) {
  const normalizedItem = applyEnglishSeriesText(item);

  const rawGenres = Array.isArray(normalizedItem?.genres)
    ? normalizedItem.genres
    : Array.isArray(normalizedItem?.genre)
    ? normalizedItem.genre
    : [];

  return {
    tvdb_id: Number(normalizedItem?.tvdb_id || normalizedItem?.id) || null,
    tmdb_id: extractRemoteId(normalizedItem, "tmdb"),
    name:
      normalizedItem?.english_name ||
      extractEnglishTranslationValue(normalizedItem?.translations, "name") ||
      extractEnglishTranslationValue(normalizedItem?.nameTranslations, "name") ||
      normalizedItem?.name ||
      normalizedItem?.seriesName ||
      "Unknown title",
    aliases: extractAliases(normalizedItem),
    overview:
      normalizedItem?.english_overview ||
      extractEnglishTranslationValue(normalizedItem?.translations, "overview") ||
      extractEnglishTranslationValue(normalizedItem?.overviewTranslations, "overview") ||
      normalizedItem?.overview ||
      "",
    status:
      typeof item?.status === "object"
        ? item?.status?.name || null
        : item?.status || null,
    first_aired: item?.first_air_time || item?.firstAired || null,
    first_air_time: item?.first_air_time || item?.firstAired || null,
    image_url: item?.image_url || item?.image || null,
    poster_url: item?.image_url || item?.image || null,
    slug: item?.slug || null,
    network: normalizeNetwork(
      item?.network ||
        item?.originalNetwork ||
        item?.latestNetwork ||
        item?.companies
    ),
    genres: normalizeGenres(rawGenres),
    relationship_types: normalizeStringArray(
      item?.relationship_types || item?.relationshipTypes
    ),
    settings: normalizeStringArray(item?.settings),
    original_language: normalizeLanguage(
      item?.originalLanguage || item?.language || ""
    ),
    rating_average: normalizeNumber(
      item?.rating_average ?? item?.score ?? item?.siteRating ?? item?.rating
    ),
    rating_count: normalizeNumber(
      item?.rating_count ?? item?.siteRatingCount ?? item?.scoreCount
    ),
    source: "tvdb",
  };
}

function extractTagValues(series, wantedLabel) {
  const pools = [
    series?.tags,
    series?.tagOptions,
    series?.attributes,
    series?.characteristics,
    series?.traits,
    series?.lists,
  ].filter(Array.isArray);

  const wanted = String(wantedLabel || "").trim().toLowerCase();
  const values = [];

  for (const pool of pools) {
    for (const item of pool) {
      const label = String(
        item?.tagName ||
          item?.type ||
          item?.name ||
          item?.category ||
          item?.label ||
          ""
      )
        .trim()
        .toLowerCase();

      if (!label || label !== wanted) continue;

      const candidates = [
        item?.options,
        item?.values,
        item?.items,
        item?.data,
      ].filter(Array.isArray);

      if (typeof item?.value === "string") values.push(item.value);
      if (typeof item?.name === "string" && label === wanted) values.push(item.name);

      for (const candidateList of candidates) {
        for (const candidate of candidateList) {
          if (typeof candidate === "string") values.push(candidate);
          else if (candidate && typeof candidate === "object") {
            values.push(
              candidate.name ??
                candidate.value ??
                candidate.label ??
                candidate.setting ??
                candidate.relationship ??
                null
            );
          }
        }
      }
    }
  }

  return normalizeStringArray(values);
}

function normalizeSeriesDetails(series) {
  const genres = Array.isArray(series?.genres)
    ? series.genres.map((genre) => genre?.name).filter(Boolean)
    : [];

  const companies = Array.isArray(series?.companies) ? series.companies : [];
  const primaryCompany =
    companies.find((company) => company?.primaryCompanyType === 1) ||
    companies[0] ||
    null;

  const artworks = Array.isArray(series?.artworks) ? series.artworks : [];

  const poster =
    artworks.find((art) => art?.type === 2)?.image || series?.image || null;

  return {
    tvdb_id: Number(series?.id) || null,
    tmdb_id: extractRemoteId(series, "tmdb"),
    name:
      extractEnglishTranslationValue(series?.translations, "name") ||
      series?.name ||
      "Unknown title",
    aliases: extractAliases(series),
    overview:
      extractEnglishTranslationValue(series?.translations, "overview") ||
      series?.overview ||
      "",
    status:
      typeof series?.status === "object"
        ? series?.status?.name || null
        : series?.status || null,
    first_aired: series?.firstAired || null,
    first_air_time: series?.firstAired || null,
    image_url: poster,
    poster_url: poster,
    slug: series?.slug || null,
    network: primaryCompany?.name || null,
    genres,
    relationship_types:
      normalizeStringArray(series?.relationship_types).length > 0
        ? normalizeStringArray(series?.relationship_types)
        : extractTagValues(series, "relationship types"),
    settings:
      normalizeStringArray(series?.settings).length > 0
        ? normalizeStringArray(series?.settings)
        : extractTagValues(series, "setting"),
    original_language: normalizeLanguage(
      series?.originalLanguage || series?.language || ""
    ),
    rating_average: normalizeNumber(
      series?.score ??
        series?.siteRating ??
        series?.averageScore ??
        series?.rating_average
    ),
    rating_count: normalizeNumber(
      series?.siteRatingCount ??
        series?.scoreCount ??
        series?.ratingCount ??
        series?.rating_count
    ),
    source: "tvdb",
  };
}

function sortNewestToOldest(items) {
  return [...items].sort((a, b) => {
    const aTime = a.first_aired ? new Date(a.first_aired).getTime() : 0;
    const bTime = b.first_aired ? new Date(b.first_aired).getTime() : 0;
    return bTime - aTime;
  });
}

const RELATED_GENRES = {
  drama: ["drama", "thriller", "crime", "mystery", "romance"],
  thriller: ["thriller", "crime", "mystery", "drama", "horror", "suspense"],
  crime: ["crime", "thriller", "drama", "mystery", "police"],
  mystery: ["mystery", "thriller", "crime", "drama", "supernatural"],
  horror: ["horror", "thriller", "mystery", "supernatural", "drama"],
  comedy: ["comedy", "sitcom", "family", "romance"],
  romance: ["romance", "drama", "comedy"],
  action: ["action", "adventure", "thriller", "crime", "drama"],
  adventure: ["adventure", "action", "fantasy", "science fiction", "drama"],
  fantasy: ["fantasy", "science fiction", "adventure", "drama"],
  "science fiction": [
    "science fiction",
    "sci-fi",
    "fantasy",
    "adventure",
    "thriller",
  ],
  "sci-fi": ["sci-fi", "science fiction", "fantasy", "adventure", "thriller"],
  animation: ["animation", "family", "comedy", "fantasy"],
};

function buildSeedTerms({
  query,
  genre,
  network,
  relationshipType,
  setting,
}) {
  if (query) {
    return [query];
  }

  if (network) {
    return dedupeByValue([
      network,
      `${network} series`,
      `${network} show`,
      `${network} original series`,
      "top rated series",
      "popular series",
    ]);
  }

  if (relationshipType || setting) {
    return [
      "top rated series",
      "popular series",
      "best tv series",
      "award winning series",
      "trending series",
    ];
  }

  if (genre) {
    return [
      "top rated series",
      "popular series",
      "best tv series",
      "hit television series",
      "award winning series",
      "trending series",
    ];
  }

  return [];
}

async function loginToTvdb() {
  const loginRes = await fetch("https://api4.thetvdb.com/v4/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apikey: process.env.TVDB_API_KEY,
      pin: process.env.TVDB_PIN,
    }),
  });

  const loginData = await loginRes.json();

  if (!loginRes.ok) {
    throw new Error(
      `TVDB login failed: ${loginData?.message || JSON.stringify(loginData)}`
    );
  }

  const token = loginData?.data?.token;

  if (!token) {
    throw new Error("TVDB token missing after login");
  }

  return token;
}

async function searchTvdb(token, term) {
  const searchRes = await fetch(
    `https://api4.thetvdb.com/v4/search?query=${encodeURIComponent(term)}&language=eng&meta=translations`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Language": "eng",
      },
    }
  );

  const searchData = await searchRes.json();

  if (!searchRes.ok) {
    throw new Error(
      `TVDB search failed: ${searchData?.message || JSON.stringify(searchData)}`
    );
  }

  const allResults = Array.isArray(searchData?.data) ? searchData.data : [];

  const baseResults = allResults
    .filter((item) => {
      const type = String(item?.type || "").toLowerCase();
      return type === "series";
    })
    .map(normalizeSearchResult)
    .filter((item) => item.tvdb_id);

  const enrichedResults = await Promise.all(
    baseResults.map(async (item) => {
      try {
        const detailed = await fetchSeriesDetails(token, item.tvdb_id);
        return detailed
          ? {
              ...item,
              ...detailed,
              aliases: dedupeByValue([
                ...normalizeStringArray(item.aliases),
                ...normalizeStringArray(detailed.aliases),
              ]),
              tvdb_id: item.tvdb_id,
            }
          : item;
      } catch {
        return item;
      }
    })
  );

  return enrichedResults;
}

async function fetchSeriesDetails(token, tvdbId) {
  const res = await fetch(
    `https://api4.thetvdb.com/v4/series/${tvdbId}/extended?language=eng&meta=translations`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Language": "eng",
      },
    }
  );

  const data = await res.json();

  if (!res.ok || !data?.data) {
    return null;
  }

  return normalizeSeriesDetails(applyEnglishSeriesText(data.data));
}

function scoreShow(show, options) {
  const {
    query,
    genre,
    network,
    relationshipType,
    setting,
    sourceYear,
    sourceRating,
    sourceShowId,
    targetLanguage,
  } = options;

  let score = 0;

  const name = String(show.name || "").toLowerCase();
  const overview = String(show.overview || "").toLowerCase();
  const aliases = normalizeStringArray(show.aliases).map((alias) => alias.toLowerCase());
  const showGenres = normalizeGenres(show.genres).map((g) => g.toLowerCase());
  const showNetwork = String(show.network || "").toLowerCase();
  const showRelationshipTypes = normalizeStringArray(
    show.relationship_types
  ).map((v) => v.toLowerCase());
  const showSettings = normalizeStringArray(show.settings).map((v) =>
    v.toLowerCase()
  );
  const showYear = getYear(show.first_aired || show.first_air_time);
  const showRating = normalizeNumber(show.rating_average);
  const showLanguage = normalizeLanguage(show.original_language || "");

  if (sourceShowId && Number(show.tvdb_id) === Number(sourceShowId)) {
    return -9999;
  }

  if (query) {
    const queryLower = query.toLowerCase();
    if (name === queryLower) score += 120;
    else if (name.startsWith(queryLower)) score += 40;
    else if (name.includes(queryLower)) score += 20;

    if (aliases.some((alias) => alias === queryLower)) score += 115;
    else if (aliases.some((alias) => alias.startsWith(queryLower))) score += 36;
    else if (aliases.some((alias) => alias.includes(queryLower))) score += 18;

    if (overview.includes(queryLower)) score += 6;
  }

  if (genre) {
    const genreLower = genre.toLowerCase();
    const related = RELATED_GENRES[genreLower] || [genreLower];
    const hasExactGenre = showGenres.includes(genreLower);
    const hasRelatedGenre = showGenres.some((g) => related.includes(g));

    if (hasExactGenre) score += 28;
    else if (hasRelatedGenre) score += 10;
    else score -= 20;

    if (name.includes(genreLower)) score -= 18;

    if (
      genreLower === "drama" &&
      (showGenres.includes("animation") || showGenres.includes("family"))
    ) {
      score -= 14;
    }

    if (
      genreLower === "thriller" &&
      (showGenres.includes("animation") || showGenres.includes("family"))
    ) {
      score -= 14;
    }
  }

  if (network) {
    const networkLower = network.toLowerCase();

    if (showNetwork === networkLower) score += 20;
    else if (showNetwork.includes(networkLower)) score += 10;
    else score -= 8;
  }

  if (relationshipType) {
    const relLower = relationshipType.toLowerCase();
    if (showRelationshipTypes.includes(relLower)) score += 24;
    else if (
      showRelationshipTypes.some((v) => v.includes(relLower) || relLower.includes(v))
    ) {
      score += 10;
    } else {
      score -= 14;
    }
  }

  if (setting) {
    const settingLower = setting.toLowerCase();
    if (showSettings.includes(settingLower)) score += 24;
    else if (
      showSettings.some(
        (v) => v.includes(settingLower) || settingLower.includes(v)
      )
    ) {
      score += 10;
    } else {
      score -= 14;
    }
  }

  if (targetLanguage) {
    if (showLanguage === targetLanguage) {
      score += 16;
    } else if (showLanguage) {
      score -= 20;
    } else if (targetLanguage === "english") {
      if (looksMostlyLatin(show.name) && looksMostlyLatin(show.overview)) {
        score += 8;
      } else {
        score -= 18;
      }
    }
  }

  if (sourceYear && showYear) {
    const minYear = Number(sourceYear) - 3;

    if (showYear < minYear) {
      score -= 30;
    } else {
      score += 8;
      if (showYear >= Number(sourceYear)) score += 4;
    }
  } else if (showYear) {
    if (showYear >= 2016) score += 6;
    else if (showYear >= 2010) score += 2;
    else score -= 8;
  }

  if (sourceRating != null && showRating != null) {
    if (showRating >= Number(sourceRating)) {
      score += 10;
      score += Math.min(5, showRating - Number(sourceRating));
    } else {
      score -= 20;
    }
  } else if (showRating != null) {
    if (showRating >= 7.5) score += 8;
    else if (showRating >= 7.0) score += 4;
    else if (showRating < 6.0) score -= 8;
  }

  if (show.image_url) score += 2;
  if (show.overview) score += 2;
  if (showRating != null) score += 2;
  if (show.tvdb_id) score += 3;

  return score;
}

export async function handler(event) {
  try {
    const query = event.queryStringParameters?.q?.trim() || "";
    const genre = event.queryStringParameters?.genre?.trim() || "";
    const network = event.queryStringParameters?.network?.trim() || "";
    const relationshipType =
      event.queryStringParameters?.relationshipType?.trim() || "";
    const setting = event.queryStringParameters?.setting?.trim() || "";
    const sourceShowId = event.queryStringParameters?.sourceShowId?.trim() || "";
    const sourceYear = event.queryStringParameters?.sourceYear?.trim() || "";
    const sourceRatingRaw =
      event.queryStringParameters?.sourceRating?.trim() || "";
    const sourceLanguageRaw =
      event.queryStringParameters?.sourceLanguage?.trim() || "";

    const sourceRating = normalizeNumber(sourceRatingRaw);
    const sourceLanguage = normalizeLanguage(sourceLanguageRaw);
    const targetLanguage = sourceLanguage || "english";

    if (!query && !genre && !network && !relationshipType && !setting) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Missing search query",
        }),
      };
    }

    const token = await loginToTvdb();

    if (query && !genre && !network && !relationshipType && !setting) {
      const tvdbResults = await searchTvdb(token, query).catch(() => []);

      const ranked = dedupeByTvdbId(tvdbResults)
        .map((item) => ({
          ...item,
          matched_alias: findMatchingAlias(item, query),
          _score: scoreShow(item, {
            query,
            genre: "",
            network: "",
            relationshipType: "",
            setting: "",
            sourceYear: "",
            sourceRating: null,
            sourceShowId: "",
            targetLanguage,
          }),
        }))
        .filter((item) => item._score > -1000)
        .sort((a, b) => {
          if (b._score !== a._score) return b._score - a._score;

          const bRating = normalizeNumber(b.rating_average) ?? -1;
          const aRating = normalizeNumber(a.rating_average) ?? -1;
          if (bRating !== aRating) return bRating - aRating;

          const bYear = getYear(b.first_aired || b.first_air_time) ?? 0;
          const aYear = getYear(a.first_aired || a.first_air_time) ?? 0;
          return bYear - aYear;
        })
        .slice(0, 40)
        .map(({ _score, ...item }) => item);

      return {
        statusCode: 200,
        body: JSON.stringify(ranked),
      };
    }

    const seedTerms = buildSeedTerms({
      query,
      genre,
      network,
      relationshipType,
      setting,
    });

    let candidates = [];

    for (const term of seedTerms.slice(0, 6)) {
      const results = await searchTvdb(token, term);
      candidates.push(...results);
    }

    candidates = dedupeByTvdbId(candidates);

    const enriched = [];
    for (const candidate of candidates.slice(0, 40)) {
      const details = await fetchSeriesDetails(token, candidate.tvdb_id);
      enriched.push(
        details
          ? {
              ...candidate,
              ...details,
              aliases: dedupeByValue([
                ...normalizeStringArray(candidate.aliases),
                ...normalizeStringArray(details.aliases),
              ]),
            }
          : candidate
      );
    }

    let results = dedupeByTvdbId(enriched);

    results = results.filter((item) => {
      const itemLanguage = normalizeLanguage(item.original_language || "");

      if (targetLanguage) {
        if (itemLanguage) {
          return itemLanguage === targetLanguage;
        }

        if (targetLanguage === "english") {
          return (
            looksMostlyLatin(item.name || "") &&
            looksMostlyLatin(item.overview || "")
          );
        }
      }

      return true;
    });

    if (genre) {
      const genreLower = genre.toLowerCase();
      const related = RELATED_GENRES[genreLower] || [genreLower];

      results = results.filter((item) => {
        const itemGenres = normalizeGenres(item.genres).map((g) =>
          g.toLowerCase()
        );

        const exact = itemGenres.includes(genreLower);
        const relatedHit = itemGenres.some((g) => related.includes(g));

        if (!exact && !relatedHit) return false;

        if (
          genreLower === "drama" &&
          String(item.name || "").toLowerCase().includes("drama") &&
          (itemGenres.includes("animation") || itemGenres.includes("family"))
        ) {
          return false;
        }

        return true;
      });
    }

    if (network) {
      const networkLower = network.toLowerCase();

      results = results.filter((item) =>
        String(item.network || "")
          .toLowerCase()
          .includes(networkLower)
      );
    }

    if (relationshipType) {
      const relLower = relationshipType.toLowerCase();

      results = results.filter((item) => {
        const vals = normalizeStringArray(item.relationship_types).map((v) =>
          v.toLowerCase()
        );

        return (
          vals.includes(relLower) ||
          vals.some((v) => v.includes(relLower) || relLower.includes(v))
        );
      });
    }

    if (setting) {
      const settingLower = setting.toLowerCase();

      results = results.filter((item) => {
        const vals = normalizeStringArray(item.settings).map((v) =>
          v.toLowerCase()
        );

        return (
          vals.includes(settingLower) ||
          vals.some((v) => v.includes(settingLower) || settingLower.includes(v))
        );
      });
    }

    if (sourceYear) {
      const minYear = Number(sourceYear) - 3;

      results = results.filter((item) => {
        const itemYear = getYear(item.first_aired || item.first_air_time);
        return itemYear == null || itemYear >= minYear;
      });
    } else {
      results = results.filter((item) => {
        const itemYear = getYear(item.first_aired || item.first_air_time);
        return itemYear == null || itemYear >= 2010;
      });
    }

    if (sourceRating != null) {
      results = results.filter((item) => {
        const itemRating = normalizeNumber(item.rating_average);
        return itemRating == null || itemRating >= sourceRating;
      });
    } else {
      results = results.filter((item) => {
        const itemRating = normalizeNumber(item.rating_average);
        return itemRating == null || itemRating >= 6.5;
      });
    }

    results = sortNewestToOldest(
      results
        .map((item) => ({
          ...item,
          matched_alias: query ? findMatchingAlias(item, query) : null,
          _score: scoreShow(item, {
            query,
            genre,
            network,
            relationshipType,
            setting,
            sourceYear,
            sourceRating,
            sourceShowId,
            targetLanguage,
          }),
        }))
        .filter((item) => item._score > -1000)
        .sort((a, b) => {
          if (b._score !== a._score) return b._score - a._score;

          const bRating = normalizeNumber(b.rating_average) ?? -1;
          const aRating = normalizeNumber(a.rating_average) ?? -1;
          if (bRating !== aRating) return bRating - aRating;

          const bYear = getYear(b.first_aired || b.first_air_time) ?? 0;
          const aYear = getYear(a.first_aired || a.first_air_time) ?? 0;
          return bYear - aYear;
        })
        .slice(0, 40)
        .map(({ _score, ...item }) => item)
    );

    return {
      statusCode: 200,
      body: JSON.stringify(results),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Function crashed",
        details: error.message,
      }),
    };
  }
}
