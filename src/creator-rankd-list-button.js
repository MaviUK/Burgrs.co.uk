import { supabase } from "./lib/supabase";

const BUTTON_ATTR = "data-creator-rankd-list-button";
const MODAL_ATTR = "data-creator-rankd-list-modal";
const PAGE_SIZE = 500;
const BURGRS_TV_PROFILE_ID = "add17d5c-c8fd-4430-904f-271342100bf9";

function isBurgrsTvProfile(profile) {
  return String(profile?.id || "") === BURGRS_TV_PROFILE_ID ||
    String(profile?.username || "").trim().toLowerCase() === "burgrs tv";
}

let routeKey = "";
let profileInfo = null;
let rankingCount = 0;
let loadingProfilePromise = null;
let loadingListPromise = null;
let syncQueued = false;

function getProfileSlug() {
  const match = window.location.pathname.match(/^\/u\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]).replace(/^@/, "") : "";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function resetRoute(nextRouteKey) {
  closeRankdModal();
  routeKey = nextRouteKey;
  profileInfo = null;
  rankingCount = 0;
  loadingProfilePromise = null;
  loadingListPromise = null;
}

async function resolveProfile(slug, expectedRouteKey) {
  let result = await supabase
    .from("profiles")
    .select("id, username, display_name, full_name, avatar_url, is_system_admin")
    .eq("username", slug)
    .maybeSingle();

  if (!result.data && !result.error && isUuid(slug)) {
    result = await supabase
      .from("profiles")
      .select("id, username, display_name, full_name, avatar_url")
      .eq("id", slug)
      .maybeSingle();
  }

  if (result.error) throw result.error;
  if (!result.data || routeKey !== expectedRouteKey) return;

  const isSystem = isBurgrsTvProfile(result.data);
  const { count, error: countError } = await supabase
    .from(isSystem ? "burgr_ratings" : "user_show_rankings")
    .select("show_id", { count: "exact", head: true })
    .eq("user_id", result.data.id);

  // Manual ladders are only relevant to ordinary accounts.

  if (countError) throw countError;
  if (routeKey !== expectedRouteKey) return;

  profileInfo = result.data;
  rankingCount = count || 0;
}

function getProfileName() {
  return (
    profileInfo?.display_name ||
    profileInfo?.full_name ||
    profileInfo?.username ||
    "Creator"
  );
}

async function fetchAllRankings(userId, isSystem = false) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    let query = supabase
      .from(isSystem ? "burgr_ratings" : "user_show_rankings")
      .select(isSystem ? "show_id, rating" : "show_id, ladder_position, wins, losses, comparisons")
      .eq("user_id", userId);
    query = isSystem
      ? query.order("rating", { ascending: false }).order("show_id", { ascending: true })
      : query.not("ladder_position", "is", null).order("ladder_position", { ascending: true });
    const { data, error } = await query.range(from, to);

    if (error) throw error;

    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  if (isSystem) {
    // Rows are already ordered by rating in the database; tie-breaking by show
    // name happens after the show details arrive.
    return rows;
  }
  return rows;
}

async function fetchShows(showIds) {
  const showMap = new Map();

  for (let index = 0; index < showIds.length; index += 100) {
    const batch = showIds.slice(index, index + 100);
    const { data, error } = await supabase
      .from("shows")
      .select("id, name, first_aired, poster_url, tmdb_id, tvdb_id")
      .in("id", batch);

    if (error) throw error;
    (data || []).forEach((show) => showMap.set(String(show.id), show));
  }

  return showMap;
}

function showHref(show) {
  if (show?.tmdb_id) return `/show/tmdb/${show.tmdb_id}`;
  return show?.id ? `/show/${show.id}` : "#";
}

function formatYear(value) {
  return String(value || "").slice(0, 4);
}

function createLoadingModal() {
  closeRankdModal();

  const modal = document.createElement("div");
  modal.className = "creator-rankd-modal";
  modal.setAttribute(MODAL_ATTR, "true");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", `${getProfileName()}'s full Rank'd list`);

  const panel = document.createElement("section");
  panel.className = "creator-rankd-modal-panel";

  const head = document.createElement("header");
  head.className = "creator-rankd-modal-head";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = `${getProfileName()}'s Rank'd list`;
  const subtitle = document.createElement("p");
  subtitle.textContent = "Loading full TV ranking...";
  titleWrap.append(title, subtitle);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "creator-rankd-modal-close";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Close full ranked list");
  closeButton.addEventListener("click", closeRankdModal);

  head.append(titleWrap, closeButton);

  const loading = document.createElement("div");
  loading.className = "creator-rankd-modal-loading";
  loading.innerHTML = '<span aria-hidden="true">🍔</span><strong>Loading rankings...</strong>';

  panel.append(head, loading);
  modal.appendChild(panel);
  document.body.appendChild(modal);
  document.body.classList.add("creator-rankd-modal-open");

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeRankdModal();
  });

  return { modal, panel, subtitle };
}

function renderRankings(panel, subtitle, rankings, showMap, isSystem = false) {
  panel.querySelector(".creator-rankd-modal-loading")?.remove();
  subtitle.textContent = isSystem
    ? `${rankings.length} shows • Highest rated first`
    : `${rankings.length} ranked show${rankings.length === 1 ? "" : "s"}`; 
  const ordered = isSystem
    ? [...rankings].sort((a, b) =>
        Number(b.rating) - Number(a.rating) ||
        String(showMap.get(String(a.show_id))?.name || "").localeCompare(
          String(showMap.get(String(b.show_id))?.name || ""), "en", { sensitivity: "base" }
        ) ||
        String(a.show_id).localeCompare(String(b.show_id))
      )
    : rankings;

  const list = document.createElement("div");
  list.className = "creator-rankd-full-list";

  ordered.forEach((ranking, index) => {
    const show = showMap.get(String(ranking.show_id));
    if (!show) return;

    const row = document.createElement("a");
    row.className = "creator-rankd-full-row";
    row.href = showHref(show);

    const rank = document.createElement("strong");
    rank.className = "creator-rankd-full-rank";
    rank.textContent = String(isSystem ? index + 1 : ranking.ladder_position || index + 1);

    if (show.poster_url) {
      const poster = document.createElement("img");
      poster.className = "creator-rankd-full-poster";
      poster.src = show.poster_url;
      poster.alt = "";
      poster.loading = "lazy";
      row.append(rank, poster);
    } else {
      const poster = document.createElement("span");
      poster.className = "creator-rankd-full-poster creator-rankd-full-poster-empty";
      poster.textContent = "TV";
      row.append(rank, poster);
    }

    const copy = document.createElement("div");
    copy.className = "creator-rankd-full-copy";

    const name = document.createElement("span");
    name.className = "creator-rankd-full-name";
    name.textContent = show.name || "Untitled show";

    const meta = document.createElement("small");
    const year = formatYear(show.first_aired);
    const comparisons = Number(ranking.comparisons || 0);
    meta.textContent = [
      year,
      isSystem ? `${Number(ranking.rating)}% rating` : comparisons
        ? `${comparisons} comparison${comparisons === 1 ? "" : "s"}`
        : "Rank'd",
    ]
      .filter(Boolean)
      .join(" • ");

    copy.append(name, meta);
    row.appendChild(copy);
    list.appendChild(row);
  });

  panel.appendChild(list);
}

function renderError(panel, subtitle, message) {
  panel.querySelector(".creator-rankd-modal-loading")?.remove();
  subtitle.textContent = "Could not load rankings";

  const error = document.createElement("p");
  error.className = "creator-rankd-modal-error";
  error.textContent = message || "Please try again.";
  panel.appendChild(error);
}

async function openCreatorRankdList() {
  if (!profileInfo?.id || loadingListPromise) return;

  const { panel, subtitle } = createLoadingModal();

  loadingListPromise = (async () => {
    const isSystem = isBurgrsTvProfile(profileInfo);
    const rankings = await fetchAllRankings(profileInfo.id, isSystem);
    const showIds = rankings.map((row) => row.show_id).filter(Boolean);
    const showMap = await fetchShows(showIds);

    if (!document.body.contains(panel)) return;
    renderRankings(panel, subtitle, rankings, showMap, isSystem);
  })()
    .catch((error) => {
      console.warn("Failed loading creator full Rank'd list:", error);
      if (document.body.contains(panel)) {
        renderError(panel, subtitle, error?.message);
      }
    })
    .finally(() => {
      loadingListPromise = null;
    });
}

function closeRankdModal() {
  document.querySelector(`[${MODAL_ATTR}]`)?.remove();
  document.body.classList.remove("creator-rankd-modal-open");
}

function installCreatorRankdListButton() {
  const slug = getProfileSlug();
  const nextRouteKey = slug ? `profile:${slug}` : "";

  if (nextRouteKey !== routeKey) resetRoute(nextRouteKey);
  if (!slug) return;

  const actions = document.querySelector(
    ".creator-page .creator-hero .creator-actions"
  );
  if (!actions) return;

  const isOwnProfile = Boolean(actions.querySelector('a[href="/profile/edit"]'));
  if (isOwnProfile) {
    actions.querySelector(`[${BUTTON_ATTR}]`)?.remove();
    return;
  }

  if (!profileInfo) {
    if (!loadingProfilePromise) {
      loadingProfilePromise = resolveProfile(slug, nextRouteKey)
        .catch((error) => {
          console.warn("Failed checking creator Rank'd list:", error);
        })
        .finally(() => {
          loadingProfilePromise = null;
          queueCreatorRankdListButton();
        });
    }
    return;
  }

  if (!rankingCount) {
    actions.querySelector(`[${BUTTON_ATTR}]`)?.remove();
    return;
  }

  let button = actions.querySelector(`[${BUTTON_ATTR}]`);
  if (button) return;

  button = document.createElement("button");
  button.type = "button";
  button.className = "creator-btn creator-btn-rankd creator-rankd-list-button";
  button.textContent = "Full Rank'd";
  button.setAttribute(BUTTON_ATTR, "true");
  button.setAttribute(
    "aria-label",
    `View ${getProfileName()}'s full Rank'd TV list`
  );
  button.addEventListener("click", openCreatorRankdList);
  actions.appendChild(button);
}

function queueCreatorRankdListButton() {
  if (syncQueued) return;
  syncQueued = true;

  window.requestAnimationFrame(() => {
    syncQueued = false;
    installCreatorRankdListButton();
  });
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", queueCreatorRankdListButton, {
      once: true,
    });
  } else {
    queueCreatorRankdListButton();
  }

  new MutationObserver(queueCreatorRankdListButton).observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
    }
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeRankdModal();
  });

  window.addEventListener("popstate", queueCreatorRankdListButton);
  window.addEventListener("pageshow", queueCreatorRankdListButton);
}
