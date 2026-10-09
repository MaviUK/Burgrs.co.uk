// Only wrap endpoints whose response is public and independent of the viewer.
export function withPublicCache(handler, { ttl = 300, stale = 300, query = [] } = {}) {
  const vary = query.length ? `query=${query.join("|")}` : "query";
  return async (request, context) => {
    const method = request.httpMethod || request.method || "GET";
    if (!["GET", "OPTIONS"].includes(method)) {
      const headers = { "Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store", "Netlify-Vary": vary, Allow: "GET, OPTIONS" };
      return request instanceof Request
        ? Response.json({ error: "Method not allowed" }, { status: 405, headers })
        : { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
    }
    const response = await handler(request, context);
    const status = response instanceof Response ? response.status : response.statusCode;
    const headers = new Headers(response.headers || {});
    const canCache = method === "GET" && status === 200 && !headers.has("set-cookie");
    headers.set("Cache-Control", canCache ? "public, max-age=0, must-revalidate" : "no-store");
    headers.set("Netlify-CDN-Cache-Control", canCache
      ? `public, durable, max-age=${ttl}, stale-while-revalidate=${stale}`
      : "no-store");
    headers.set("Netlify-Vary", vary);
    if (response instanceof Response) {
      return new Response(response.body, { status, statusText: response.statusText, headers });
    }
    return { ...response, headers: Object.fromEntries(headers) };
  };
}

// Per-instance cache supplements CDN caching for shared genres and show details.
// Failed requests are never retained. Memory and pending coalescing are bounded.
export function createJsonCache({ ttl = 300000, maxEntries = 128, maxBytes = 8 * 1024 * 1024, timeout = 10000 } = {}) {
  const cached = new Map();
  const pending = new Map();
  let bytes = 0;
  function remove(key) {
    const entry = cached.get(key);
    if (entry) bytes -= entry.bytes;
    cached.delete(key);
  }
  return async (url) => {
    const entry = cached.get(url);
    if (entry && entry.expires > Date.now()) return JSON.parse(entry.text);
    remove(url);
    if (pending.has(url)) return JSON.parse(await pending.get(url));
    const task = (async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.status_message || data?.message || `TV data request failed (${response.status})`);
      const text = JSON.stringify(data);
      const size = new TextEncoder().encode(text).byteLength;
      if (size <= maxBytes) {
        for (const [key, value] of cached) if (value.expires <= Date.now()) remove(key);
        while (cached.size && (cached.size >= maxEntries || bytes + size > maxBytes)) remove(cached.keys().next().value);
        cached.set(url, { text, bytes: size, expires: Date.now() + ttl });
        bytes += size;
      }
      return text;
    })();
    const tracked = pending.size < maxEntries;
    if (tracked) pending.set(url, task);
    try { return JSON.parse(await task); }
    finally { if (tracked) pending.delete(url); }
  };
}

export async function mapConcurrent(items, mapper, concurrency = 4) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}
