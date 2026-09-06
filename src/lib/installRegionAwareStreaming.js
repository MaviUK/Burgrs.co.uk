const REGION_SESSION_KEY = "burgrs_streaming_region_v1";

function normalizeCountry(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function localeCountryFallback() {
  const locales = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ].filter(Boolean);

  for (const locale of locales) {
    const match = String(locale).match(/[-_]([A-Za-z]{2})(?:$|[-_])/);
    if (match) return normalizeCountry(match[1]);

    const simpleParts = String(locale).split(/[-_]/);
    if (simpleParts.length >= 2) {
      const code = normalizeCountry(simpleParts[simpleParts.length - 1]);
      if (code) return code;
    }
  }

  return "GB";
}

function countryLabel(country) {
  try {
    const displayNames = new Intl.DisplayNames(
      [navigator.language || "en-GB"],
      { type: "region" }
    );
    return displayNames.of(country) || country;
  } catch {
    return country;
  }
}

function applyRegionCopy(country) {
  const label = countryLabel(country);

  document.querySelectorAll(".search-mode-help").forEach((element) => {
    const text = element.textContent || "";
    if (text.includes("UK streaming availability")) {
      element.textContent = `Platform results use ${label} streaming availability.`;
    }
  });

  document.querySelectorAll(".public-watch-empty").forEach((element) => {
    const text = element.textContent || "";
    if (text.includes("UK streaming information")) {
      element.textContent = `No streaming information is available in ${label} yet.`;
    }
  });
}

function isTargetFunction(url) {
  return (
    url.pathname.endsWith("/.netlify/functions/getTmdbWatchProviders") ||
    url.pathname.endsWith("/.netlify/functions/advancedSearchShows")
  );
}

function rewriteRegionalUrl(input, country) {
  if (typeof input !== "string" && !(input instanceof URL)) return input;

  const original = String(input);
  let url;
  try {
    url = new URL(original, window.location.origin);
  } catch {
    return input;
  }

  if (url.origin !== window.location.origin || !isTargetFunction(url)) {
    return input;
  }

  if (url.pathname.endsWith("/.netlify/functions/getTmdbWatchProviders")) {
    url.searchParams.set("country", country);
  }

  if (url.pathname.endsWith("/.netlify/functions/advancedSearchShows")) {
    url.searchParams.set("region", country);
  }

  return url.toString();
}

export function installRegionAwareStreaming() {
  if (window.__BURGRS_REGION_AWARE_STREAMING_INSTALLED__) return;
  window.__BURGRS_REGION_AWARE_STREAMING_INSTALLED__ = true;

  const originalFetch = window.fetch.bind(window);
  let cachedCountry = "";

  try {
    cachedCountry = normalizeCountry(sessionStorage.getItem(REGION_SESSION_KEY));
  } catch {
    cachedCountry = "";
  }

  const regionPromise = (async () => {
    let country = cachedCountry;

    if (!country) {
      try {
        const response = await originalFetch("/.netlify/functions/getUserRegion", {
          cache: "no-store",
        });
        if (response.ok) {
          const payload = await response.json();
          country = normalizeCountry(payload?.country);
        }
      } catch {
        // Fall back to browser locale below.
      }
    }

    if (!country) country = localeCountryFallback();

    try {
      sessionStorage.setItem(REGION_SESSION_KEY, country);
    } catch {
      // Session storage is optional.
    }

    window.__BURGRS_STREAMING_REGION__ = country;
    applyRegionCopy(country);

    document.dispatchEvent(
      new CustomEvent("burgrs:streaming-region", {
        detail: { country, label: countryLabel(country) },
      })
    );

    return country;
  })();

  window.fetch = async function regionAwareFetch(input, init) {
    let parsedUrl = null;
    if (typeof input === "string" || input instanceof URL) {
      try {
        parsedUrl = new URL(String(input), window.location.origin);
      } catch {
        parsedUrl = null;
      }
    }

    if (parsedUrl && parsedUrl.origin === window.location.origin && isTargetFunction(parsedUrl)) {
      const country = await regionPromise;
      input = rewriteRegionalUrl(input, country);
    }

    return originalFetch(input, init);
  };

  const observer = new MutationObserver(() => {
    const country = window.__BURGRS_STREAMING_REGION__;
    if (country) applyRegionCopy(country);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}
