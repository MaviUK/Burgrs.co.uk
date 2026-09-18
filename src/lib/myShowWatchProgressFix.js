import { supabase } from "./supabase";

let cachedWatchState = null;
let watchStateRefreshFrame = null;

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function isMyShowDetailsPage() {
  return window.location.pathname.startsWith("/my-shows/");
}

function setTextIfChanged(element, text) {
  if (element && element.textContent !== text) element.textContent = text;
}

function rememberWatchState(episodes, watchedIds) {
  cachedWatchState = {
    pathname: window.location.pathname,
    episodes: [...(episodes || [])],
    watchedIds: new Set(Array.from(watchedIds || []).map(String)),
  };
}

function getEpisodeIdFromButton(button) {
  const card = button?.closest?.('article[id^="episode-"]');
  if (!card?.id) return null;
  return card.id.replace(/^episode-/, "");
}

function getButtonIntent(button) {
  const actions = button?.closest?.(".msd-episode-mobile-actions");
  if (!actions) return null;

  const episodeCard = button.closest('article[id^="episode-"]');
  const buttons = Array.from(actions.querySelectorAll("button"));
  const isFirstButton = buttons[0] === button;
  const label = String(button.textContent || "").trim().toLowerCase();

  if (label.includes("up to here")) return "watch-up-to-here";

  if (
    isFirstButton &&
    (label === "watched" ||
      label === "unwatch" ||
      episodeCard?.classList?.contains("msd-episode-watched"))
  ) {
    return "unwatch-episode";
  }

  return null;
}

async function getCurrentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id || null;
}

async function fetchEpisodeAndShowEpisodes(episodeId) {
  const { data: episode, error: episodeError } = await supabase
    .from("episodes")
    .select("id, show_id, season_number, episode_number")
    .eq("id", episodeId)
    .maybeSingle();

  if (episodeError) throw episodeError;
  if (!episode?.show_id) throw new Error("Episode not found.");

  const { data: episodes, error: episodesError } = await supabase
    .from("episodes")
    .select("id, show_id, season_number, episode_number")
    .eq("show_id", episode.show_id)
    .gt("season_number", 0)
    .order("season_number", { ascending: true })
    .order("episode_number", { ascending: true });

  if (episodesError) throw episodesError;

  return {
    episode,
    episodes: episodes || [],
    showId: episode.show_id,
  };
}

async function fetchWatchedRowsForShow(userId, episodes) {
  const ids = (episodes || []).map((ep) => ep.id).filter(Boolean);
  if (!userId || !ids.length) return [];

  const rows = [];
  for (const batch of chunkArray(ids, 100)) {
    const { data, error } = await supabase
      .from("watched_episodes")
      .select("episode_id")
      .eq("user_id", userId)
      .in("episode_id", batch);

    if (error) throw error;
    rows.push(...(data || []));
  }

  return rows;
}

async function fetchUserShow(userId, showId) {
  const { data, error } = await supabase
    .from("user_shows_new")
    .select("watch_status")
    .eq("user_id", userId)
    .eq("show_id", showId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function updateShowStatus(userId, showId, watchedCount, totalCount) {
  let watchStatus = "watchlist";
  if (totalCount > 0 && watchedCount >= totalCount) watchStatus = "completed";
  else if (watchedCount > 0) watchStatus = "watching";

  const { error } = await supabase
    .from("user_shows_new")
    .update({
      watch_status: watchStatus,
      archived_at: null,
    })
    .eq("user_id", userId)
    .eq("show_id", showId);

  if (error) throw error;
  return watchStatus;
}

async function upsertWatchedRows(rows) {
  if (!rows.length) return;

  for (const batch of chunkArray(rows, 100)) {
    const { error } = await supabase
      .from("watched_episodes")
      .upsert(batch, { onConflict: "user_id,episode_id" });

    if (error) throw error;
  }
}

async function deleteWatchedRows(userId, episodeIds) {
  const ids = (episodeIds || []).filter(Boolean);
  if (!ids.length) return;

  for (const batch of chunkArray(ids, 100)) {
    const { error } = await supabase
      .from("watched_episodes")
      .delete()
      .eq("user_id", userId)
      .in("episode_id", batch);

    if (error) throw error;
  }
}

function episodeCode(ep) {
  const season = Number(ep?.season_number ?? 0);
  const number = Number(ep?.episode_number ?? 0);
  if (!season || !number) return "Episode";
  return `S${String(season).padStart(2, "0")}E${String(number).padStart(2, "0")}`;
}

function setButtonWatchedState(card, watched) {
  const button = card?.querySelector(".msd-episode-mobile-actions button");
  if (!button) return;

  button.disabled = false;
  setTextIfChanged(button, watched ? "Unwatch" : "Watch");
  button.classList.toggle("msd-btn-primary", !watched);
  button.classList.toggle("msd-btn-secondary", watched);
  delete button.dataset.originalText;
}

function ensureSeasonBadge(section, complete) {
  const right = section.querySelector(".msd-season-toggle-right");
  if (!right) return;

  let badge = right.querySelector(".msd-season-badge");
  const chevron = right.querySelector(".msd-season-chevron");

  if (complete && !badge) {
    badge = document.createElement("span");
    badge.className = "msd-season-badge";
    badge.textContent = "Completed";
    right.insertBefore(badge, chevron || null);
  }

  if (!complete && badge) badge.remove();
}

function updateStats(watchedCount, totalCount) {
  const statBoxes = Array.from(
    document.querySelectorAll(".msd-stats-row-five .msd-stat-box")
  );
  const pct = totalCount > 0 ? Math.round((watchedCount / totalCount) * 100) : 0;

  const watchedValue = statBoxes[0]?.querySelector(".msd-stat-value");
  const totalValue = statBoxes[1]?.querySelector(".msd-stat-value");
  const progressValue = statBoxes[2]?.querySelector(".msd-stat-value");

  setTextIfChanged(watchedValue, String(watchedCount));
  setTextIfChanged(totalValue, String(totalCount));
  setTextIfChanged(progressValue, `${pct}%`);
}

async function handleRecreatedBottomWatchClick(event) {
  event.preventDefault();
  event.stopPropagation();

  const button = event.currentTarget;
  const state = cachedWatchState;
  const episodeId = button?.dataset?.episodeId;

  if (!state || state.pathname !== window.location.pathname || !episodeId) return;

  const nextEpisode = state.episodes.find(
    (ep) => String(ep.id) === String(episodeId)
  );
  if (!nextEpisode) return;

  const previousText = button.textContent || "";
  button.disabled = true;
  button.textContent = "Saving...";

  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error("Please log in again.");

    await upsertWatchedRows([
      {
        user_id: userId,
        episode_id: nextEpisode.id,
      },
    ]);

    const nextWatchedIds = new Set(state.watchedIds);
    nextWatchedIds.add(String(nextEpisode.id));

    const showId = nextEpisode.show_id || state.episodes[0]?.show_id;
    if (showId) {
      await updateShowStatus(
        userId,
        showId,
        nextWatchedIds.size,
        state.episodes.length
      );
    }

    applyWatchedDomState(state.episodes, nextWatchedIds);
  } catch (error) {
    console.error("Failed marking next episode watched:", error);
    button.disabled = false;
    button.textContent = previousText;
    alert(error.message || "Failed updating watched status");
  }
}

function updateBottomWatchButton(episodes, watchedIds) {
  rememberWatchState(episodes, watchedIds);

  const actionBar = document.querySelector(".msd-bottom-action-bar");
  if (!actionBar) return;

  let existing = actionBar.querySelector(".msd-bottom-action-btn-primary");
  const mainEpisodes = [...(episodes || [])]
    .filter((ep) => Number(ep?.season_number ?? 0) > 0)
    .sort((a, b) => {
      const seasonDiff =
        Number(a?.season_number ?? 0) - Number(b?.season_number ?? 0);
      if (seasonDiff !== 0) return seasonDiff;
      return Number(a?.episode_number ?? 0) - Number(b?.episode_number ?? 0);
    });

  let lastWatchedIndex = -1;

  mainEpisodes.forEach((ep, index) => {
    if (watchedIds.has(String(ep.id))) {
      lastWatchedIndex = index;
    }
  });

  const nextEpisode =
    lastWatchedIndex < 0
      ? mainEpisodes.find((ep) => !watchedIds.has(String(ep.id))) || null
      : mainEpisodes
          .slice(lastWatchedIndex + 1)
          .find((ep) => !watchedIds.has(String(ep.id))) || null;

  if (!nextEpisode) {
    if (existing) existing.remove();
    return;
  }

  if (!existing) {
    existing = document.createElement("button");
    existing.type = "button";
    existing.className =
      "msd-bottom-action-btn msd-bottom-action-btn-primary";
    existing.dataset.watchProgressRecreated = "true";
    existing.addEventListener("click", handleRecreatedBottomWatchClick);
    actionBar.appendChild(existing);
  }

  existing.dataset.episodeId = String(nextEpisode.id);
  existing.disabled = false;
  setTextIfChanged(existing, `Watch ${episodeCode(nextEpisode)}`);
}

function applyWatchedDomState(episodes, watchedIds) {
  const seasonStats = new Map();

  for (const ep of episodes) {
    const id = String(ep.id);
    const watched = watchedIds.has(id);
    const card = document.getElementById(`episode-${id}`);

    if (card) {
      card.classList.toggle("msd-episode-watched", watched);
      setButtonWatchedState(card, watched);
    }

    const seasonNumber = Number(ep.season_number ?? 0);
    if (!seasonStats.has(seasonNumber)) {
      seasonStats.set(seasonNumber, { watched: 0, total: 0 });
    }

    const stats = seasonStats.get(seasonNumber);
    stats.total += 1;
    if (watched) stats.watched += 1;
  }

  const sections = Array.from(document.querySelectorAll(".msd-season-card"));
  const sortedSeasonNumbers = Array.from(seasonStats.keys()).sort((a, b) => a - b);

  sortedSeasonNumbers.forEach((seasonNumber, index) => {
    const section = sections[index];
    const stats = seasonStats.get(seasonNumber);
    if (!section || !stats) return;

    const complete = stats.total > 0 && stats.watched === stats.total;
    section.classList.toggle("msd-season-complete", complete);

    const subtitle = section.querySelector(".msd-season-subtitle");
    setTextIfChanged(subtitle, `${stats.watched}/${stats.total} watched`);

    ensureSeasonBadge(section, complete);
  });

  updateStats(watchedIds.size, episodes.length);
  updateBottomWatchButton(episodes, watchedIds);
}

async function handleUnwatchEpisode(userId, episodeId) {
  const { episodes, showId } = await fetchEpisodeAndShowEpisodes(episodeId);
  const userShow = await fetchUserShow(userId, showId);
  const existingRows = await fetchWatchedRowsForShow(userId, episodes);
  const existingIds = new Set(existingRows.map((row) => String(row.episode_id)));
  const allEpisodeIds = episodes.map((ep) => String(ep.id));
  let nextWatchedIds;

  if (
    userShow?.watch_status === "completed" &&
    existingIds.size < allEpisodeIds.length
  ) {
    const materializedRows = episodes
      .filter((ep) => String(ep.id) !== String(episodeId))
      .map((ep) => ({ user_id: userId, episode_id: ep.id }));

    await upsertWatchedRows(materializedRows);
    await deleteWatchedRows(userId, [episodeId]);
    await updateShowStatus(userId, showId, materializedRows.length, episodes.length);

    nextWatchedIds = new Set(
      materializedRows.map((row) => String(row.episode_id))
    );
  } else {
    await deleteWatchedRows(userId, [episodeId]);

    const remainingRows = await fetchWatchedRowsForShow(
      userId,
      episodes.filter((ep) => String(ep.id) !== String(episodeId))
    );

    await updateShowStatus(userId, showId, remainingRows.length, episodes.length);
    nextWatchedIds = new Set(
      remainingRows.map((row) => String(row.episode_id))
    );
  }

  applyWatchedDomState(episodes, nextWatchedIds);
}

async function handleWatchUpToHere(userId, episodeId) {
  const { episodes, showId } = await fetchEpisodeAndShowEpisodes(episodeId);
  const targetIndex = episodes.findIndex(
    (ep) => String(ep.id) === String(episodeId)
  );
  if (targetIndex < 0) throw new Error("Episode not found in show.");

  const episodesToWatch = episodes.slice(0, targetIndex + 1);
  const episodesToUnwatch = episodes.slice(targetIndex + 1);
  const rowsToUpsert = episodesToWatch.map((ep) => ({
    user_id: userId,
    episode_id: ep.id,
  }));

  await upsertWatchedRows(rowsToUpsert);
  await deleteWatchedRows(
    userId,
    episodesToUnwatch.map((ep) => ep.id)
  );
  await updateShowStatus(
    userId,
    showId,
    episodesToWatch.length,
    episodes.length
  );

  applyWatchedDomState(
    episodes,
    new Set(episodesToWatch.map((ep) => String(ep.id)))
  );
}

function lockButton(button, intent) {
  button.disabled = true;
  button.dataset.originalText = button.textContent || "";

  // Do not change the Up to Here label. It is not part of the watched/unwatched
  // button refresh, so changing it to Saving... can leave it visually stuck.
  if (intent !== "watch-up-to-here") {
    button.textContent = "Saving...";
  }
}

function unlockButton(button) {
  button.disabled = false;
  if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

export function installMyShowWatchProgressFix() {
  let observedPathname = window.location.pathname;

  async function handleClick(event) {
    if (!isMyShowDetailsPage()) return;

    const button = event.target?.closest?.("button");
    if (!button) return;

    const intent = getButtonIntent(button);
    if (!intent) return;

    const episodeId = getEpisodeIdFromButton(button);
    if (!episodeId) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    lockButton(button, intent);

    try {
      const userId = await getCurrentUserId();
      if (!userId) throw new Error("Please log in again.");

      if (intent === "watch-up-to-here") {
        await handleWatchUpToHere(userId, episodeId);
      } else {
        await handleUnwatchEpisode(userId, episodeId);
      }
    } catch (error) {
      console.error("Failed updating watch progress:", error);
      alert(error.message || "Failed updating watched episodes");
    } finally {
      unlockButton(button);
    }
  }

  const observer = new MutationObserver(() => {
    const pathname = window.location.pathname;

    if (pathname !== observedPathname) {
      observedPathname = pathname;
      cachedWatchState = null;
    }

    if (
      !cachedWatchState ||
      !isMyShowDetailsPage() ||
      cachedWatchState.pathname !== pathname ||
      watchStateRefreshFrame != null
    ) {
      return;
    }

    watchStateRefreshFrame = window.requestAnimationFrame(() => {
      watchStateRefreshFrame = null;

      if (
        cachedWatchState &&
        cachedWatchState.pathname === window.location.pathname &&
        isMyShowDetailsPage()
      ) {
        applyWatchedDomState(
          cachedWatchState.episodes,
          new Set(cachedWatchState.watchedIds)
        );
      }
    });
  });

  document.addEventListener("click", handleClick, true);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  return () => {
    document.removeEventListener("click", handleClick, true);
    observer.disconnect();

    if (watchStateRefreshFrame != null) {
      window.cancelAnimationFrame(watchStateRefreshFrame);
      watchStateRefreshFrame = null;
    }

    cachedWatchState = null;
  };
}