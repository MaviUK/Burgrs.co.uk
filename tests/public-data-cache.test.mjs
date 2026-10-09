import test from "node:test";
import assert from "node:assert/strict";
import { createJsonCache, mapConcurrent, withPublicCache } from "../netlify/functions/_publicDataCache.js";

test("public cache supports both function APIs without caching errors or cookies", async () => {
  const policy = { ttl: 300, stale: 60, query: ["q", "region", "page", "sort"] };
  const response = await withPublicCache(async () => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: '{"ok":true}' }), policy)({ httpMethod: "GET" });
  assert.equal(response.headers["netlify-cdn-cache-control"], "public, durable, max-age=300, stale-while-revalidate=60");
  assert.equal(response.headers["netlify-vary"], "query=q|region|page|sort");
  assert.equal(response.body, '{"ok":true}');
  for (const status of [400, 401, 404, 429, 500]) {
    const error = await withPublicCache(async () => ({ statusCode: status, body: "error" }), policy)({ httpMethod: "GET" });
    assert.equal(error.headers["netlify-cdn-cache-control"], "no-store");
    assert.equal(error.headers["cache-control"], "no-store");
    assert.equal(error.headers["netlify-vary"], response.headers["netlify-vary"]);
  }
  const modern = await withPublicCache(async () => Response.json({ ok: true }), policy)(new Request("https://example.test"));
  assert.equal(modern.headers.get("netlify-cdn-cache-control"), response.headers["netlify-cdn-cache-control"]);
  assert.deepEqual(await modern.json(), { ok: true });
  const cookie = await withPublicCache(async () => new Response("private", { headers: { "Set-Cookie": "session=private" } }), policy)(new Request("https://example.test"));
  assert.equal(cookie.headers.get("netlify-cdn-cache-control"), "no-store");
});

test("writes never invoke public readers and OPTIONS stays uncached", async () => {
  let calls = 0;
  const handler = withPublicCache(async () => { calls++; return { statusCode: 204, body: "" }; });
  for (const httpMethod of ["POST", "PUT", "DELETE", "PATCH"]) {
    assert.equal((await handler({ httpMethod })).statusCode, 405);
  }
  assert.equal(calls, 0);
  const options = await handler({ httpMethod: "OPTIONS" });
  assert.equal(options.statusCode, 204);
  assert.equal(options.headers["netlify-cdn-cache-control"], "no-store");
});

test("simultaneous JSON requests coalesce and callers receive independent objects", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return Response.json({ value: 1 }); });
  const fetchJson = createJsonCache();
  const [a, b] = await Promise.all([fetchJson("https://example.test/a"), fetchJson("https://example.test/a")]);
  a.value = 5;
  assert.equal(b.value, 1);
  assert.equal((await fetchJson("https://example.test/a")).value, 1);
  assert.equal(calls, 1);
});

test("failed requests can recover on the next call", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? Response.json({ message: "busy" }, { status: 429 }) : Response.json({ ok: true }));
  const fetchJson = createJsonCache();
  await assert.rejects(fetchJson("https://example.test/a"), /busy/);
  assert.deepEqual(await fetchJson("https://example.test/a"), { ok: true });
  assert.equal(calls, 2);
});

test("JSON caches expire and evict entries within entry and byte limits", async (t) => {
  let now = 1000, calls = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ value: 1 }); });
  const fetchJson = createJsonCache({ ttl: 10, maxEntries: 1 });
  await fetchJson("a"); await fetchJson("a"); assert.equal(calls, 1);
  now += 11;
  await fetchJson("a"); assert.equal(calls, 2);
  await fetchJson("b"); await fetchJson("a"); assert.equal(calls, 4);
  const tooSmall = createJsonCache({ maxBytes: 2 });
  await tooSmall("a"); await tooSmall("a"); assert.equal(calls, 6);
});

test("upstream fetches have a deadline", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    assert.ok(signal instanceof AbortSignal);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
    return Response.json({});
  });
  await assert.rejects(createJsonCache({ timeout: 5 })("a"), { name: "TimeoutError" });
});

test("bounded mapping preserves ordering and propagates failures", async () => {
  let active = 0, peak = 0;
  const results = await mapConcurrent(Array.from({ length: 30 }, (_, i) => i), async value => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return value * 2;
  });
  assert.equal(peak, 4);
  assert.deepEqual(results, Array.from({ length: 30 }, (_, i) => i * 2));
  await assert.rejects(mapConcurrent([1], async () => { throw new Error("failed"); }), /failed/);
});

test("advanced sorting and pagination preserve GB/US availability with four requests at once", async (t) => {
  const previousKey = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = "test-key";
  t.after(() => {
    if (previousKey === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = previousKey;
  });
  let active = 0, peak = 0, genresCalls = 0;
  t.mock.method(globalThis, "fetch", async rawUrl => {
    const url = new URL(rawUrl);
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    if (url.pathname.endsWith("/genre/tv/list")) { genresCalls++; return Response.json({ genres: [{ id: 18, name: "Drama" }] }); }
    if (url.pathname.endsWith("/watch/providers/tv")) return Response.json({ results: [{ provider_id: 8, provider_name: "Netflix" }, { provider_id: 15, provider_name: "Hulu" }] });
    if (url.pathname.endsWith("/search/tv")) {
      const page = Number(url.searchParams.get("page"));
      return Response.json({ total_pages: 2, total_results: 40, results: Array.from({ length: 20 }, (_, i) => ({ id: (page - 1) * 20 + i + 1, name: "Example", first_air_date: "2026-01-01", vote_average: ((page - 1) * 20 + i + 1) / 4, genre_ids: [18] })) });
    }
    return Response.json({ production_companies: [], "watch/providers": { results: { GB: { flatrate: [{ provider_id: 8, provider_name: "Netflix" }] }, US: { flatrate: [{ provider_id: 15, provider_name: "Hulu" }] } } } });
  });
  const { handler } = await import("../netlify/functions/advancedSearchShows.js");
  const run = async (page, region) => {
    const response = await handler({ httpMethod: "GET", queryStringParameters: { title: "Example", sort: "highest-rated", page: String(page), region } });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["netlify-vary"], /region/);
    return JSON.parse(response.body);
  };
  const gb = await run(1, "GB"), us = await run(1, "US"), next = await run(2, "GB");
  assert.equal(gb.results.length, 20);
  assert.equal(gb.results[0].tmdb_id, 40);
  assert.equal(next.results[0].tmdb_id, 20);
  assert.equal(gb.results[0].platform, "Netflix");
  assert.equal(us.results[0].platform, "Hulu");
  const filtered = await handler({ httpMethod: "GET", queryStringParameters: { title: "Example", genre: "Drama", year: "2026", platform: "Netflix", region: "GB", sort: "highest-rated" } });
  assert.equal(filtered.statusCode, 200);
  assert.equal(JSON.parse(filtered.body).totalResults, 40);
  assert.equal(JSON.parse(filtered.body).results[0].tmdb_id, 40);
  assert.equal(genresCalls, 1);
  assert.ok(peak <= 4);
});

test("all public endpoints reject writes before touching providers or the database", async () => {
  const names = ["getTrendingShows", "advancedSearchShows", "genreSearchShows", "studioCatalogueSearch", "studioSearchShows", "searchShows", "smartTitleSearch", "getPremieringSoonShows", "getShowDetails", "getShowEpisodes", "getShowExtras", "getTmdbShowDetails", "getTmdbShowEpisodes", "getTmdbWatchProviders", "getStreamingProviderShows"];
  for (const name of names) {
    const module = await import(`../netlify/functions/${name}.js`);
    const modern = name === "getStreamingProviderShows";
    const response = await (modern ? module.default : module.handler)(modern ? new Request("https://example.test", { method: "POST" }) : { httpMethod: "POST" });
    assert.equal(modern ? response.status : response.statusCode, 405, name);
  }
});
