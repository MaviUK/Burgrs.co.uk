import { withPublicCache } from "./_publicDataCache.js";
async function handleRequest(event) {
  try {
    const tmdbId = event.queryStringParameters?.tmdbId;
    const country = event.queryStringParameters?.country || "GB";

    if (!tmdbId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing tmdbId" }),
      };
    }

    const apiKey = process.env.TMDB_API_KEY;

    const res = await fetch(
      `https://api.themoviedb.org/3/tv/${tmdbId}/watch/providers?api_key=${apiKey}`
    );

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: "Failed to fetch providers" }),
      };
    }

    const data = await res.json();
    const countryData = data?.results?.[country] || null;

    return {
      statusCode: 200,
      body: JSON.stringify(countryData),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

export const handler = withPublicCache(handleRequest, {"ttl":1800,"stale":300,"query":["tmdbId","country"]});
