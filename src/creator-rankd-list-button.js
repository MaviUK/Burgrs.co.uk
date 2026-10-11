import { supabase } from "./lib/supabase";

const BUTTON_ATTR = "data-creator-rankd-list-button";
const MODAL_ATTR = "data-creator-rankd-list-modal";
const PAGE_SIZE = 20;
const BURGRS_TV_PROFILE_ID = "add17d5c-c8fd-4430-904f-271342100bf9";

function isBurgrsTvProfile(profile) {
  return String(profile?.id || "") === BURGRS_TV_PROFILE_ID ||
    String(profile?.username || "").trim().toLowerCase() === "burgrs tv";
}

let routeKey = "";
let profileInfo = null;
let rankingCount = 0;
let loadingProfilePromise = null;
let activeRankdModal = null;
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
      .select("id, username, display_name, full_name, avatar_url, is_system_admin")
      .eq("id", slug)
      .maybeSingle();
  }

  if (result.error) throw result.error;
  if (!result.data || routeKey !== expectedRouteKey) return;

  const isSystem = isBurgrsTvProfile(result.data);
  let countQuery = supabase
    .from(isSystem ? "burgr_ratings" : "user_show_rankings")
    .select("show_id", { count: "exact", head: true })
    .eq("user_id", result.data.id);
  if (!isSystem) countQuery = countQuery.not("ladder_position", "is", null);
  const { count, error: countError } = await countQuery;

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

async function fetchRankingsPage(userId, isSystem, offset) {
  let query = supabase
    .from(isSystem ? "burgr_ratings" : "user_show_rankings")
    .select(isSystem ? "show_id, rating" : "show_id, ladder_position, wins, losses, comparisons")
    .eq("user_id", userId);

  query = isSystem
    ? query.order("rating", { ascending: false }).order("show_id", { ascending: true })
    : query.not("ladder_position", "is", null)
        .order("ladder_position", { ascending: true })
        .order("show_id", { ascending: true });

  const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
  if (error) throw error;
  return data || [];
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

  const list = document.createElement("div");
  list.className = "creator-rankd-full-list";
  list.setAttribute("aria-label", "Full Rank'd rankings");
  list.hidden = true;

  const status = document.createElement("div");
  status.className = "creator-rankd-load-more";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  list.appendChild(status);

  panel.append(head, loading, list);
  modal.appendChild(panel);
  document.body.appendChild(modal);
  document.body.classList.add("creator-rankd-modal-open");

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeRankdModal();
  });

  return { modal, panel, subtitle, list, status };
}

function appendRankings(state, rankings, showMap) {
  const fragment = document.createDocumentFragment();
  let renderedCount = 0;

  rankings.forEach((ranking, index) => {
    const show = showMap.get(String(ranking.show_id));
    if (!show) return;
    renderedCount += 1;

    const row = document.createElement("a");
    row.className = "creator-rankd-full-row";
    row.href = showHref(show);

    const rank = document.createElement("strong");
    rank.className = "creator-rankd-full-rank";
    rank.textContent = String(
      state.isSystem ? state.offset + index + 1 : ranking.ladder_position || state.offset + index + 1
    );

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
      state.isSystem ? `${Number(ranking.rating)}% rating` : comparisons
        ? `${comparisons} comparison${comparisons === 1 ? "" : "s"}`
        : "Rank'd",
    ]
      .filter(Boolean)
      .join(" • ");

    copy.append(name, meta);
    row.appendChild(copy);
    fragment.appendChild(row);
  });

  state.list.insertBefore(fragment, state.status);
  return renderedCount;
}

function updateRankdSubtitle(state) {
  const total = Number(state.totalCount || 0).toLocaleString("en-GB");
  const shown = state.renderedCount.toLocaleString("en-GB");
  state.subtitle.textContent =
    `Showing ${shown} of ${total} ${state.isSystem ? "rated" : "ranked"} shows` +
    (state.isSystem ? " • Highest rated first" : "");
}

function updateRankdLoadStatus(state) {
  if (!state.firstPageLoaded || state.error) return;
  state.status.replaceChildren();
  state.status.classList.toggle("is-complete", !state.hasMore);
  state.status.textContent = state.loading
    ? "Loading more shows..."
    : state.hasMore ? "Scroll to load more" : "All shows loaded";
}

function renderRankdPageError(state) {
  state.status.replaceChildren();
  state.status.classList.remove("is-complete");
  const message = document.createElement("span");
  message.textContent = "Could not load more shows.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => {
    if (activeRankdModal !== state || state.loading) return;
    state.error = false;
    void loadNextRankdPage(state);
  });
  state.status.append(message, retry);
}

async function loadNextRankdPage(state) {
  if (activeRankdModal !== state || state.loading || !state.hasMore || state.error) return;

  state.loading = true;
  updateRankdLoadStatus(state);

  try {
    const rankings = await fetchRankingsPage(state.userId, state.isSystem, state.offset);
    const showIds = rankings.map((row) => row.show_id).filter(Boolean);
    const showMap = await fetchShows(showIds);

    // An old request must never re-open or populate a modal that has been closed.
    if (activeRankdModal !== state) return;

    state.renderedCount += appendRankings(state, rankings, showMap);
    state.offset += rankings.length;
    state.hasMore = rankings.length === PAGE_SIZE;

    if (!state.firstPageLoaded) {
      state.panel.querySelector(".creator-rankd-modal-loading")?.remove();
      state.firstPageLoaded = true;
      state.list.hidden = false;
      state.panel.classList.add("is-loaded");
    }
    updateRankdSubtitle(state);
  } catch (error) {
    console.warn("Failed loading creator Rank'd page:", error);
    if (activeRankdModal !== state) return;
    state.error = true;
    if (state.firstPageLoaded) {
      renderRankdPageError(state);
    } else {
      renderError(state.panel, state.subtitle, error?.message);
    }
  } finally {
    if (activeRankdModal === state) {
      state.loading = false;
      updateRankdLoadStatus(state);
    }
  }
}

function renderError(panel, subtitle, message) {
  panel.querySelector(".creator-rankd-modal-loading")?.remove();
  subtitle.textContent = "Could not load rankings";

  const error = document.createElement("p");
  error.className = "creator-rankd-modal-error";
  error.textContent = message || "Please try again.";
  panel.appendChild(error);
}

function openCreatorRankdList() {
  if (!profileInfo?.id || activeRankdModal) return;

  const { modal, panel, subtitle, list, status } = createLoadingModal();
  const state = {
    modal,
    panel,
    subtitle,
    list,
    status,
    userId: profileInfo.id,
    isSystem: isBurgrsTvProfile(profileInfo),
    totalCount: rankingCount,
    offset: 0,
    renderedCount: 0,
    firstPageLoaded: false,
    hasMore: true,
    loading: false,
    error: false,
  };

  activeRankdModal = state;
  list.addEventListener("scroll", () => {
    if (activeRankdModal !== state || !state.firstPageLoaded || state.loading || state.error || !state.hasMore) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (distanceFromBottom <= 180) void loadNextRankdPage(state);
  }, { passive: true });

  void loadNextRankdPage(state);
}

function closeRankdModal() {
  activeRankdModal = null;
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
