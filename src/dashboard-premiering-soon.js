import { supabase } from "./lib/supabase";
import { fetchSavedShowRows, getSavedExternalIdSets } from "./lib/savedShowLibrary";

const CACHE_KEY = "trackt_premiering_s01e01_v5";
const CACHE_DURATION = 1000 * 60 * 30;

function readCache() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CACHE_KEY) || "null");
    if (!parsed?.savedAt || !Array.isArray(parsed?.shows)) return null;
    if (Date.now() - Number(parsed.savedAt) >= CACHE_DURATION) return null;
    return parsed.shows;
  } catch {
    return null;
  }
}

function writeCache(shows) {
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), shows })
    );
  } catch {
    // Ignore storage failures.
  }
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDaysUntil(value) {
  const date = normalizeDate(value);
  if (!date) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date - today) / 86400000);
}

function isValidUpcomingPremiere(show) {
  const premiereDate = show?.premiere_date || show?.first_air_date;
  const days = getDaysUntil(premiereDate);

  return (
    days != null &&
    days >= 0 &&
    days <= 7 &&
    Number(show?.premiere_season_number) === 1 &&
    Number(show?.premiere_episode_number) === 1 &&
    Boolean(show?.tmdb_id || show?.tvdb_id)
  );
}

function formatCountdown(value) {
  const days = getDaysUntil(value);
  if (days == null) return "Coming soon";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function formatDate(value) {
  const date = normalizeDate(value);
  if (!date) return "";

  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

async function loadShows() {
  const cached = readCache();
  if (cached) return cached.filter(isValidUpcomingPremiere);

  const response = await fetch(
    `/.netlify/functions/getS01E01Premieres?v=5&t=${Date.now()}`,
    { cache: "no-store" }
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.message || "Failed to load upcoming premieres");
  }

  const shows = (Array.isArray(payload?.shows) ? payload.shows : []).filter(
    isValidUpcomingPremiere
  );
  writeCache(shows);
  return shows;
}

async function getSavedIds(shows = []) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const empty = { tmdb: new Set(), tvdb: new Set() };
  if (!user) return empty;

  try {
    const rows = await fetchSavedShowRows(user.id, {
      tvdbIds: shows.map((show) => show?.tvdb_id).filter(Boolean),
      tmdbIds: shows.map((show) => show?.tmdb_id).filter(Boolean),
    });
    const saved = getSavedExternalIdSets(rows);
    return { tmdb: saved.tmdb, tvdb: saved.tvdb };
  } catch (error) {
    console.warn("Failed loading saved premiere badges", error);
    return empty;
  }
}

function findSection() {
  return [...document.querySelectorAll(".trending-section")].find((section) => {
    const heading = section.querySelector("h2")?.textContent?.trim();
    return [
      "Premiering Soon",
      "New Shows Coming Soon",
      "New Shows Premiering This Week",
    ].includes(heading);
  });
}

function createCard(show, savedIds) {
  const tmdbId = show?.tmdb_id || null;
  const tvdbId = show?.tvdb_id || null;
  const isSaved =
    (tmdbId && savedIds.tmdb.has(String(tmdbId))) ||
    (tvdbId && savedIds.tvdb.has(String(tvdbId)));
  const premiereDate = show?.premiere_date || show?.first_air_date;
  const link = document.createElement("a");
  link.className = "premiere-card";

  if (isSaved) {
    link.href = tmdbId ? `/my-shows/tmdb/${tmdbId}` : `/my-shows/${tvdbId}`;
  } else {
    link.href = tmdbId ? `/show/tmdb/${tmdbId}` : `/show/${tvdbId}`;
  }

  const posterWrap = document.createElement("div");
  posterWrap.className = "premiere-card-poster-wrap";

  const image = document.createElement("img");
  image.className = "premiere-card-image";
  image.src = show?.poster_url || show?.image || "";
  image.alt = show?.name || "Upcoming show";
  image.loading = "lazy";
  image.decoding = "async";
  posterWrap.appendChild(image);

  const countdown = document.createElement("span");
  countdown.className = "premiere-countdown";
  countdown.textContent = formatCountdown(premiereDate);
  posterWrap.appendChild(countdown);

  if (isSaved) {
    const savedBadge = document.createElement("span");
    savedBadge.className = "premiere-saved-badge";
    savedBadge.textContent = "In My Shows";
    posterWrap.appendChild(savedBadge);
  }

  const copy = document.createElement("div");
  copy.className = "premiere-card-copy";

  const title = document.createElement("strong");
  title.textContent = show?.name || "Unknown show";

  const date = document.createElement("span");
  date.textContent = formatDate(premiereDate);

  copy.append(title, date);
  link.append(posterWrap, copy);
  return link;
}

async function enhanceSection() {
  const section = findSection();
  if (!section || section.dataset.premiereEnhanced === "s01e01-v5") return;

  section.dataset.premiereEnhanced = "s01e01-v5";
  const heading = section.querySelector("h2");
  if (heading) heading.textContent = "New Shows Premiering This Week";

  section.querySelector(".trending-row")?.remove();
  section.querySelector(".premiere-row")?.remove();
  section.querySelector(".empty-state")?.remove();

  const loading = document.createElement("p");
  loading.className = "empty-state premiere-loading";
  loading.textContent = "Finding new S01E01 premieres...";
  section.appendChild(loading);

  try {
    const shows = await loadShows();
    const savedIds = await getSavedIds(shows);

    loading.remove();

    if (!shows.length) {
      const message = document.createElement("p");
      message.className = "empty-state";
      message.textContent =
        "No verified S01E01 premieres are scheduled in the next seven days.";
      section.appendChild(message);
      return;
    }

    const row = document.createElement("div");
    row.className = "premiere-row";
    shows.forEach((show) => row.appendChild(createCard(show, savedIds)));
    section.appendChild(row);
  } catch (error) {
    console.error("Failed enhancing Premiering Soon", error);
    loading.textContent = "Upcoming premieres could not be loaded right now.";
  }
}

const observer = new MutationObserver(enhanceSection);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", () => window.setTimeout(enhanceSection, 0));
enhanceSection();
