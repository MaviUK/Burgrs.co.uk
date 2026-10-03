import { supabase } from "./lib/supabase";

let currentSlug = "";
let latestStats = null;
let loadingStats = false;

function isSharedRankdPage() {
  return window.location.pathname.startsWith("/rankd/share/");
}

function getSharedSlug() {
  return decodeURIComponent(window.location.pathname.replace(/^\/rankd\/share\//, "").split(/[?#]/)[0] || "");
}

function getWinCount(stats, showId) {
  if (!stats || !showId) return 0;
  return String(stats.show_a_id) === String(showId)
    ? Number(stats.show_a_wins || 0)
    : Number(stats.show_b_wins || 0);
}

function getPercent(wins, total) {
  const cleanTotal = Number(total || 0);
  if (!cleanTotal) return 0;
  return Math.round((Number(wins || 0) / cleanTotal) * 100);
}

async function loadOverallStats(showIds) {
  const ids = Array.from(new Set((showIds || []).filter(Boolean).map(String)));
  const statsByShow = ids.reduce((map, showId) => {
    map[showId] = { wins: 0, total: 0, percent: 0 };
    return map;
  }, {});

  if (!ids.length) return statsByShow;

  const { data, error } = await supabase.rpc("get_rankd_overall_stats", {
    p_show_ids: ids,
  });

  if (error) throw error;

  (data || []).forEach((row) => {
    const showId = String(row.show_id || "");
    if (!statsByShow[showId]) return;
    const wins = Number(row.wins || 0);
    const total = Number(row.total || 0);
    statsByShow[showId] = {
      wins,
      total,
      percent: getPercent(wins, total),
    };
  });

  return statsByShow;
}

async function loadSharedStats() {
  if (!isSharedRankdPage() || loadingStats) return null;

  const slug = getSharedSlug();
  if (!slug) return null;
  if (latestStats && currentSlug === slug) return latestStats;

  loadingStats = true;
  try {
    const { data, error } = await supabase
      .from("rankd_matchups")
      .select(`
        id,
        share_slug,
        show_a_id,
        show_b_id,
        show_a_wins,
        show_b_wins,
        times_matched,
        show_a:show_a_id(id, name),
        show_b:show_b_id(id, name)
      `)
      .eq("share_slug", slug)
      .eq("is_shareable", true)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) return null;

    const overall = await loadOverallStats([data.show_a_id, data.show_b_id]);
    latestStats = { ...data, overall };
    currentSlug = slug;
    return latestStats;
  } catch (error) {
    console.warn("Shared Rankd stats fix failed:", error);
    return null;
  } finally {
    loadingStats = false;
  }
}

function findShowIdForRow(stats, row) {
  const title = row.querySelector("span")?.textContent?.trim().toLowerCase() || "";
  const showAName = String(stats.show_a?.name || "").trim().toLowerCase();
  const showBName = String(stats.show_b?.name || "").trim().toLowerCase();

  if (title && showAName && title === showAName) return String(stats.show_a_id);
  if (title && showBName && title === showBName) return String(stats.show_b_id);

  const rows = Array.from(document.querySelectorAll(".rankd-page .rankd-win-row"));
  const index = rows.indexOf(row);
  return index === 0 ? String(stats.show_a_id) : String(stats.show_b_id);
}

function patchStatsDom(stats) {
  if (!stats?.id) return false;

  const rows = Array.from(document.querySelectorAll(".rankd-page .rankd-win-row"));
  if (rows.length < 2) return false;

  rows.forEach((row) => {
    const showId = findShowIdForRow(stats, row);
    const matchupWins = getWinCount(stats, showId);
    const matchupTotal = Number(stats.times_matched || 0);
    const matchupPercent = getPercent(matchupWins, matchupTotal);
    const overall = stats.overall?.[String(showId)] || { wins: 0, total: 0, percent: 0 };

    const bar = row.querySelector("i");
    if (bar) bar.style.width = `${matchupPercent}%`;

    const summarySpans = row.querySelectorAll(".rankd-win-summary span");
    if (summarySpans[0]) {
      summarySpans[0].textContent = `Overall ${overall.percent}% / ${overall.wins} wins`;
    }
    if (summarySpans[1]) {
      summarySpans[1].textContent = `Matchup ${matchupPercent}% / ${matchupWins} wins`;
    }
  });

  return true;
}

async function refreshSharedStatsDom(forceReload = false) {
  if (!isSharedRankdPage()) return;
  if (forceReload) latestStats = null;

  const stats = await loadSharedStats();
  if (!stats) return;

  window.setTimeout(() => patchStatsDom(stats), 80);
  window.setTimeout(() => patchStatsDom(stats), 350);
  window.setTimeout(() => patchStatsDom(stats), 1000);
}

if (typeof window !== "undefined") {
  const run = () => refreshSharedStatsDom(false);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  const observer = new MutationObserver(run);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", () => refreshSharedStatsDom(true));
  window.addEventListener("rankd:guest-vote-recorded", () => refreshSharedStatsDom(true));
  window.setInterval(run, 2500);
}
