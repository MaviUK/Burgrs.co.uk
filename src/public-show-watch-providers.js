const publicWatchCache = new Map();
let publicWatchScheduled = false;

function getPublicShowRoute() {
  const pathname = window.location.pathname;
  const tmdbMatch = pathname.match(/^\/show\/tmdb\/(\d+)\/?$/);
  if (tmdbMatch) return { type: "tmdb", id: tmdbMatch[1], key: `tmdb:${tmdbMatch[1]}` };

  const tvdbMatch = pathname.match(/^\/show\/(\d+)\/?$/);
  if (tvdbMatch) return { type: "tvdb", id: tvdbMatch[1], key: `tvdb:${tvdbMatch[1]}` };

  return null;
}

function normalizeTmdbProviders(payload) {
  if (!payload || typeof payload !== "object") {
    return { flatrate: [], buy: [], rent: [], link: null };
  }

  return {
    flatrate: Array.isArray(payload.flatrate) ? payload.flatrate : [],
    buy: Array.isArray(payload.buy) ? payload.buy : [],
    rent: Array.isArray(payload.rent) ? payload.rent : [],
    link: payload.link || null,
  };
}

function normalizeTvdbProviders(payload) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];

  return {
    flatrate: providers.map((provider) => ({
      provider_id: provider.id,
      provider_name: provider.name,
      absolute_logo_url: provider.logo || null,
    })),
    buy: [],
    rent: [],
    link: null,
  };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Provider request failed (${response.status})`);
  return response.json();
}

async function loadPublicWatchProviders(route) {
  if (publicWatchCache.has(route.key)) return publicWatchCache.get(route.key);

  let result;

  if (route.type === "tmdb") {
    const payload = await fetchJson(
      `/.netlify/functions/getTmdbWatchProviders?tmdbId=${encodeURIComponent(
        route.id
      )}&country=GB`
    );
    result = normalizeTmdbProviders(payload);
  } else {
    const extras = await fetchJson(
      `/.netlify/functions/getShowExtras?tvdbId=${encodeURIComponent(route.id)}`
    );
    const mappedTmdbId = extras?.debug?.tmdbId || null;

    if (mappedTmdbId) {
      try {
        const payload = await fetchJson(
          `/.netlify/functions/getTmdbWatchProviders?tmdbId=${encodeURIComponent(
            mappedTmdbId
          )}&country=GB`
        );
        result = normalizeTmdbProviders(payload);
      } catch (error) {
        console.warn("Failed loading full watch providers", error);
        result = normalizeTvdbProviders(extras);
      }
    } else {
      result = normalizeTvdbProviders(extras);
    }
  }

  publicWatchCache.set(route.key, result);
  return result;
}

function providerLogoUrl(provider) {
  if (provider?.absolute_logo_url) return provider.absolute_logo_url;
  if (provider?.logo_path) {
    return `https://image.tmdb.org/t/p/w185${provider.logo_path}`;
  }
  return null;
}

function allProviders(providerGroups) {
  const seen = new Set();
  return [
    ...(providerGroups.flatrate || []),
    ...(providerGroups.buy || []),
    ...(providerGroups.rent || []),
  ].filter((provider) => {
    const key = String(provider?.provider_id || provider?.provider_name || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createProviderCard(provider) {
  const providerName = provider?.provider_name || "Streaming provider";
  const providerId = provider?.provider_id || "provider";
  const card = document.createElement("a");
  const params = new URLSearchParams();

  if (provider?.provider_name) {
    params.set("name", provider.provider_name);
  }

  card.href = `/streaming/${encodeURIComponent(providerId)}${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  card.className = "public-watch-provider-card";
  card.title = `Browse ${providerName}`;
  card.setAttribute("aria-label", `Browse TV shows on ${providerName}`);

  const logoUrl = providerLogoUrl(provider);
  if (logoUrl) {
    const image = document.createElement("img");
    image.src = logoUrl;
    image.alt = providerName;
    image.className = "public-watch-provider-logo";
    card.appendChild(image);
  }

  const name = document.createElement("span");
  name.textContent = providerName;
  card.appendChild(name);

  return card;
}

function createWatchDropdown(providerGroups) {
  const dropdown = document.createElement("div");
  dropdown.className = "public-watch-dropdown";
  dropdown.hidden = true;

  const sections = [
    ["Stream", providerGroups.flatrate],
    ["Buy", providerGroups.buy],
    ["Rent", providerGroups.rent],
  ];

  const availableSections = sections.filter(
    ([, providers]) => Array.isArray(providers) && providers.length > 0
  );

  if (availableSections.length === 0) {
    const empty = document.createElement("p");
    empty.className = "public-watch-empty";
    empty.textContent = "No UK streaming information available yet.";
    dropdown.appendChild(empty);
    return dropdown;
  }

  availableSections.forEach(([label, providers]) => {
    const section = document.createElement("section");
    section.className = "public-watch-section";

    const heading = document.createElement("h3");
    heading.textContent = label;
    section.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "public-watch-provider-grid";
    providers.forEach((provider) => grid.appendChild(createProviderCard(provider)));
    section.appendChild(grid);
    dropdown.appendChild(section);
  });


  return dropdown;
}

function removePublicWatchUi() {
  document.querySelectorAll(".public-watch-stat, .public-watch-dropdown").forEach((item) =>
    item.remove()
  );
  document
    .querySelectorAll(".public-watch-stats-row")
    .forEach((row) => row.classList.remove("public-watch-stats-row"));
}

async function enhancePublicShowWatch() {
  const route = getPublicShowRoute();
  if (!route) {
    removePublicWatchUi();
    return;
  }

  const statsRow = document.querySelector(
    ".msd-page .msd-stats-row.msd-stats-row-four"
  );
  if (!statsRow || statsRow.querySelector(".public-watch-stat")) return;
  if (statsRow.dataset.publicWatchLoading === route.key) return;

  statsRow.dataset.publicWatchLoading = route.key;

  let providerGroups;
  try {
    providerGroups = await loadPublicWatchProviders(route);
  } catch (error) {
    console.error("Failed loading public show watch providers", error);
    providerGroups = { flatrate: [], buy: [], rent: [], link: null };
  }

  if (getPublicShowRoute()?.key !== route.key || !statsRow.isConnected) return;

  const providers = allProviders(providerGroups);
  const featuredProvider = providers[0] || null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "msd-stat-box msd-watch-stat-box public-watch-stat";
  button.setAttribute("aria-expanded", "false");

  const label = document.createElement("span");
  label.className = "msd-stat-label";
  label.textContent = "Watch";
  button.appendChild(label);

  const featuredLogo = providerLogoUrl(featuredProvider);
  if (featuredLogo) {
    const image = document.createElement("img");
    image.src = featuredLogo;
    image.alt = featuredProvider.provider_name || "Streaming provider";
    image.className = "msd-watch-stat-logo";
    button.appendChild(image);
  } else {
    const value = document.createElement("strong");
    value.className = "msd-stat-value";
    value.textContent = "—";
    button.appendChild(value);
  }

  const dropdown = createWatchDropdown(providerGroups);
  button.addEventListener("click", () => {
    dropdown.hidden = !dropdown.hidden;
    button.classList.toggle("is-open", !dropdown.hidden);
    button.setAttribute("aria-expanded", String(!dropdown.hidden));
  });

  statsRow.classList.add("public-watch-stats-row");
  statsRow.appendChild(button);
  statsRow.insertAdjacentElement("afterend", dropdown);
  delete statsRow.dataset.publicWatchLoading;
}

function schedulePublicShowWatch() {
  if (publicWatchScheduled) return;
  publicWatchScheduled = true;
  window.requestAnimationFrame(() => {
    publicWatchScheduled = false;
    enhancePublicShowWatch();
  });
}

const publicWatchObserver = new MutationObserver(schedulePublicShowWatch);
publicWatchObserver.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", schedulePublicShowWatch);
window.addEventListener("pageshow", schedulePublicShowWatch);
schedulePublicShowWatch();
