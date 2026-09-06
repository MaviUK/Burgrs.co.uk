import { tmdbFetch, buildTmdbImageUrl } from "./_tmdb.js";

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function chooseBestPerson(results, targetName) {
  if (!Array.isArray(results) || !results.length) return null;

  const wanted = normalizeName(targetName);

  return [...results]
    .sort((a, b) => {
      const aName = normalizeName(a?.name);
      const bName = normalizeName(b?.name);

      let aScore = 0;
      let bScore = 0;

      if (aName === wanted) aScore += 100;
      if (bName === wanted) bScore += 100;

      if (a?.known_for_department === "Acting") aScore += 20;
      if (b?.known_for_department === "Acting") bScore += 20;

      aScore += Number(a?.popularity || 0);
      bScore += Number(b?.popularity || 0);

      return bScore - aScore;
    })[0];
}

function dedupeCredits(credits = []) {
  const seen = new Set();

  return credits.filter((item) => {
    const key = String(item?.id || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getYearValue(dateString) {
  if (!dateString) return 0;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getTime();
}

function sortCreditsNewestFirst(credits = []) {
  return [...credits].sort((a, b) => {
    const aDate = getYearValue(a?.first_air_date);
    const bDate = getYearValue(b?.first_air_date);

    if (bDate !== aDate) return bDate - aDate;

    const aPopularity = Number(a?.popularity || 0);
    const bPopularity = Number(b?.popularity || 0);

    return bPopularity - aPopularity;
  });
}

function isValidScriptedShow(item) {
  if (!item?.name) return false;

  const text = [
    item?.name,
    item?.overview,
    item?.character,
    item?.original_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const blocked = [
    "talk show",
    "late show",
    "late night",
    "tonight show",
    "with jimmy",
    "with seth",
    "with stephen",
    "with andy",
    "kelly clarkson show",
    "the view",
    "conan",
    "starralk",
    "carpool karaoke",
    "awards",
    "emmy",
    "ceremony",
    "live with",
    "guest appearance",
    "guest",
    "interview",
    "variety show",
    "reality",
    "competition",
    "game show",
    "news",
    "daytime",
    "telethon",
  ];

  if (blocked.some((phrase) => text.includes(phrase))) return false;

  const character = (item?.character || "").toLowerCase();

  if (
    character.includes("self") ||
    character.includes("himself") ||
    character.includes("herself")
  ) {
    return false;
  }

  return true;
}

export const handler = async (event) => {
  try {
    const name = event.queryStringParameters?.name?.trim();

    if (!name) {
      return jsonResponse(400, { message: "Missing actor name" });
    }

    const personSearch = await tmdbFetch("/search/person", {
      query: name,
      include_adult: "false",
      language: "en-US",
      page: "1",
    });

    const bestPerson = chooseBestPerson(personSearch?.results || [], name);

    if (!bestPerson?.id) {
      return jsonResponse(404, { message: "Actor not found" });
    }

    const [personDetails, tvCreditsResponse] = await Promise.all([
      tmdbFetch(`/person/${bestPerson.id}`, { language: "en-US" }),
      tmdbFetch(`/person/${bestPerson.id}/tv_credits`, {
        language: "en-US",
      }),
    ]);

    const rawCredits = Array.isArray(tvCreditsResponse?.cast)
      ? tvCreditsResponse.cast
      : [];

    const cleanedCredits = sortCreditsNewestFirst(
      dedupeCredits(
        rawCredits
          .filter((item) => item?.id && item?.name)
          .filter(isValidScriptedShow)
          .map((item) => ({
            id: item.id,
            tmdb_id: item.id,
            name: item.name,
            original_name: item.original_name || "",
            overview: item.overview || "",
            first_air_date: item.first_air_date || "",
            first_air_time: item.first_air_date || "",
            poster_path: item.poster_path || "",
            backdrop_path: item.backdrop_path || "",
            poster_url: buildTmdbImageUrl(item.poster_path, "w500"),
            image_url: buildTmdbImageUrl(item.poster_path, "w500"),
            vote_average: Number(item.vote_average || 0),
            vote_count: Number(item.vote_count || 0),
            popularity: Number(item.popularity || 0),
            original_language: item.original_language || "",
            character: item.character || "",
            source: "tmdb",
          }))
      )
    );

    // Actor credits originate from TMDB, so keep the TMDB series ID as the
    // canonical identity here. Mapping every credit to TVDB can create a false
    // saved-state match and can route one title to a different saved show.
    // TVDB mapping still happens later when a show is saved/synced where needed.
    const output = cleanedCredits.map((item) => ({
      id: item.id,
      tmdb_id: item.tmdb_id,
      tvdb_id: null,
      resolved_tvdb_id: null,
      mapped_tvdb_id: null,
      name: item.name || "",
      original_name: item.original_name || "",
      overview: item.overview || "",
      first_air_date: item.first_air_date || null,
      image_url: item.image_url || null,
      poster_url: item.poster_url || null,
      backdrop_url: item.backdrop_path
        ? buildTmdbImageUrl(item.backdrop_path, "original")
        : null,
      rating_average: Number(item.vote_average || 0),
      rating_count: Number(item.vote_count || 0),
      character: item.character || "",
      mapping_status: "tmdb_exact",
      source: "tmdb",
    }));

    return jsonResponse(200, {
      actor: {
        id: personDetails?.id || bestPerson.id,
        name: personDetails?.name || bestPerson.name,
        biography: personDetails?.biography || "",
        birthday: personDetails?.birthday || "",
        place_of_birth: personDetails?.place_of_birth || "",
        profile_url: buildTmdbImageUrl(
          personDetails?.profile_path || bestPerson?.profile_path,
          "w500"
        ),
        known_for_department:
          personDetails?.known_for_department || "Acting",
      },
      credits: output,
    });
  } catch (error) {
    console.error("getActorShows error", error);
    return jsonResponse(500, {
      message: error?.message || "Failed to load actor shows",
    });
  }
};