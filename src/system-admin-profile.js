import { supabase } from "./lib/supabase";

const SYSTEM_USERNAME = "burgers tv";
const SYSTEM_STATS_ATTR = "data-burgrs-system-admin-stats";
const SYSTEM_BADGE_ATTR = "data-burgrs-system-admin-badge";

let cachedCounts = null;
let loadingCounts = null;
let syncQueued = false;

function currentProfileSlug() {
  const match = window.location.pathname.match(/^\/u\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]).replace(/^@/, "").trim() : "";
}

function isSystemProfileRoute() {
  return currentProfileSlug().toLowerCase() === SYSTEM_USERNAME;
}

async function loadCounts() {
  if (cachedCounts) return cachedCounts;
  if (loadingCounts) return loadingCounts;

  loadingCounts = Promise.all([
    supabase.from("shows").select("id", { count: "exact", head: true }),
    supabase.from("episodes").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
  ])
    .then(([showsResult, episodesResult, profilesResult]) => {
      if (showsResult.error) throw showsResult.error;
      if (episodesResult.error) throw episodesResult.error;
      if (profilesResult.error) throw profilesResult.error;

      cachedCounts = {
        shows: Number(showsResult.count || 0),
        episodes: Number(episodesResult.count || 0),
        users: Math.max(0, Number(profilesResult.count || 0) - 1),
      };
      return cachedCounts;
    })
    .catch((error) => {
      console.warn("Failed loading BURGRS system admin counts:", error);
      return null;
    })
    .finally(() => {
      loadingCounts = null;
    });

  return loadingCounts;
}

function makeStat(value, label) {
  const item = document.createElement("div");
  item.className = "burgrs-system-admin-stat";

  const strong = document.createElement("strong");
  strong.textContent = Number(value || 0).toLocaleString("en-GB");

  const span = document.createElement("span");
  span.textContent = label;

  item.append(strong, span);
  return item;
}

function ensureBadge(heroContent) {
  if (heroContent.querySelector(`[${SYSTEM_BADGE_ATTR}]`)) return;

  const badge = document.createElement("p");
  badge.setAttribute(SYSTEM_BADGE_ATTR, "true");
  badge.className = "creator-niche-pill";
  badge.textContent = "Official BURGRS admin";

  const actions = heroContent.querySelector(".creator-actions");
  if (actions) actions.insertAdjacentElement("beforebegin", badge);
  else heroContent.appendChild(badge);
}

function forceFollowingButton() {
  const actions = document.querySelector(".creator-page .creator-actions");
  if (!actions) return;

  const button = Array.from(actions.querySelectorAll("button")).find((item) => {
    const text = String(item.textContent || "").trim().toLowerCase();
    return text === "follow" || text === "following" || text === "saving...";
  });

  if (!button) return;
  button.textContent = "Following";
  button.classList.remove("creator-btn-primary");
  button.classList.add("creator-btn-secondary");
  button.disabled = true;
  button.setAttribute("aria-label", "Following official BURGRS admin");
}

function updateFollowCounts(users) {
  const statsCard = document.querySelector(
    ".creator-page .creator-stats-card.creator-stats-card-clickable:not(.creator-system-stats)"
  );
  if (!statsCard) return;

  for (const button of statsCard.querySelectorAll("button")) {
    const label = String(button.querySelector("span")?.textContent || "")
      .trim()
      .toLowerCase();
    if (label !== "followers" && label !== "following") continue;

    const value = button.querySelector("strong");
    if (value) value.textContent = Number(users || 0).toLocaleString("en-GB");
  }
}

function ensureSystemStats(counts) {
  const existing = document.querySelector(`[${SYSTEM_STATS_ATTR}]`);
  if (existing) {
    const shows = existing.querySelector('[data-stat="shows"] strong');
    const episodes = existing.querySelector('[data-stat="episodes"] strong');
    const users = existing.querySelector('[data-stat="users"] strong');
    if (shows) shows.textContent = counts.shows.toLocaleString("en-GB");
    if (episodes) episodes.textContent = counts.episodes.toLocaleString("en-GB");
    if (users) users.textContent = counts.users.toLocaleString("en-GB");
    return;
  }

  const normalStats = document.querySelector(
    ".creator-page .creator-stats-card.creator-stats-card-clickable"
  );
  if (!normalStats) return;

  const section = document.createElement("section");
  section.setAttribute(SYSTEM_STATS_ATTR, "true");
  section.className = "creator-stats-card creator-system-stats burgrs-system-admin-stats";
  section.setAttribute("aria-label", "BURGRS admin system stats");

  const shows = makeStat(counts.shows, "Shows watched");
  shows.dataset.stat = "shows";
  const episodes = makeStat(counts.episodes, "Episodes watched");
  episodes.dataset.stat = "episodes";
  const users = makeStat(counts.users, "Users followed");
  users.dataset.stat = "users";
  const complete = makeStat(100, "% Complete");

  section.append(shows, episodes, users, complete);
  normalStats.insertAdjacentElement("beforebegin", section);
}

async function syncSystemAdminProfile() {
  if (!isSystemProfileRoute()) {
    document.querySelector(`[${SYSTEM_STATS_ATTR}]`)?.remove();
    document.querySelector(`[${SYSTEM_BADGE_ATTR}]`)?.remove();
    return;
  }

  const heroContent = document.querySelector(".creator-page .creator-hero-content");
  if (!heroContent) return;

  ensureBadge(heroContent);
  forceFollowingButton();

  const counts = await loadCounts();
  if (!counts || !isSystemProfileRoute()) return;

  updateFollowCounts(counts.users);
  ensureSystemStats(counts);
}

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  window.requestAnimationFrame(() => {
    syncQueued = false;
    void syncSystemAdminProfile();
  });
}

export function installSystemAdminProfile() {
  const observer = new MutationObserver(queueSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", queueSync);
  window.addEventListener("pageshow", queueSync);
  window.addEventListener("focus", queueSync);
  queueSync();

  return () => {
    observer.disconnect();
    window.removeEventListener("popstate", queueSync);
    window.removeEventListener("pageshow", queueSync);
    window.removeEventListener("focus", queueSync);
  };
}
