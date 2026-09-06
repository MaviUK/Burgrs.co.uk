import { supabase } from "./lib/supabase";

const routeCache = new Map();
let scheduled = false;
let activeRouteKey = "";

function getShowRoute() {
  const pathname = window.location.pathname;

  let match = pathname.match(/^\/my-shows\/tmdb\/(\d+)\/?$/);
  if (match) return { saved: true, source: "tmdb", id: match[1], key: `saved:tmdb:${match[1]}` };

  match = pathname.match(/^\/my-shows\/(\d+)\/?$/);
  if (match) return { saved: true, source: "tvdb", id: match[1], key: `saved:tvdb:${match[1]}` };

  match = pathname.match(/^\/show\/tmdb\/(\d+)\/?$/);
  if (match) return { saved: false, source: "tmdb", id: match[1], key: `public:tmdb:${match[1]}` };

  match = pathname.match(/^\/show\/(\d+)\/?$/);
  if (match) return { saved: false, source: "tvdb", id: match[1], key: `public:tvdb:${match[1]}` };

  return null;
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = safeDate(value);
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat(navigator.language || "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

function normalizeEpisode(row, fallbackIndex = 0) {
  const seasonNumber = Number(
    row?.season_number ?? row?.seasonNumber ?? row?.season ?? 0
  );
  const episodeNumber = Number(
    row?.episode_number ?? row?.number ?? row?.episodeNumber ?? fallbackIndex + 1
  );

  return {
    id: row?.id ?? row?.tvdb_id ?? row?.tvdbId ?? `${seasonNumber}-${episodeNumber}-${fallbackIndex}`,
    seasonNumber: Number.isFinite(seasonNumber) ? seasonNumber : 0,
    episodeNumber: Number.isFinite(episodeNumber) ? episodeNumber : fallbackIndex + 1,
    name: row?.name || row?.title || `Episode ${episodeNumber || fallbackIndex + 1}`,
    aired: row?.aired_date || row?.airDate || row?.air_date || row?.aired || null,
  };
}

function episodeCode(episode) {
  if (!episode) return "";
  if (Number(episode.seasonNumber) === 0) {
    return episode.episodeNumber ? `Special ${episode.episodeNumber}` : "Special";
  }
  return `S${String(episode.seasonNumber || 0).padStart(2, "0")}E${String(
    episode.episodeNumber || 0
  ).padStart(2, "0")}`;
}

function sortEpisodes(items) {
  return [...items].sort((a, b) => {
    const seasonDifference = Number(a.seasonNumber || 0) - Number(b.seasonNumber || 0);
    if (seasonDifference !== 0) return seasonDifference;
    return Number(a.episodeNumber || 0) - Number(b.episodeNumber || 0);
  });
}

async function fetchExtras(route) {
  try {
    const url =
      route.source === "tmdb"
        ? `/.netlify/functions/getTmdbShowDetails?tmdbId=${encodeURIComponent(route.id)}`
        : `/.netlify/functions/getShowExtras?tvdbId=${encodeURIComponent(route.id)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.warn("Show page extras unavailable", error);
    return null;
  }
}

function normalizeRemoteEpisodes(extras) {
  if (!extras || typeof extras !== "object") return [];

  if (Array.isArray(extras.episodes) && extras.episodes.length) {
    return extras.episodes.map(normalizeEpisode);
  }

  if (Array.isArray(extras.seasons)) {
    const episodes = [];
    extras.seasons.forEach((season) => {
      const seasonNumber = Number(season?.season_number ?? 0);
      const count = Number(season?.episode_count ?? 0);
      for (let index = 0; index < count; index += 1) {
        episodes.push(
          normalizeEpisode(
            {
              season_number: seasonNumber,
              episode_number: index + 1,
              name: `Episode ${index + 1}`,
              aired_date: season?.air_date || null,
            },
            index
          )
        );
      }
    });
    return episodes;
  }

  return [];
}

function trailerUrlFromExtras(extras) {
  const trailer = extras?.trailer || extras?.show?.trailer || null;
  if (!trailer) return "";
  if (typeof trailer === "string") return trailer;
  if (trailer?.url) return trailer.url;
  if (trailer?.key && String(trailer?.site || "YouTube").toLowerCase() === "youtube") {
    return `https://www.youtube.com/watch?v=${trailer.key}`;
  }
  return "";
}

async function loadDatabaseContext(route) {
  try {
    let query = supabase
      .from("shows")
      .select("id, tvdb_id, tmdb_id, name, status")
      .limit(1);

    query =
      route.source === "tmdb"
        ? query.eq("tmdb_id", Number(route.id))
        : query.eq("tvdb_id", Number(route.id));

    const { data: showRow, error: showError } = await query.maybeSingle();
    if (showError || !showRow?.id) return { episodes: [], watchedIds: new Set() };

    const { data: episodeRows, error: episodeError } = await supabase
      .from("episodes")
      .select("id, season_number, episode_number, name, aired_date")
      .eq("show_id", showRow.id)
      .order("season_number", { ascending: true })
      .order("episode_number", { ascending: true });

    if (episodeError) return { episodes: [], watchedIds: new Set() };

    const episodes = (episodeRows || []).map(normalizeEpisode);
    const watchedIds = new Set();

    if (route.saved && episodes.length) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.id) {
        const ids = episodes.map((episode) => episode.id).filter(Boolean);
        const chunkSize = 100;
        for (let index = 0; index < ids.length; index += chunkSize) {
          const chunk = ids.slice(index, index + chunkSize);
          const { data: watchedRows } = await supabase
            .from("watched_episodes")
            .select("episode_id")
            .eq("user_id", user.id)
            .in("episode_id", chunk);
          (watchedRows || []).forEach((row) => watchedIds.add(String(row.episode_id)));
        }
      }
    }

    return { episodes, watchedIds, showRow };
  } catch (error) {
    console.warn("Show page database context unavailable", error);
    return { episodes: [], watchedIds: new Set() };
  }
}

async function loadRouteContext(route) {
  if (routeCache.has(route.key)) return routeCache.get(route.key);

  const promise = (async () => {
    const [extras, database] = await Promise.all([
      fetchExtras(route),
      loadDatabaseContext(route),
    ]);

    const remoteEpisodes = normalizeRemoteEpisodes(extras);
    const episodes = database.episodes.length ? database.episodes : remoteEpisodes;

    return {
      extras,
      episodes: sortEpisodes(episodes),
      watchedIds: database.watchedIds || new Set(),
      trailerUrl: trailerUrlFromExtras(extras),
    };
  })();

  routeCache.set(route.key, promise);
  return promise;
}

function readStat(labelText) {
  const boxes = Array.from(document.querySelectorAll(".msd-stats-row-top .msd-stat-box"));
  const wanted = String(labelText).toLowerCase();
  const box = boxes.find((item) => {
    const label = item.querySelector(".msd-stat-label")?.textContent?.trim().toLowerCase();
    return label === wanted;
  });
  return box?.querySelector(".msd-stat-value")?.textContent?.trim() || "";
}

function chooseSpotlightEpisode(route, context) {
  const mainEpisodes = context.episodes.filter((episode) => Number(episode.seasonNumber) > 0);
  if (!mainEpisodes.length) return { episode: null, label: "" };

  if (route.saved) {
    const next = mainEpisodes.find(
      (episode) => !context.watchedIds.has(String(episode.id))
    );
    if (next) return { episode: next, label: "Up next" };
    return { episode: mainEpisodes[mainEpisodes.length - 1], label: "Completed" };
  }

  const now = Date.now();
  const upcoming = mainEpisodes.find((episode) => {
    const date = safeDate(episode.aired);
    return date && date.getTime() >= now;
  });
  if (upcoming) return { episode: upcoming, label: "Next episode" };

  const released = mainEpisodes.filter((episode) => {
    const date = safeDate(episode.aired);
    return !date || date.getTime() <= now;
  });
  return {
    episode: released[released.length - 1] || mainEpisodes[mainEpisodes.length - 1],
    label: "Latest episode",
  };
}

function scrollToSeason(seasonNumber) {
  const cards = Array.from(document.querySelectorAll(".msd-season-card"));
  const card = cards.find((item) => {
    const title = item.querySelector(".msd-season-title")?.textContent || "";
    return title.trim().toLowerCase() === `season ${seasonNumber}`.toLowerCase();
  });

  if (!card) return;
  if (!card.querySelector(".msd-episode-list")) {
    card.querySelector(".msd-season-toggle")?.click();
  }
  window.setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}

function buildProgress(context) {
  const mainEpisodes = context.episodes.filter((episode) => Number(episode.seasonNumber) > 0);
  if (!mainEpisodes.length) return null;

  const total = mainEpisodes.length;
  const watched = mainEpisodes.filter((episode) =>
    context.watchedIds.has(String(episode.id))
  ).length;
  const percent = Math.round((watched / total) * 100);
  return { watched, total, percent };
}

function createQuickSpotlight(route, context) {
  const statsRow = document.querySelector(".msd-stats-row-top");
  if (!statsRow || document.querySelector(".burgr-show-spotlight")) return;

  const { episode, label } = chooseSpotlightEpisode(route, context);
  const progress = route.saved ? buildProgress(context) : null;
  const watchedFromPage = readStat("Watched");
  const totalFromPage = readStat("Total");
  const progressFromPage = readStat("Progress");

  if (!episode && !context.trailerUrl && !progress && !progressFromPage) return;

  const card = document.createElement("section");
  card.className = "burgr-show-spotlight";
  card.setAttribute("aria-label", "Show quick information");

  if (episode) {
    const episodeBlock = document.createElement("div");
    episodeBlock.className = "burgr-show-spotlight-main";

    const eyebrow = document.createElement("span");
    eyebrow.className = "burgr-show-spotlight-eyebrow";
    eyebrow.textContent = label;
    episodeBlock.appendChild(eyebrow);

    const title = document.createElement("strong");
    title.className = "burgr-show-spotlight-title";
    title.textContent = `${episodeCode(episode)} · ${episode.name}`;
    episodeBlock.appendChild(title);

    if (episode.aired) {
      const date = document.createElement("span");
      date.className = "burgr-show-spotlight-date";
      date.textContent = formatDate(episode.aired);
      episodeBlock.appendChild(date);
    }

    if (Number(episode.seasonNumber) > 0) {
      const jumpButton = document.createElement("button");
      jumpButton.type = "button";
      jumpButton.className = "burgr-show-spotlight-jump";
      jumpButton.textContent = `Open Season ${episode.seasonNumber}`;
      jumpButton.addEventListener("click", () => {
        const seasonsTab = Array.from(document.querySelectorAll(".msd-content-tab")).find(
          (button) => button.textContent?.trim().toLowerCase() === "seasons"
        );
        seasonsTab?.click();
        window.setTimeout(() => scrollToSeason(episode.seasonNumber), 60);
      });
      episodeBlock.appendChild(jumpButton);
    }

    card.appendChild(episodeBlock);
  }

  if (route.saved && (progress || progressFromPage)) {
    const progressBlock = document.createElement("div");
    progressBlock.className = "burgr-show-progress-block";

    const progressTop = document.createElement("div");
    progressTop.className = "burgr-show-progress-copy";
    const progressLabel = document.createElement("span");
    progressLabel.textContent = "Your progress";
    const progressValue = document.createElement("strong");
    const pagePercentage = Number.parseInt(progressFromPage, 10);
    const percentage = progress?.percent ?? (Number.isFinite(pagePercentage) ? pagePercentage : 0);
    progressValue.textContent = progress
      ? `${progress.watched}/${progress.total} · ${percentage}%`
      : `${watchedFromPage || "0"}/${totalFromPage || "0"} · ${progressFromPage || "0%"}`;
    progressTop.append(progressLabel, progressValue);

    const rail = document.createElement("div");
    rail.className = "burgr-show-progress-rail";
    const fill = document.createElement("div");
    fill.className = "burgr-show-progress-fill";
    fill.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
    rail.appendChild(fill);

    progressBlock.append(progressTop, rail);
    card.appendChild(progressBlock);
  }

  if (context.trailerUrl) {
    const trailer = document.createElement("a");
    trailer.href = context.trailerUrl;
    trailer.target = "_blank";
    trailer.rel = "noreferrer";
    trailer.className = "burgr-show-trailer-button";
    trailer.textContent = "▶ Trailer";
    card.appendChild(trailer);
  }

  statsRow.insertAdjacentElement("afterend", card);
}

function createSeasonPicker(context) {
  const seasonsPanel = document.querySelector(".msd-tab-panel");
  if (!seasonsPanel || document.querySelector(".burgr-season-picker")) return;

  const heading = Array.from(seasonsPanel.querySelectorAll(".msd-section-title")).find(
    (item) => item.textContent?.trim().toLowerCase() === "seasons"
  );
  if (!heading) return;

  const seasonCards = Array.from(seasonsPanel.querySelectorAll(".msd-season-card"));
  const specials = context.episodes.filter((episode) => Number(episode.seasonNumber) === 0);
  if (!seasonCards.length && !specials.length) return;

  const picker = document.createElement("div");
  picker.className = "burgr-season-picker";
  picker.setAttribute("aria-label", "Jump to season");

  seasonCards.forEach((card) => {
    const title = card.querySelector(".msd-season-title")?.textContent?.trim() || "Season";
    const seasonMatch = title.match(/(\d+)/);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "burgr-season-chip";
    button.textContent = title;
    button.addEventListener("click", () => {
      if (!card.querySelector(".msd-episode-list")) {
        card.querySelector(".msd-season-toggle")?.click();
      }
      window.setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
    });
    if (seasonMatch) button.dataset.season = seasonMatch[1];
    picker.appendChild(button);
  });

  if (specials.length) {
    const specialButton = document.createElement("button");
    specialButton.type = "button";
    specialButton.className = "burgr-season-chip";
    specialButton.textContent = `Specials (${specials.length})`;
    specialButton.addEventListener("click", () => {
      document
        .querySelector(".burgr-specials-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    picker.appendChild(specialButton);
  }

  heading.insertAdjacentElement("afterend", picker);

  if (specials.length && !document.querySelector(".burgr-specials-panel")) {
    const seasonsContainer = seasonsPanel.querySelector(".msd-seasons");
    if (!seasonsContainer) return;

    const panel = document.createElement("section");
    panel.className = "msd-season-card burgr-specials-panel";

    const title = document.createElement("div");
    title.className = "msd-season-title";
    title.textContent = "Specials";
    panel.appendChild(title);

    const subtitle = document.createElement("div");
    subtitle.className = "msd-season-subtitle";
    subtitle.textContent = `${specials.length} special${specials.length === 1 ? "" : "s"}`;
    panel.appendChild(subtitle);

    const list = document.createElement("div");
    list.className = "burgr-specials-list";
    specials.slice(0, 16).forEach((episode) => {
      const row = document.createElement("div");
      row.className = "burgr-special-row";
      const name = document.createElement("strong");
      name.textContent = `${episodeCode(episode)} · ${episode.name}`;
      row.appendChild(name);
      if (episode.aired) {
        const date = document.createElement("span");
        date.textContent = formatDate(episode.aired);
        row.appendChild(date);
      }
      list.appendChild(row);
    });
    panel.appendChild(list);
    seasonsContainer.appendChild(panel);
  }
}

function addSectionLabels() {
  document.querySelectorAll(".msd-panel .msd-section-title").forEach((heading) => {
    const text = heading.textContent?.trim().toLowerCase() || "";
    if (text === "recommended shows") heading.textContent = "Similar shows";
  });
}

async function enhanceShowPage() {
  const route = getShowRoute();
  if (!route) {
    activeRouteKey = "";
    return;
  }

  if (activeRouteKey !== route.key) {
    activeRouteKey = route.key;
  }

  const hero = document.querySelector(".msd-page .msd-hero");
  if (!hero) return;

  try {
    const context = await loadRouteContext(route);
    if (getShowRoute()?.key !== route.key) return;

    createQuickSpotlight(route, context);
    createSeasonPicker(context);
    addSectionLabels();
  } catch (error) {
    console.warn("Show page polish failed", error);
  }
}

function scheduleEnhancement() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    enhanceShowPage();
  });
}

const observer = new MutationObserver(scheduleEnhancement);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("pageshow", scheduleEnhancement);
window.addEventListener("popstate", scheduleEnhancement);
document.addEventListener("burgrs:streaming-region", scheduleEnhancement);

scheduleEnhancement();
