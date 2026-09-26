import { persistDiscoveryShows } from "./_persistDiscoveryShows.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(statusCode, body, cacheControl = "no-store") {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheControl,
      ...CORS_HEADERS,
    },
    body: JSON.stringify(body),
  };
}

async function fetchExternalIds(tmdbId) {
  const res = await fetch(
    `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids`,
    {
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${process.env.TMDB_BEARER_TOKEN}`,
      },
    }
  );

  if (!res.ok) return null;

  return res.json();
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
    const res = await fetch(
      "https://api.themoviedb.org/3/trending/tv/week?language=en-US",
      {
        headers: {
          accept: "application/json",
          Authorization: `Bearer ${process.env.TMDB_BEARER_TOKEN}`,
        },
      }
    );

    const json = await res.json();

    if (!res.ok) {
      return jsonResponse(res.status, json);
    }

    const baseShows = json.results || [];

    const shows = (
      await Promise.all(
        baseShows.map(async (show) => {
          const externalIds = await fetchExternalIds(show.id);

          return {
            id: show.id,
            tmdb_id: show.id,
            tvdb_id: externalIds?.tvdb_id || null,
            name: show.name || "Unknown title",
            image: show.poster_path
              ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
              : null,
            overview: show.overview || "",
            first_air_date: show.first_air_date || null,
            year: show.first_air_date ? show.first_air_date.slice(0, 4) : null,
            vote_average: Number(show.vote_average || 0) || null,
            vote_count: Number(show.vote_count || 0) || null,
          };
        })
      )
    ).filter((show) => show.tvdb_id);

    let persistence = null;
    try {
      persistence = await persistDiscoveryShows(shows);
    } catch (persistError) {
      console.error("Failed to persist trending shows", persistError);
    }

    return jsonResponse(200, { shows, persistence });
  } catch (error) {
    return jsonResponse(500, {
      message: error.message || "Failed to load TMDB trending shows",
    });
  }
}
