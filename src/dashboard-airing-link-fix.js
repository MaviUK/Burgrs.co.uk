import { supabase } from "./lib/supabase";

const resolvedAiringLinks = new Map();
const CONTINUE_WATCHING_PATH = "/my-shows?filter=continue";
const CONTINUE_PAGE_SELECTOR = ".my-shows-page";

let continueViewActive = false;
let applyingContinueFilter = false;
let continueEligible = null;
let continueLoadPromise = null;
let continueObserver = null;
let continueSyncFrame = null;

function isDashboardAiringLink(anchor) {
  if (!anchor?.matches?.("a.dashboard-episode-item")) return false;
  const href = anchor.getAttribute("href") || "";
  return href.startsWith("/my-shows/");
}

function isContinueWatchingViewAllLink(anchor) {
  if (!anchor?.matches?.("a.dashboard-section-link")) return false;
  return Boolean(anchor.closest(".dashboard-continue-section"));
}

function looksLikeDatabaseUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function getPathId(anchor) {
  const href = anchor.getAttribute("href") || "";
  return decodeURIComponent(href.replace(/^\/my-shows\//, "").split(/[?#]/)[0] || "");
}

function getShowName(anchor) {
  return anchor.querySelector(".dashboard-list-copy strong")?.textContent?.trim() || "";
}

function goTo(path) {
  if (!path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function resolveAiringShowLink(anchor) {
  const showName = getShowName(anchor);
  const pathId = getPathId(anchor);

  if (!looksLikeDatabaseUuid(pathId)) return anchor.getAttribute("href") || "";
  if (resolvedAiringLinks.has(pathId)) return resolvedAiringLinks.get(pathId);

  let query = supabase
    .from("shows")
    .select("id, tvdb_id, tmdb_id, name")
    .eq("id", pathId)
    .maybeSingle();

  let { data, error } = await query;

  if ((error || !data) && showName) {
    const fallback = await supabase
      .from("shows")
      .select("id, tvdb_id, tmdb_id, name")
      .eq("name", showName)
      .maybeSingle();

    data = fallback.data;
    error = fallback.error;
  }

  if (error || !data) return anchor.getAttribute("href") || "";

  const nextPath = data.tmdb_id
    ? `/my-shows/tmdb/${data.tmdb_id}`
    : data.tvdb_id
      ? `/my-shows/${data.tvdb_id}`
      : "";

  if (nextPath) resolvedAiringLinks.set(pathId, nextPath);
  return nextPath || anchor.getAttribute("href") || "";
}

function patchContinueWatchingViewAllLink() {
  const link = document.querySelector(
    ".dashboard-continue-section a.dashboard-section-link"
  );
  if (!link) return;
  if (link.getAttribute("href") !== CONTINUE_WATCHING_PATH) {
    link.setAttribute("href", CONTINUE_WATCHING_PATH);
  }
}

function isContinueWatchingUrl() {
  const url = new URL(window.location.href);
  return url.pathname === "/my-shows" && url.searchParams.get("filter") === "continue";
}

function stripContinueQueryFromUrl() {
  const url = new URL(window.location.href);
  if (url.pathname !== "/my-shows" || url.searchParams.get("filter") !== "continue") return;
  url.searchParams.delete("filter");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, "", next);
}

function restoreContinueHiddenCards() {
  document.querySelectorAll("[data-burgr-continue-hidden='1']").forEach((anchor) => {
    const previousDisplay = anchor.dataset.burgrPreviousDisplay || "block";
    anchor.style.display = previousDisplay;
    delete anchor.dataset.burgrContinueHidden;
    delete anchor.dataset.burgrPreviousDisplay;
  });
}

function getMyShowsCardIdentity(anchor) {
  if (!anchor?.matches?.("a[href^='/my-shows/']")) return null;
  const href = anchor.getAttribute("href") || "";

  const tmdbMatch = href.match(/^\/my-shows\/tmdb\/(\d+)(?:[?#]|$)/);
  if (tmdbMatch) return { type: "tmdb", id: tmdbMatch[1] };

  const tvdbMatch = href.match(/^\/my-shows\/(\d+)(?:[?#]|$)/);
  if (tvdbMatch) return { type: "tvdb", id: tvdbMatch[1] };

  return null;
}

function applyContinueVisibility() {
  if (!continueViewActive || !continueEligible) return;
  const page = document.querySelector(CONTINUE_PAGE_SELECTOR);
  if (!page) return;

  page.querySelectorAll("a[href^='/my-shows/']").forEach((anchor) => {
    const identity = getMyShowsCardIdentity(anchor);
    if (!identity) return;

    const allowed =
      identity.type === "tmdb"
        ? continueEligible.tmdb.has(identity.id)
        : continueEligible.tvdb.has(identity.id);

    if (allowed) {
      if (anchor.dataset.burgrContinueHidden === "1") {
        anchor.style.display = anchor.dataset.burgrPreviousDisplay || "block";
        delete anchor.dataset.burgrContinueHidden;
        delete anchor.dataset.burgrPreviousDisplay;
      }
      return;
    }

    if (anchor.dataset.burgrContinueHidden !== "1") {
      anchor.dataset.burgrPreviousDisplay = anchor.style.display || "block";
      anchor.dataset.burgrContinueHidden = "1";
    }
    anchor.style.display = "none";
  });
}

function selectInProgressFilter() {
  const page = document.querySelector(CONTINUE_PAGE_SELECTOR);
  if (!page || page.dataset.burgrContinueFilterSelected === "1") return;

  const button = [...page.querySelectorAll("button")].find((candidate) =>
    /^\s*▶?\s*In Progress\b/i.test(candidate.textContent || "") ||
    /\bIn Progress\b/i.test(candidate.textContent || "")
  );

  if (!button) return;

  page.dataset.burgrContinueFilterSelected = "1";
  applyingContinueFilter = true;
  button.click();
  applyingContinueFilter = false;
}

async function fetchContinueWatchingEligibleShows() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userId = session?.user?.id;
  if (!userId) return { tvdb: new Set(), tmdb: new Set() };

  const { data: showRows, error: showsError } = await supabase
    .from("user_shows_new")
    .select("show_id, watch_status, shows!inner(tvdb_id, tmdb_id)")
    .eq("user_id", userId)
    .eq("watch_status", "watching");

  if (showsError) throw showsError;

  const savedRows = (showRows || []).filter((row) => row?.show_id);
  const showIds = savedRows.map((row) => row.show_id);
  if (!showIds.length) return { tvdb: new Set(), tmdb: new Set() };

  const today = new Date().toISOString().slice(0, 10);
  const episodes = [];
  const watchedIds = new Set();
  const pageSize = 1000;

  for (const batch of chunkArray(showIds, 40)) {
    let from = 0;
    let done = false;

    while (!done) {
      const { data, error } = await supabase
        .from("episodes")
        .select("id, show_id")
        .in("show_id", batch)
        .gt("season_number", 0)
        .gt("episode_number", 0)
        .lte("aired_date", today)
        .range(from, from + pageSize - 1);

      if (error) throw error;
      const rows = data || [];
      episodes.push(...rows);
      done = rows.length < pageSize;
      from += pageSize;
    }

    from = 0;
    done = false;

    while (!done) {
      const { data, error } = await supabase
        .from("watched_episodes")
        .select("episode_id, episodes!inner(show_id)")
        .eq("user_id", userId)
        .in("episodes.show_id", batch)
        .range(from, from + pageSize - 1);

      if (error) throw error;
      const rows = data || [];
      rows.forEach((row) => {
        if (row?.episode_id) watchedIds.add(String(row.episode_id));
      });
      done = rows.length < pageSize;
      from += pageSize;
    }
  }

  const hasUnwatchedAiredByShow = new Set();
  episodes.forEach((episode) => {
    if (!episode?.show_id || watchedIds.has(String(episode.id))) return;
    hasUnwatchedAiredByShow.add(String(episode.show_id));
  });

  const tvdb = new Set();
  const tmdb = new Set();

  savedRows.forEach((row) => {
    if (!hasUnwatchedAiredByShow.has(String(row.show_id))) return;
    if (row.shows?.tvdb_id) tvdb.add(String(row.shows.tvdb_id));
    if (row.shows?.tmdb_id) tmdb.add(String(row.shows.tmdb_id));
  });

  return { tvdb, tmdb };
}

function ensureContinueWatchingView() {
  if (!isContinueWatchingUrl()) {
    if (continueViewActive) restoreContinueHiddenCards();
    continueViewActive = false;
    continueEligible = null;
    continueLoadPromise = null;
    return;
  }

  continueViewActive = true;
  selectInProgressFilter();

  if (!continueLoadPromise) {
    continueLoadPromise = fetchContinueWatchingEligibleShows()
      .then((eligible) => {
        if (!continueViewActive || !isContinueWatchingUrl()) return;
        continueEligible = eligible;
        applyContinueVisibility();
      })
      .catch((error) => {
        console.warn("Failed to refine Continue Watching view:", error);
      });
  } else {
    applyContinueVisibility();
  }
}

function scheduleContinueSync() {
  if (continueSyncFrame != null) return;
  continueSyncFrame = window.requestAnimationFrame(() => {
    continueSyncFrame = null;
    patchContinueWatchingViewAllLink();
    ensureContinueWatchingView();
  });
}

if (typeof window !== "undefined") {
  document.addEventListener(
    "click",
    async (event) => {
      const continueLink = event.target?.closest?.("a.dashboard-section-link");
      if (isContinueWatchingViewAllLink(continueLink)) {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          goTo(CONTINUE_WATCHING_PATH);
        }
        return;
      }

      const filterButton = event.target?.closest?.(`${CONTINUE_PAGE_SELECTOR} button`);
      if (filterButton && continueViewActive && !applyingContinueFilter) {
        continueViewActive = false;
        continueEligible = null;
        continueLoadPromise = null;
        restoreContinueHiddenCards();
        stripContinueQueryFromUrl();
        return;
      }

      const anchor = event.target?.closest?.("a.dashboard-episode-item");
      if (!isDashboardAiringLink(anchor)) return;

      const pathId = getPathId(anchor);
      if (!looksLikeDatabaseUuid(pathId)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      const nextPath = await resolveAiringShowLink(anchor);
      goTo(nextPath);
    },
    true
  );

  continueObserver = new MutationObserver(scheduleContinueSync);
  continueObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("popstate", scheduleContinueSync);
  window.addEventListener("pageshow", scheduleContinueSync);
  scheduleContinueSync();
}
