function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniq(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function displayValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return uniq(value.map(displayValue)).join(", ");
  if (typeof value === "object") {
    return String(value.name || value.title || value.value || value.label || "").trim();
  }
  return String(value);
}

function stringValues(value) {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (!item || typeof item !== "object") return [];
      return [item.name, item.title, item.value, item.alias, item.text].filter(Boolean);
    });
  }
  if (typeof value === "object") return stringValues(Object.values(value));
  return [];
}

function translationTitles(source) {
  const pools = [source?.translations, source?.nameTranslations, source?.name_translations];
  const titles = [];
  const english = [];

  function visit(value, inheritedLanguage = "") {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, inheritedLanguage));
      return;
    }
    if (typeof value !== "object") return;

    const language = String(
      value.language || value.languageCode || value.lang || value.iso639_1 || value.iso639_2 || inheritedLanguage || ""
    ).toLowerCase();
    const title = value.name || value.title || (typeof value.value === "string" ? value.value : null) || value.text;
    if (title) {
      titles.push(title);
      if (["en", "eng", "english"].includes(language)) english.push(title);
    }

    Object.entries(value).forEach(([key, nested]) => {
      if (["name", "title", "value", "text", "overview"].includes(key)) return;
      visit(nested, language || key);
    });
  }

  pools.forEach((pool) => visit(pool));
  return { all: uniq(titles), english: uniq(english) };
}

function aliasesFor(source) {
  return uniq([
    ...stringValues(source?.aliases),
    ...stringValues(source?.alias),
    ...stringValues(source?.alternateNames),
    ...stringValues(source?.alternate_names),
    ...stringValues(source?.alternativeNames),
    ...stringValues(source?.alternative_names),
  ]);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const next = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(
        next[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = next[j];
  }
  return prev[b.length];
}

function similarity(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function tokenOverlap(a, b) {
  const left = new Set(normalizeText(a).split(" ").filter(Boolean));
  const right = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let matches = 0;
  left.forEach((token) => {
    if (right.has(token)) matches += 1;
  });
  return matches / Math.max(left.size, right.size);
}

function titleVariants(item) {
  const translations = translationTitles(item);
  const primary = item?.name || item?.seriesName || "";
  const aliases = aliasesFor(item);
  return {
    primary,
    english: translations.english,
    aliases,
    translations: translations.all,
    all: uniq([primary, item?.seriesName, ...translations.english, ...aliases, ...translations.all]),
  };
}

function scoreVariant(query, title) {
  const q = normalizeText(query);
  const t = normalizeText(title);
  if (!q || !t) return 0;
  if (t === q) return 10000;
  if (t.startsWith(q)) return 7200 - Math.min(800, t.length - q.length);
  if (t.includes(q)) return 5600 - Math.min(1000, t.length - q.length);

  const sim = similarity(q, t);
  const overlap = tokenOverlap(q, t);
  let score = Math.round(sim * 4200 + overlap * 1800);
  if (sim >= 0.9) score += 1800;
  else if (sim >= 0.82) score += 1000;
  else if (sim >= 0.72) score += 350;
  return score;
}

function scoreResult(item, query) {
  const variants = titleVariants(item);
  let best = 0;
  let matched = "";
  let matchType = "primary";

  const groups = [
    { values: variants.english, bonus: 500, type: "english" },
    { values: [variants.primary], bonus: 350, type: "primary" },
    { values: variants.aliases, bonus: 300, type: "alias" },
    { values: variants.translations, bonus: 100, type: "translation" },
  ];

  groups.forEach((group) => {
    group.values.forEach((title) => {
      const score = scoreVariant(query, title) + group.bonus;
      if (score > best) {
        best = score;
        matched = title;
        matchType = group.type;
      }
    });
  });

  const firstAired = item?.first_air_time || item?.firstAired || item?.first_air_date || "";
  const year = firstAired ? new Date(firstAired).getFullYear() : 0;
  if (Number.isFinite(year) && year >= 2010) best += 40;
  if (item?.image_url || item?.image) best += 20;

  return { score: best, matched, matchType };
}

function buildSearchTerms(query) {
  const clean = String(query || "").trim();
  const normalized = normalizeText(clean);
  const tokens = normalized.split(" ").filter((token) => token.length >= 3);
  const terms = [clean];

  if (tokens.length > 1) {
    const sorted = [...tokens].sort((a, b) => b.length - a.length);
    terms.push(...sorted.slice(0, 2));
  } else if (normalized.length >= 6) {
    terms.push(normalized.slice(0, 4));
  }

  return uniq(terms).slice(0, 3);
}

async function loginToTvdb() {
  const response = await fetch("https://api4.thetvdb.com/v4/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: process.env.TVDB_API_KEY, pin: process.env.TVDB_PIN }),
  });
  const body = await response.json();
  if (!response.ok || !body?.data?.token) throw new Error("TVDB login failed");
  return body.data.token;
}

async function searchTvdb(token, term) {
  const response = await fetch(
    `https://api4.thetvdb.com/v4/search?query=${encodeURIComponent(term)}&meta=translations`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
  );
  const body = await response.json();
  if (!response.ok) return [];
  return (Array.isArray(body?.data) ? body.data : []).filter(
    (item) => String(item?.type || "").toLowerCase() === "series"
  );
}

async function fetchSeriesDetails(token, id) {
  try {
    const response = await fetch(
      `https://api4.thetvdb.com/v4/series/${id}/extended?language=eng&meta=translations`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Accept-Language": "eng" } }
    );
    const body = await response.json();
    return response.ok && body?.data ? body.data : null;
  } catch {
    return null;
  }
}

function mergeSearchAndDetails(searchItem, details) {
  if (!details) return searchItem;
  return {
    ...details,
    ...searchItem,
    aliases: uniq([...aliasesFor(searchItem), ...aliasesFor(details)]),
    translations: details.translations || searchItem.translations,
    nameTranslations: details.nameTranslations || searchItem.nameTranslations,
    overview: searchItem.overview || details.overview || "",
    image_url: searchItem.image_url || searchItem.image || details.image || null,
    image: searchItem.image || searchItem.image_url || details.image || null,
    firstAired: searchItem.firstAired || searchItem.first_air_time || details.firstAired || null,
  };
}

function normalizeResult(item, query) {
  const ranked = scoreResult(item, query);
  const translations = translationTitles(item);
  const aliases = aliasesFor(item);
  const englishName = translations.english[0] || "";
  const primaryName = item?.name || item?.seriesName || "Unknown title";
  const displayName = englishName || primaryName;
  const exactMatchedAlias = aliases.find(
    (alias) => normalizeText(alias) === normalizeText(query)
  );
  const alternateMatchedTitle =
    ranked.matched && normalizeText(ranked.matched) !== normalizeText(displayName)
      ? ranked.matched
      : null;
  const matchedAlias = exactMatchedAlias || alternateMatchedTitle;

  const companies = Array.isArray(item?.companies) ? item.companies : [];
  const companyName = displayValue(companies[0]);

  return {
    tvdb_id: Number(item?.tvdb_id || item?.id) || null,
    tmdb_id: null,
    name: displayName,
    original_title: primaryName !== displayName ? primaryName : null,
    aliases,
    translated_titles: translations.all,
    matched_alias: matchedAlias || null,
    matched_title: ranked.matched || null,
    match_type: ranked.matchType,
    overview: item?.overview || "",
    first_aired: item?.first_air_time || item?.firstAired || item?.first_air_date || null,
    first_air_time: item?.first_air_time || item?.firstAired || item?.first_air_date || null,
    image_url: item?.image_url || item?.image || null,
    poster_url: item?.image_url || item?.image || null,
    network: displayValue(
      item?.network || item?.originalNetwork || item?.latestNetwork || item?.company
    ) || companyName || null,
    genres: uniq(
      (Array.isArray(item?.genres) ? item.genres : [])
        .map((genre) => displayValue(genre))
        .filter(Boolean)
    ),
    original_language: item?.originalLanguage || item?.language || "",
    source: "tvdb",
    _score: ranked.score,
  };
}

export async function handler(event) {
  try {
    const query = event.queryStringParameters?.q?.trim() || "";
    if (query.length < 2) {
      return { statusCode: 200, body: JSON.stringify([]) };
    }

    const token = await loginToTvdb();
    const terms = buildSearchTerms(query);
    const batches = await Promise.all(terms.map((term) => searchTvdb(token, term)));

    const byId = new Map();
    batches.flat().forEach((item) => {
      const id = Number(item?.tvdb_id || item?.id);
      if (!id || byId.has(id)) return;
      byId.set(id, item);
    });

    const candidates = Array.from(byId.values());
    const initialBatchIds = (batches[0] || [])
      .slice(0, 8)
      .map((item) => Number(item?.tvdb_id || item?.id))
      .filter(Boolean);
    const preliminaryIds = candidates
      .map((item) => ({ id: Number(item?.tvdb_id || item?.id), score: scoreResult(item, query).score }))
      .filter((item) => item.id)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((item) => item.id);
    const detailIds = uniq([...initialBatchIds, ...preliminaryIds]).slice(0, 12);

    const detailEntries = await Promise.all(
      detailIds.map(async (id) => [Number(id), await fetchSeriesDetails(token, id)])
    );
    const detailsById = new Map(detailEntries);

    const results = candidates
      .map((item) => {
        const id = Number(item?.tvdb_id || item?.id);
        return mergeSearchAndDetails(item, detailsById.get(id));
      })
      .map((item) => normalizeResult(item, query))
      .filter((item) => item.tvdb_id && item._score >= 1800)
      .sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        const aYear = a.first_aired ? new Date(a.first_aired).getFullYear() : 0;
        const bYear = b.first_aired ? new Date(b.first_aired).getFullYear() : 0;
        return bYear - aYear;
      })
      .slice(0, 40)
      .map(({ _score, ...item }) => item);

    return {
      statusCode: 200,
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
      body: JSON.stringify(results),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Title search failed", details: error.message }),
    };
  }
}
