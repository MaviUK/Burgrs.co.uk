export async function handler(event) {
  try {
    const tmdbId = event.queryStringParameters?.tmdbId;

    if (!tmdbId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Missing tmdbId" }),
      };
    }

    if (!process.env.TMDB_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Missing TMDB API key" }),
      };
    }

    const response = await fetch(
      `https://api.themoviedb.org/3/tv/${encodeURIComponent(
        tmdbId
      )}?api_key=${process.env.TMDB_API_KEY}&language=en-GB&append_to_response=credits,external_ids,videos,recommendations`
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          message: data?.status_message || "Failed to fetch TMDB show",
        }),
      };
    }

    const videos = Array.isArray(data?.videos?.results) ? data.videos.results : [];
    const trailerCandidate =
      videos.find(
        (video) =>
          video?.site === "YouTube" &&
          video?.type === "Trailer" &&
          video?.official
      ) ||
      videos.find(
        (video) => video?.site === "YouTube" && video?.type === "Trailer"
      ) ||
      videos.find((video) => video?.site === "YouTube" && video?.type === "Teaser") ||
      null;

    const trailer = trailerCandidate?.key
      ? {
          name: trailerCandidate.name || "Watch Trailer",
          url: `https://www.youtube.com/watch?v=${trailerCandidate.key}`,
          key: trailerCandidate.key,
          site: trailerCandidate.site,
        }
      : null;

    const recommendations = Array.isArray(data?.recommendations?.results)
      ? data.recommendations.results.slice(0, 16).map((item) => ({
          id: item?.id || null,
          tmdb_id: item?.id || null,
          name: item?.name || item?.original_name || "Unknown show",
          overview: item?.overview || "",
          first_air_date: item?.first_air_date || null,
          poster_path: item?.poster_path || null,
          poster_url: item?.poster_path
            ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
            : null,
          backdrop_path: item?.backdrop_path || null,
        }))
      : [];

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
      },
      body: JSON.stringify({
        id: data.id,
        tmdb_id: data.id,
        tvdb_id: data.external_ids?.tvdb_id || null,
        name: data.name,
        overview: data.overview || "",
        first_air_date: data.first_air_date || null,
        number_of_seasons: data.number_of_seasons || 0,
        number_of_episodes: data.number_of_episodes || 0,
        vote_average: data.vote_average || null,
        status: data.status || null,
        original_language: data.original_language || null,
        poster_url: data.poster_path
          ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
          : null,
        backdrop_url: data.backdrop_path
          ? `https://image.tmdb.org/t/p/original${data.backdrop_path}`
          : null,
        seasons: Array.isArray(data.seasons) ? data.seasons : [],
        networks: Array.isArray(data.networks) ? data.networks : [],
        genres: Array.isArray(data.genres) ? data.genres : [],
        cast: Array.isArray(data?.credits?.cast) ? data.credits.cast.slice(0, 20) : [],
        crew: Array.isArray(data?.credits?.crew) ? data.credits.crew.slice(0, 20) : [],
        trailer,
        recommendations,
      }),
    };
  } catch (error) {
    console.error("getTmdbShowDetails error", error);

    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Server error" }),
    };
  }
}
