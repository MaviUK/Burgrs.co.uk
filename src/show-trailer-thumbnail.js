let scheduled = false;
const trailerCache = new Map();

function getRoute() {
  const pathname = window.location.pathname;

  let match = pathname.match(/^\/my-shows\/tmdb\/(\d+)\/?$/);
  if (match) return { source: "tmdb", id: match[1], key: `tmdb:${match[1]}` };

  match = pathname.match(/^\/my-shows\/(\d+)\/?$/);
  if (match) return { source: "tvdb", id: match[1], key: `tvdb:${match[1]}` };

  match = pathname.match(/^\/show\/tmdb\/(\d+)\/?$/);
  if (match) return { source: "tmdb", id: match[1], key: `tmdb:${match[1]}` };

  match = pathname.match(/^\/show\/(\d+)\/?$/);
  if (match) return { source: "tvdb", id: match[1], key: `tvdb:${match[1]}` };

  return null;
}

function readTrailerUrl(payload) {
  const trailer = payload?.trailer || payload?.show?.trailer || null;
  if (!trailer) return "";
  if (typeof trailer === "string") return trailer;
  if (trailer?.url) return trailer.url;
  if (trailer?.key) return `https://www.youtube.com/watch?v=${trailer.key}`;
  return "";
}

async function getTrailerUrl(route) {
  if (trailerCache.has(route.key)) return trailerCache.get(route.key);

  const promise = (async () => {
    try {
      const endpoint = route.source === "tmdb"
        ? `/.netlify/functions/getTmdbShowDetails?tmdbId=${encodeURIComponent(route.id)}`
        : `/.netlify/functions/getShowExtras?tvdbId=${encodeURIComponent(route.id)}`;
      const response = await fetch(endpoint);
      if (!response.ok) return "";
      return readTrailerUrl(await response.json());
    } catch (error) {
      console.warn("Trailer lookup failed", error);
      return "";
    }
  })();

  trailerCache.set(route.key, promise);
  return promise;
}

async function enhanceTrailer() {
  const route = getRoute();
  if (!route) return;

  const thumb = document.querySelector(".msd-page .msd-mobile-thumb");
  const topRow = thumb?.closest?.(".msd-mobile-top-row");
  if (!thumb || !topRow) return;

  const trailerUrl = await getTrailerUrl(route);
  if (getRoute()?.key !== route.key) return;

  let button = topRow.querySelector(".burgr-thumb-trailer");

  if (!trailerUrl) {
    button?.remove();
    topRow.classList.remove("burgr-has-thumb-trailer");
    return;
  }

  if (!button) {
    button = document.createElement("a");
    button.className = "burgr-thumb-trailer";
    button.target = "_blank";
    button.rel = "noreferrer";
    button.setAttribute("aria-label", "Watch trailer");

    const icon = document.createElement("span");
    icon.className = "burgr-thumb-trailer-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "▶";

    const label = document.createElement("span");
    label.className = "burgr-thumb-trailer-label";
    label.textContent = "Trailer";

    button.append(icon, label);
    thumb.insertAdjacentElement("afterend", button);
  }

  button.href = trailerUrl;
  topRow.classList.add("burgr-has-thumb-trailer");
}

function scheduleEnhancement() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    enhanceTrailer();
  });
}

const observer = new MutationObserver(scheduleEnhancement);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("pageshow", scheduleEnhancement);
window.addEventListener("popstate", scheduleEnhancement);

scheduleEnhancement();
