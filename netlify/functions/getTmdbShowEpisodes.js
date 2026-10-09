import { withPublicCache } from "./_publicDataCache.js";
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

async function fetchJsonWithTimeout(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.status_message || data?.message || `TMDB request failed: ${response.status}`
      );
    }

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function mapInBatches(items, batchSize, mapper) {
  const results = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const batchResults = await Promise.all(batch.map(mapper));
    results.push(...batchResults);
  }

  return results;
}

function dedupeEpisodes(episodes) {
  const byEpisode = new Map();

  for (const episode of episodes) {
    const seasonNumber = Number(episode?.seasonNumber ?? -1);
    const episodeNumber = Number(episode?.number ?? -1);

    if (seasonNumber < 0 || episodeNumber <= 0) continue;

    byEpisode.set(`${seasonNumber}|${episodeNumber}`, episode);
  }

  return [...byEpisode.values()].sort((a, b) => {
    const seasonDifference = Number(a.seasonNumber) - Number(b.seasonNumber);
    if (seasonDifference !== 0) return seasonDifference;
    return Number(a.number) - Number(b.number);
  });
}

async function handleRequest(event) {
  try {
    const tmdbId = Number(event.queryStringParameters?.tmdbId);

    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return jsonResponse(400, { message: "Missing or invalid tmdbId" });
    }

    if (!process.env.TMDB_API_KEY) {
      return jsonResponse(500, { message: "Missing TMDB_API_KEY environment variable" });
    }

    const apiKey = encodeURIComponent(process.env.TMDB_API_KEY);
    const showDetails = await fetchJsonWithTimeout(
      `https://api.themoviedb.org/3/tv/${encodeURIComponent(
        tmdbId
      )}?api_key=${apiKey}&language=en-GB`,
      20000
    );

    const seasons = (Array.isArray(showDetails?.seasons) ? showDetails.seasons : [])
      .filter((season) => {
        const seasonNumber = Number(season?.season_number);
        const episodeCount = Number(season?.episode_count ?? 0);
        return Number.isFinite(seasonNumber) && seasonNumber >= 0 && episodeCount > 0;
      })
      .sort((a, b) => Number(a.season_number) - Number(b.season_number));

    const seasonEpisodeGroups = await mapInBatches(seasons, 6, async (season) => {
      const seasonNumber = Number(season.season_number);
      const seasonDetails = await fetchJsonWithTimeout(
        `https://api.themoviedb.org/3/tv/${encodeURIComponent(
          tmdbId
        )}/season/${encodeURIComponent(
          seasonNumber
        )}?api_key=${apiKey}&language=en-GB`,
        20000
      );

      const episodes = Array.isArray(seasonDetails?.episodes)
        ? seasonDetails.episodes
        : [];

      return episodes.map((episode) => {
        const episodeNumber = Number(episode?.episode_number ?? 0);
        const stillPath = episode?.still_path || null;

        return {
          tmdb_episode_id: episode?.id ?? null,
          seasonNumber,
          season_number: seasonNumber,
          number: episodeNumber,
          episode_number: episodeNumber,
          name: episode?.name || `Episode ${episodeNumber}`,
          overview: episode?.overview || null,
          aired: episode?.air_date || null,
          aired_date: episode?.air_date || null,
          runtime: episode?.runtime ?? null,
          runtime_minutes: episode?.runtime ?? null,
          image: stillPath
            ? `https://image.tmdb.org/t/p/w500${stillPath}`
            : null,
          image_url: stillPath
            ? `https://image.tmdb.org/t/p/w500${stillPath}`
            : null,
          tmdb_still_path: stillPath,
          tmdb_vote_average: episode?.vote_average ?? null,
          tmdb_vote_count: episode?.vote_count ?? null,
          isPremiere: episodeNumber === 1,
          is_premiere: episodeNumber === 1,
          isFinale:
            episodeNumber > 0 &&
            episodeNumber === Number(season?.episode_count ?? episodes.length),
          is_finale:
            episodeNumber > 0 &&
            episodeNumber === Number(season?.episode_count ?? episodes.length),
          is_special: seasonNumber === 0,
        };
      });
    });

    const episodes = dedupeEpisodes(seasonEpisodeGroups.flat());

    return jsonResponse(200, {
      episodes,
      meta: {
        tmdb_id: tmdbId,
        seasonsFetched: seasons.length,
        episodeCount: episodes.length,
        expectedEpisodeCount: Number(showDetails?.number_of_episodes ?? episodes.length),
      },
    });
  } catch (error) {
    console.error("getTmdbShowEpisodes error", error);

    return jsonResponse(500, {
      message: "Failed to fetch complete TMDB episodes",
      details: error?.message || String(error),
    });
  }
}

export const handler = withPublicCache(handleRequest, {"ttl":900,"stale":120,"query":["tmdbId"]});
