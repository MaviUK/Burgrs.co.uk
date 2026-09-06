import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "./Rankd.css";
import LoginModal from "../components/LoginModal";

const DEFAULT_LADDER_POSITION = 999999;
const FRONTLOAD_SHOW_COUNT = 80;
const BACKGROUND_PAGE_SIZE = 250;
const RECENT_SHOW_LIMIT = 80;
const RECENT_PAIR_LIMIT = 150;
const SWIPE_THRESHOLD = 70;

function sortByLadder(a, b) {
  const aUnrated = Number(a.rank_comparisons || 0) === 0;
  const bUnrated = Number(b.rank_comparisons || 0) === 0;

  if (aUnrated && !bUnrated) return 1;
  if (!aUnrated && bUnrated) return -1;

  const aPos = a.ladder_position ?? DEFAULT_LADDER_POSITION;
  const bPos = b.ladder_position ?? DEFAULT_LADDER_POSITION;

  if (aPos !== bPos) return aPos - bPos;
  return (a.show_name || "").localeCompare(b.show_name || "");
}

function makePairKey(firstId, secondId) {
  return [firstId, secondId].map(String).sort().join(":");
}

function getOrderedPair(firstId, secondId) {
  const [showAId, showBId] = [firstId, secondId].map(String).sort();
  return { showAId, showBId, pairKey: `${showAId}:${showBId}` };
}

function normalizeShowRow(row, ranking = null, fallbackPosition = null) {
  const show = row?.shows || row;

  return {
    show_id: row?.show_id || show?.id,
    tvdb_id: show?.tvdb_id || row?.tvdb_id || null,
    show_name: show?.name || row?.show_name || row?.name || "Unknown title",
    poster_url: show?.poster_url || row?.poster_url || null,
    ladder_position: ranking?.ladder_position ?? fallbackPosition,
    rank_wins: ranking?.wins ?? 0,
    rank_losses: ranking?.losses ?? 0,
    rank_comparisons: ranking?.comparisons ?? 0,
  };
}

function applyLadderWin(shows, winnerId, loserId) {
  const ranked = [...shows].sort(sortByLadder);
  const winnerIndex = ranked.findIndex((show) => String(show.show_id) === String(winnerId));
  const loserIndex = ranked.findIndex((show) => String(show.show_id) === String(loserId));

  if (winnerIndex === -1 || loserIndex === -1) return shows;

  if (winnerIndex > loserIndex) {
    const [winner] = ranked.splice(winnerIndex, 1);
    ranked.splice(loserIndex, 0, winner);
  }

  return ranked.map((show, index) => ({
    ...show,
    ladder_position: index + 1,
  }));
}

function isFocusSettled(items, focus) {
  if (!focus) return false;
  const sorted = [...items].sort(sortByLadder);
  const index = sorted.findIndex(
    (show) => String(show.show_id) === String(focus.showId)
  );
  if (index === -1) return false;

  const above = sorted[index - 1];
  const below = sorted[index + 1];
  const testedIds = new Set((focus.testedIds || []).map(String));
  const lostToAbove =
    !above || (focus.lostToIds || []).includes(String(above.show_id));
  const beatBelow =
    !below || (focus.beatenIds || []).includes(String(below.show_id));

  const hasUntestedAbove = sorted
    .slice(0, index)
    .some((show) => !testedIds.has(String(show.show_id)));
  const hasUntestedBelow = sorted
    .slice(index + 1)
    .some((show) => !testedIds.has(String(show.show_id)));

  const checkedAbove =
    !above || Boolean(focus.checkedAbove) || !hasUntestedAbove;
  const checkedBelow =
    !below || Boolean(focus.checkedBelow) || !hasUntestedBelow;

  return lostToAbove && beatBelow && checkedAbove && checkedBelow;
}

function getFocusedPair(items, focusShowId, focus = null) {
  const sorted = [...items].sort(sortByLadder);
  const focusIndex = sorted.findIndex(
    (show) => String(show.show_id) === String(focusShowId)
  );
  if (focusIndex === -1) return [];

  const focusShow = sorted[focusIndex];
  const testedIds = new Set((focus?.testedIds || []).map(String));
  const preferredDirection = focus?.direction === "down" ? "down" : "up";

  function findOpponent(direction) {
    if (direction === "up") {
      for (let index = focusIndex - 1; index >= 0; index -= 1) {
        const candidate = sorted[index];
        if (!candidate || testedIds.has(String(candidate.show_id))) continue;
        return candidate;
      }
      return null;
    }

    for (let index = focusIndex + 1; index < sorted.length; index += 1) {
      const candidate = sorted[index];
      if (!candidate || testedIds.has(String(candidate.show_id))) continue;
      return candidate;
    }
    return null;
  }

  const opponent =
    findOpponent(preferredDirection) ||
    findOpponent(preferredDirection === "up" ? "down" : "up");

  if (!opponent) return [];
  return Math.random() > 0.5
    ? [focusShow, opponent]
    : [opponent, focusShow];
}

function moveShowToRank(shows, showId, targetRank) {
  const ranked = [...shows].sort(sortByLadder);
  const fromIndex = ranked.findIndex((show) => String(show.show_id) === String(showId));
  if (fromIndex === -1) return { nextShows: shows, affectedShows: [] };

  const clampedRank = Math.max(1, Math.min(Number(targetRank || 1), ranked.length));
  const toIndex = clampedRank - 1;
  if (fromIndex === toIndex) return { nextShows: ranked, affectedShows: [] };

  const [movedShow] = ranked.splice(fromIndex, 1);
  ranked.splice(toIndex, 0, movedShow);

  const nextShows = ranked.map((show, index) => ({
    ...show,
    ladder_position: index + 1,
  }));

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);

  return {
    nextShows,
    affectedShows: nextShows.slice(start, end + 1),
  };
}

function getRecentShowStorageKey(userId) {
  return `rankd_recent_shows_v3:${userId || "guest"}`;
}

function readRecentShows(userId) {
  try {
    const raw = window.sessionStorage.getItem(getRecentShowStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String).slice(0, RECENT_SHOW_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeRecentShows(userId, showIds) {
  try {
    const clean = [];
    const seen = new Set();

    (showIds || []).forEach((id) => {
      const key = String(id || "");
      if (!key || seen.has(key)) return;
      seen.add(key);
      clean.push(key);
    });

    window.sessionStorage.setItem(
      getRecentShowStorageKey(userId),
      JSON.stringify(clean.slice(0, RECENT_SHOW_LIMIT))
    );
  } catch {
    // Rankd still works without session storage.
  }
}

function chooseFastPair(shows, previousPairKey = "", recentShowIds = [], recentPairKeys = []) {
  if (!shows || shows.length < 2) return [];

  const recentShowSet = new Set((recentShowIds || []).map(String));
  const recentPairSet = new Set((recentPairKeys || []).map(String));
  const freshShows = shows.filter((show) => !recentShowSet.has(String(show.show_id)));
  const pool = freshShows.length >= 2 ? freshShows : shows;

  const scored = [...pool]
    .sort((a, b) => {
      const comparisonDiff = Number(a.rank_comparisons || 0) - Number(b.rank_comparisons || 0);
      if (comparisonDiff !== 0) return comparisonDiff;

      const positionDiff =
        Number(a.ladder_position ?? DEFAULT_LADDER_POSITION) -
        Number(b.ladder_position ?? DEFAULT_LADDER_POSITION);
      if (positionDiff !== 0) return positionDiff;

      return (a.show_name || "").localeCompare(b.show_name || "");
    })
    .slice(0, Math.min(pool.length, 80));

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const first = scored[Math.floor(Math.random() * scored.length)];
    const second = scored[Math.floor(Math.random() * scored.length)];
    if (!first || !second || String(first.show_id) === String(second.show_id)) continue;

    const pairKey = makePairKey(first.show_id, second.show_id);
    if (pairKey === previousPairKey) continue;
    if (recentPairSet.has(pairKey) && scored.length > 8) continue;

    return Math.random() > 0.5 ? [first, second] : [second, first];
  }

  const fallback = scored.filter(Boolean);
  return fallback.length >= 2 ? [fallback[0], fallback[1]] : [];
}

function getWinCount(stats, showId) {
  if (!stats) return 0;
  return String(stats.show_a_id) === String(showId)
    ? Number(stats.show_a_wins || 0)
    : Number(stats.show_b_wins || 0);
}

function getWinPercent(stats, showId) {
  const total = Number(stats?.times_matched || 0);
  if (!total) return 0;
  return Math.round((getWinCount(stats, showId) / total) * 100);
}

function getOverallStats(statsByShow, showId) {
  const stats = statsByShow?.[String(showId)] || { wins: 0, total: 0 };
  const wins = Number(stats.wins || 0);
  const total = Number(stats.total || 0);
  const percent = total > 0 ? Math.round((wins / total) * 100) : 0;

  return { wins, total, percent };
}

async function getOptionalUser() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionData?.session?.user?.id) return sessionData.session.user;

  const sessionMessage = String(sessionError?.message || "").toLowerCase();
  const sessionMissing =
    sessionMessage.includes("auth session missing") ||
    sessionMessage.includes("session missing");

  if (sessionError && !sessionMissing) throw sessionError;

  const { data, error } = await supabase.auth.getUser();
  const message = String(error?.message || "").toLowerCase();
  const isMissingSession =
    message.includes("auth session missing") || message.includes("session missing");

  if (error && !isMissingSession) throw error;
  return data?.user || null;
}

async function fetchRankdShowPage(userId, from, to) {
  const { data, error } = await supabase
    .from("user_shows_new")
    .select("show_id, watch_status, shows!inner(id, tvdb_id, name, poster_url)")
    .eq("user_id", userId)
    .in("watch_status", ["completed", "watching"])
    .range(from, to);

  if (error) throw error;
  return data || [];
}

async function fetchRankingMap(userId, showIds) {
  const ids = Array.from(new Set((showIds || []).filter(Boolean).map(String)));
  const map = new Map();
  if (!userId || !ids.length) return map;

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { data, error } = await supabase
      .from("user_show_rankings")
      .select("show_id, ladder_position, wins, losses, comparisons")
      .eq("user_id", userId)
      .in("show_id", batch);

    if (error) throw error;
    (data || []).forEach((row) => map.set(String(row.show_id), row));
  }

  return map;
}

async function fetchMatchupStatsForPair(firstShowId, secondShowId) {
  const { pairKey } = getOrderedPair(firstShowId, secondShowId);

  const { data, error } = await supabase
    .from("rankd_matchups")
    .select("id, show_a_id, show_b_id, show_a_wins, show_b_wins, times_matched")
    .eq("pair_key", pairKey)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function fetchOverallStatsForShows(showIds) {
  const ids = Array.from(new Set((showIds || []).filter(Boolean).map(String)));
  const statsByShow = ids.reduce((map, showId) => {
    map[showId] = { wins: 0, total: 0 };
    return map;
  }, {});

  if (!ids.length) return statsByShow;

  const [asShowA, asShowB] = await Promise.all([
    supabase
      .from("rankd_matchups")
      .select("show_a_id, show_a_wins, times_matched")
      .in("show_a_id", ids),
    supabase
      .from("rankd_matchups")
      .select("show_b_id, show_b_wins, times_matched")
      .in("show_b_id", ids),
  ]);

  if (asShowA.error) throw asShowA.error;
  if (asShowB.error) throw asShowB.error;

  (asShowA.data || []).forEach((row) => {
    const showId = String(row.show_a_id);
    if (!statsByShow[showId]) return;
    statsByShow[showId].wins += Number(row.show_a_wins || 0);
    statsByShow[showId].total += Number(row.times_matched || 0);
  });

  (asShowB.data || []).forEach((row) => {
    const showId = String(row.show_b_id);
    if (!statsByShow[showId]) return;
    statsByShow[showId].wins += Number(row.show_b_wins || 0);
    statsByShow[showId].total += Number(row.times_matched || 0);
  });

  return statsByShow;
}

function mergeShows(existing, incoming) {
  const map = new Map((existing || []).map((show) => [String(show.show_id), show]));

  (incoming || []).forEach((show) => {
    const key = String(show.show_id);
    if (!key) return;
    if (map.has(key)) {
      map.set(key, {
        ...show,
        ...map.get(key),
      });
    } else {
      map.set(key, show);
    }
  });

  return Array.from(map.values())
    .sort(sortByLadder)
    .map((show, index) => ({
      ...show,
      ladder_position: show.ladder_position ?? index + 1,
    }));
}

function RankCard({ show, onChoose, onTouchStart, onTouchEnd, disabledLabel = "" }) {
  return (
    <button
      type="button"
      onClick={onChoose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="rankd-poster-button"
      aria-label={`Choose ${show.show_name}`}
      title={show.show_name}
    >
      <div className="rankd-poster-frame">
        {show.poster_url ? (
          <img src={show.poster_url} alt={show.show_name} className="rankd-poster-image" />
        ) : (
          <div className="rankd-poster-placeholder">{show.show_name}</div>
        )}
      </div>
      <strong className="rankd-card-title">{show.show_name}</strong>
      {disabledLabel ? <span className="rankd-muted">{disabledLabel}</span> : null}
    </button>
  );
}

export default function Rankd() {
  const { slug: sharedSlug } = useParams();
  const [loading, setLoading] = useState(true);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [eligibleShows, setEligibleShows] = useState([]);
  const [currentPair, setCurrentPair] = useState([]);
  const [rankFocus, setRankFocus] = useState(null);
  const [matchupStats, setMatchupStats] = useState(null);
  const [overallStatsByShow, setOverallStatsByShow] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [userId, setUserId] = useState(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [moveModalShow, setMoveModalShow] = useState(null);
  const [moveTargetRank, setMoveTargetRank] = useState("");
  const [moveSaving, setMoveSaving] = useState(false);

  const touchStartX = useRef(null);
  const saveQueueRef = useRef(Promise.resolve());
  const recentShowIdsRef = useRef([]);
  const recentPairKeysRef = useRef([]);
  const userIdRef = useRef(null);
  const pairStatsRequestRef = useRef(0);
  const currentPairKey =
    currentPair.length === 2 ? makePairKey(currentPair[0].show_id, currentPair[1].show_id) : "";

  const leaderboard = useMemo(() => [...eligibleShows].sort(sortByLadder), [eligibleShows]);
  const isSharedPage = Boolean(sharedSlug);
  const isLoggedIn = Boolean(userId);

  function storeActiveUserId(nextUserId) {
    const cleanUserId = nextUserId || null;
    userIdRef.current = cleanUserId;
    setUserId(cleanUserId);
    return cleanUserId;
  }

  async function ensureActiveUserId() {
    if (userIdRef.current) return userIdRef.current;
    if (userId) return userId;

    const user = await getOptionalUser();
    return storeActiveUserId(user?.id || null);
  }

  async function buildShowsForRows(userIdValue, rows, startIndex = 0) {
    const showIds = rows.map((row) => row.show_id).filter(Boolean);
    const rankingMap = await fetchRankingMap(userIdValue, showIds);

    return rows
      .map((row, index) =>
        normalizeShowRow(row, rankingMap.get(String(row.show_id)), startIndex + index + 1)
      )
      .filter((show) => show.show_id && show.show_name)
      .sort(sortByLadder)
      .map((show, index) => ({
        ...show,
        ladder_position: show.ladder_position ?? startIndex + index + 1,
      }));
  }

  async function loadSharedMatchup(user) {
    const { data, error: sharedError } = await supabase
      .from("rankd_matchups")
      .select("*, show_a:show_a_id(id, tvdb_id, name, poster_url), show_b:show_b_id(id, tvdb_id, name, poster_url)")
      .eq("share_slug", sharedSlug)
      .eq("is_shareable", true)
      .maybeSingle();

    if (sharedError) throw sharedError;
    if (!data?.id) throw new Error("This shared Rank'd matchup could not be found.");

    const pair = [normalizeShowRow(data.show_a), normalizeShowRow(data.show_b)].filter(Boolean);
    setEligibleShows(pair);
    setCurrentPair(pair);
    setMatchupStats(data);
    storeActiveUserId(user?.id || null);
    setLoading(false);
  }

  async function loadRestInBackground(userIdValue, startFrom) {
    setBackgroundLoading(true);

    try {
      let from = startFrom;
      let safety = 0;

      while (safety < 20) {
        const rows = await fetchRankdShowPage(userIdValue, from, from + BACKGROUND_PAGE_SIZE - 1);
        if (!rows.length) break;

        const shows = await buildShowsForRows(userIdValue, rows, from);
        setEligibleShows((prev) => mergeShows(prev, shows));

        if (rows.length < BACKGROUND_PAGE_SIZE) break;
        from += BACKGROUND_PAGE_SIZE;
        safety += 1;
      }
    } catch (backgroundError) {
      console.warn("Rankd background load failed:", backgroundError);
    } finally {
      setBackgroundLoading(false);
    }
  }

  async function loadCurrentPairStats(pair) {
    if (!pair || pair.length !== 2) {
      setMatchupStats(null);
      setOverallStatsByShow({});
      return;
    }

    const requestId = pairStatsRequestRef.current + 1;
    pairStatsRequestRef.current = requestId;

    try {
      setMatchupStats(null);
      setOverallStatsByShow({});

      const [pairStats, overallStats] = await Promise.all([
        fetchMatchupStatsForPair(pair[0].show_id, pair[1].show_id),
        fetchOverallStatsForShows([pair[0].show_id, pair[1].show_id]),
      ]);

      if (pairStatsRequestRef.current !== requestId) return;

      setMatchupStats(pairStats);
      setOverallStatsByShow(overallStats);
    } catch (statsError) {
      console.warn("Rankd stats load failed:", statsError);
      if (pairStatsRequestRef.current !== requestId) return;
      setMatchupStats(null);
      setOverallStatsByShow({});
    }
  }

  async function loadRankd() {
    try {
      setLoading(true);
      setError("");
      setNotice("");
      setShareStatus("");
      setSaveStatus("");

      const user = await getOptionalUser();
      const activeUserId = storeActiveUserId(user?.id || null);

      if (sharedSlug) {
        await loadSharedMatchup(user);
        return;
      }

      if (!activeUserId) {
        setEligibleShows([]);
        setCurrentPair([]);
        setLoading(false);
        return;
      }

      recentShowIdsRef.current = readRecentShows(activeUserId);

      let rows = await fetchRankdShowPage(activeUserId, 0, FRONTLOAD_SHOW_COUNT - 1);
      let nextFrom = FRONTLOAD_SHOW_COUNT;

      if (rows.length < 2) {
        const moreRows = await fetchRankdShowPage(
          activeUserId,
          FRONTLOAD_SHOW_COUNT,
          FRONTLOAD_SHOW_COUNT + BACKGROUND_PAGE_SIZE - 1
        );
        rows = [...rows, ...moreRows];
        nextFrom = FRONTLOAD_SHOW_COUNT + BACKGROUND_PAGE_SIZE;
      }

      const initialShows = await buildShowsForRows(activeUserId, rows, 0);
      setEligibleShows(initialShows);

      const firstPair = chooseFastPair(initialShows, "", recentShowIdsRef.current, recentPairKeysRef.current);
      setCurrentPair(firstPair);
      setMatchupStats(null);
      setOverallStatsByShow({});
      setLoading(false);

      if (firstPair.length === 2) {
        recentPairKeysRef.current = [makePairKey(firstPair[0].show_id, firstPair[1].show_id)];
      }

      loadRestInBackground(activeUserId, nextFrom);
    } catch (loadError) {
      console.error("RANKD LOAD FAILED:", loadError);
      setError(loadError.message || "Failed to load Rank'd.");
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRankd();
  }, [sharedSlug]);

  useEffect(() => {
    loadCurrentPairStats(currentPair);
  }, [currentPairKey]);

  function queueVoteSave({ userIdValue, winner, loser, beforeLadder, updatedLadder }) {
    const now = new Date().toISOString();
    const beforeById = new Map(beforeLadder.map((show) => [String(show.show_id), show]));

    const rankingPayload = updatedLadder
      .filter((show) => {
        const before = beforeById.get(String(show.show_id));
        return (
          !before ||
          before.ladder_position !== show.ladder_position ||
          String(show.show_id) === String(winner.show_id) ||
          String(show.show_id) === String(loser.show_id)
        );
      })
      .map((show) => ({
        user_id: userIdValue,
        show_id: show.show_id,
        ladder_position: show.ladder_position,
        wins: show.rank_wins || 0,
        losses: show.rank_losses || 0,
        comparisons: show.rank_comparisons || 0,
        updated_at: now,
      }));

    const { showAId, showBId } = getOrderedPair(winner.show_id, loser.show_id);
    setSaveStatus("Saving vote...");

    saveQueueRef.current = saveQueueRef.current
      .catch(() => null)
      .then(async () => {
        if (rankingPayload.length) {
          const { error: rankingError } = await supabase
            .from("user_show_rankings")
            .upsert(rankingPayload, { onConflict: "user_id,show_id" });

          if (rankingError) throw rankingError;
        }

        const { error: matchupError } = await supabase.rpc(
          "rankd_record_matchup_vote",
          {
            p_show_a_id: showAId,
            p_show_b_id: showBId,
            p_winner_show_id: String(winner.show_id),
            p_loser_show_id: String(loser.show_id),
          }
        );

        if (matchupError) throw matchupError;
      })
      .then(() => setSaveStatus(""))
      .catch((saveError) => {
        console.error("RANKD BACKGROUND SAVE FAILED:", saveError);
        setSaveStatus("Vote saved locally. Sync will retry on your next vote.");
      });
  }

  async function saveManualMove(userIdValue, affectedShows) {
    if (!affectedShows.length) return;

    const now = new Date().toISOString();
    const payload = affectedShows.map((show) => ({
      user_id: userIdValue,
      show_id: show.show_id,
      ladder_position: show.ladder_position,
      wins: show.rank_wins || 0,
      losses: show.rank_losses || 0,
      comparisons: show.rank_comparisons || 0,
      updated_at: now,
    }));

    const { error: moveError } = await supabase
      .from("user_show_rankings")
      .upsert(payload, { onConflict: "user_id,show_id" });

    if (moveError) throw moveError;
  }

  function openMoveModal(show, position) {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }

    setMoveModalShow(show);
    setMoveTargetRank(String(position));
    setError("");
  }

  async function handleMoveSubmit(event) {
    event.preventDefault();

    if (!moveModalShow) return;

    const targetRank = Number.parseInt(moveTargetRank, 10);
    if (!Number.isFinite(targetRank) || targetRank < 1) {
      setError("Enter a valid rank number.");
      return;
    }

    try {
      setMoveSaving(true);
      setError("");

      const activeUserId = await ensureActiveUserId();
      if (!activeUserId) {
        setShowLoginModal(true);
        return;
      }

      const beforeShows = [...eligibleShows].sort(sortByLadder);
      const { nextShows, affectedShows } = moveShowToRank(
        beforeShows,
        moveModalShow.show_id,
        targetRank
      );

      if (!affectedShows.length) {
        setMoveModalShow(null);
        setMoveTargetRank("");
        return;
      }

      setEligibleShows(nextShows);
      setMoveModalShow(null);
      setMoveTargetRank("");

      await saveManualMove(activeUserId, affectedShows);
    } catch (moveError) {
      console.error("RANKD MANUAL MOVE FAILED:", moveError);
      setError(moveError.message || "Could not move this show.");
    } finally {
      setMoveSaving(false);
    }
  }

  async function handleChoice(winnerShowId) {
    if (currentPair.length !== 2) return;

    const activeUserId = await ensureActiveUserId();

    if (!activeUserId && !isSharedPage) {
      setShowLoginModal(true);
      return;
    }

    const [firstShow, secondShow] = currentPair;
    const winner = String(firstShow.show_id) === String(winnerShowId) ? firstShow : secondShow;
    const loser = String(firstShow.show_id) === String(winnerShowId) ? secondShow : firstShow;
    const beforeLadder = [...eligibleShows]
      .sort(sortByLadder)
      .map((show, index) => ({
        ...show,
        ladder_position: show.ladder_position ?? index + 1,
      }));

    const updatedLadder = applyLadderWin(beforeLadder, winner.show_id, loser.show_id).map((show) => {
      if (String(show.show_id) === String(winner.show_id)) {
        return {
          ...show,
          rank_wins: Number(show.rank_wins || 0) + 1,
          rank_comparisons: Number(show.rank_comparisons || 0) + 1,
        };
      }

      if (String(show.show_id) === String(loser.show_id)) {
        return {
          ...show,
          rank_losses: Number(show.rank_losses || 0) + 1,
          rank_comparisons: Number(show.rank_comparisons || 0) + 1,
        };
      }

      return show;
    });

    const nextRecentShows = [String(winner.show_id), String(loser.show_id), ...recentShowIdsRef.current];
    recentShowIdsRef.current = nextRecentShows.slice(0, RECENT_SHOW_LIMIT);
    writeRecentShows(activeUserId, recentShowIdsRef.current);

    const previousPairKey = currentPairKey;
    let nextFocus = rankFocus;
    let nextPair = [];
    let nextNotice = "";

    if (rankFocus?.showId) {
      const focusWon = String(winner.show_id) === String(rankFocus.showId);
      const opponent = focusWon ? loser : winner;
      const focusIndexBefore = beforeLadder.findIndex(
        (show) => String(show.show_id) === String(rankFocus.showId)
      );
      const opponentIndexBefore = beforeLadder.findIndex(
        (show) => String(show.show_id) === String(opponent.show_id)
      );
      const opponentWasAbove =
        focusIndexBefore >= 0 && opponentIndexBefore >= 0 && opponentIndexBefore < focusIndexBefore;
      const opponentWasBelow =
        focusIndexBefore >= 0 && opponentIndexBefore >= 0 && opponentIndexBefore > focusIndexBefore;

      nextFocus = {
        ...rankFocus,
        direction: focusWon ? "up" : "down",
        checkedAbove: Boolean(rankFocus.checkedAbove || opponentWasAbove),
        checkedBelow: Boolean(rankFocus.checkedBelow || opponentWasBelow),
        testedIds: [
          ...new Set([
            ...(rankFocus.testedIds || []),
            String(opponent.show_id),
          ]),
        ],
        beatenIds: focusWon
          ? [
              ...new Set([
                ...(rankFocus.beatenIds || []),
                String(opponent.show_id),
              ]),
            ]
          : rankFocus.beatenIds || [],
        lostToIds: !focusWon
          ? [
              ...new Set([
                ...(rankFocus.lostToIds || []),
                String(opponent.show_id),
              ]),
            ]
          : rankFocus.lostToIds || [],
      };

      if (isFocusSettled(updatedLadder, nextFocus)) {
        nextFocus = null;
        setRankFocus(null);
        nextNotice = `${rankFocus.showName || "This show"} is now in its confirmed position.`;
      } else {
        nextPair = getFocusedPair(updatedLadder, nextFocus.showId, nextFocus);
        if (nextPair.length === 2) {
          setRankFocus(nextFocus);
          nextNotice = `Ranking ${rankFocus.showName || "this show"}. Checking ${
            nextFocus.direction === "up" ? "higher" : "lower"
          } in your list.`;
        } else {
          nextFocus = null;
          setRankFocus(null);
          nextNotice = `${rankFocus.showName || "This show"} is now in the best confirmed position from the available comparisons.`;
        }
      }
    }

    if (!nextFocus) {
      nextPair = chooseFastPair(
        updatedLadder,
        previousPairKey,
        recentShowIdsRef.current,
        [previousPairKey, ...recentPairKeysRef.current]
      );
    }

    const nextPairKey = nextPair.length === 2 ? makePairKey(nextPair[0].show_id, nextPair[1].show_id) : "";
    recentPairKeysRef.current = [nextPairKey, previousPairKey, ...recentPairKeysRef.current]
      .filter(Boolean)
      .filter((pairKey, index, list) => list.indexOf(pairKey) === index)
      .slice(0, RECENT_PAIR_LIMIT);

    setEligibleShows(updatedLadder);
    setCurrentPair(nextPair);
    setMatchupStats(null);
    setOverallStatsByShow({});
    setNotice(nextNotice);

    if (activeUserId) {
      queueVoteSave({ userIdValue: activeUserId, winner, loser, beforeLadder, updatedLadder });
    }
  }

  function buildTouchStartHandler() {
    return (event) => {
      touchStartX.current = event.touches?.[0]?.clientX ?? null;
    };
  }

  function buildTouchEndHandler(showId, side) {
    return (event) => {
      const startX = touchStartX.current;
      const endX = event.changedTouches?.[0]?.clientX ?? null;
      if (startX == null || endX == null) return;

      const deltaX = endX - startX;
      if (side === "left" && deltaX <= -SWIPE_THRESHOLD) handleChoice(showId);
      if (side === "right" && deltaX >= SWIPE_THRESHOLD) handleChoice(showId);
    };
  }

  async function handleShareMatchup() {
    if (currentPair.length !== 2) return;

    try {
      setShareStatus("Saving share link...");
      const { showAId, showBId, pairKey } = getOrderedPair(currentPair[0].show_id, currentPair[1].show_id);

      const { data: existing, error: existingError } = await supabase
        .from("rankd_matchups")
        .select("id, share_slug")
        .eq("pair_key", pairKey)
        .maybeSingle();

      if (existingError) throw existingError;

      let shareSlug = existing?.share_slug || "";
      if (!shareSlug) {
        shareSlug = `${String(currentPair[0].show_name || "show")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 50)}-vs-${String(currentPair[1].show_name || "show")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 50)}-${Math.random().toString(36).slice(2, 8)}`;

        if (existing?.id) {
          const { error: updateError } = await supabase
            .from("rankd_matchups")
            .update({ share_slug: shareSlug, is_shareable: true })
            .eq("id", existing.id);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase.from("rankd_matchups").insert({
            show_a_id: showAId,
            show_b_id: showBId,
            pair_key: pairKey,
            show_a_wins: 0,
            show_b_wins: 0,
            times_matched: 0,
            share_slug: shareSlug,
            is_shareable: true,
          });
          if (insertError) throw insertError;
        }
      }

      const shareUrl = `${window.location.origin}/rankd/share/${shareSlug}`;
      await navigator.clipboard?.writeText(shareUrl);
      setShareStatus("Share link copied.");
    } catch (shareError) {
      console.error("RANKD SHARE FAILED:", shareError);
      setShareStatus(shareError.message || "Could not create share link.");
    }
  }

  function handleAddComment(event) {
    event.preventDefault();
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }

    setCommentText("");
    setNotice("Comments are being reconnected after the Rank'd speed update.");
  }

  function startFocusedRanking(show) {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }

    const focus = {
      showId: show.show_id,
      showName: show.show_name,
      testedIds: [],
      beatenIds: [],
      lostToIds: [],
      checkedAbove: false,
      checkedBelow: false,
      direction: "up",
    };

    const pair = getFocusedPair(eligibleShows, show.show_id, focus);
    if (pair.length !== 2) {
      setNotice("No untested shows are available for this title.");
      return;
    }

    setRankFocus(focus);
    setCurrentPair(pair);
    setNotice(
      `Ranking ${show.show_name}. BURGRS will move it higher or lower until its position is confirmed.`
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loading) {
    return (
      <div className="page rankd-page">
        <div className="page-shell">
          <div className="page-header">
            <h1>Rank'd</h1>
            <p>Front-loading your first matchups...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!userId && !isSharedPage) {
    return (
      <div className="page rankd-page">
        <div className="page-shell">
          <div className="page-header">
            <h1>Rank'd</h1>
            <p>Log in to rank your shows.</p>
          </div>
          <button type="button" className="top-tab active" onClick={() => setShowLoginModal(true)}>
            Log in
          </button>
          <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} redirectTo="/rankd" />
        </div>
      </div>
    );
  }

  if (eligibleShows.length < 2 || currentPair.length < 2) {
    return (
      <div className="page rankd-page">
        <div className="page-shell">
          <div className="page-header">
            <h1>Rank'd</h1>
            <p>Swipe your favourite shows against each other to build your personal ranking.</p>
          </div>

          {error ? (
            <div className="section-card rankd-error-card">
              <strong>Something went wrong</strong>
              <span>{error}</span>
            </div>
          ) : null}

          <div className="section-card rankd-empty-card">
            <p>You need at least 2 eligible shows before Rank'd can start.</p>
            <p>Completed shows count automatically. Watching shows are included once at least one full season has been watched.</p>
            <Link to="/my-shows" className="top-tab active">
              Go to My Shows
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const leftWinPercent = getWinPercent(matchupStats, currentPair[0].show_id);
  const rightWinPercent = getWinPercent(matchupStats, currentPair[1].show_id);
  const leftWins = getWinCount(matchupStats, currentPair[0].show_id);
  const rightWins = getWinCount(matchupStats, currentPair[1].show_id);
  const leftOverallStats = getOverallStats(overallStatsByShow, currentPair[0].show_id);
  const rightOverallStats = getOverallStats(overallStatsByShow, currentPair[1].show_id);

  return (
    <div className="page rankd-page">
      <div className="page-shell">
        {!isSharedPage ? (
          <div className="rankd-matchup-number">
            Matchup #{Math.floor(leaderboard.reduce((total, show) => total + Number(show.rank_comparisons || 0), 0) / 2) + 1}
          </div>
        ) : null}

        {backgroundLoading ? (
          <div className="section-card rankd-notice-card">
            <strong>Preparing the rest of your Rank'd list...</strong>
            <span>You can start voting now. More shows are loading in the background.</span>
          </div>
        ) : null}

        {saveStatus ? (
          <div className="section-card rankd-notice-card">
            <strong>{saveStatus}</strong>
            <span>The next matchup is ready while BURGRS syncs your vote.</span>
          </div>
        ) : null}

        {error ? (
          <div className="section-card rankd-error-card">
            <strong>Something went wrong</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {notice ? (
          <div className="section-card rankd-notice-card">
            <strong>{notice}</strong>
          </div>
        ) : null}

        <div className="rankd-main-grid">
          <div id="rankd-top" className="section-card rankd-battle-shell">
            <div className="rankd-battle-layout">
              <RankCard
                show={currentPair[0]}
                onChoose={() => handleChoice(currentPair[0].show_id)}
                onTouchStart={buildTouchStartHandler()}
                onTouchEnd={buildTouchEndHandler(currentPair[0].show_id, "left")}
                disabledLabel={!isLoggedIn && isSharedPage ? "Sign in to vote" : ""}
              />

              <div className="rankd-battle-vs">VS</div>

              <RankCard
                show={currentPair[1]}
                onChoose={() => handleChoice(currentPair[1].show_id)}
                onTouchStart={buildTouchStartHandler()}
                onTouchEnd={buildTouchEndHandler(currentPair[1].show_id, "right")}
                disabledLabel={!isLoggedIn && isSharedPage ? "Sign in to vote" : ""}
              />
            </div>

            <div className="rankd-matchup-dashboard">
              <div className="rankd-win-bars">
                <div className="rankd-win-row">
                  <span>{currentPair[0].show_name}</span>
                  <div>
                    <i style={{ width: `${leftWinPercent}%` }} />
                  </div>
                  <strong className="rankd-win-summary">
                    <span>Overall {leftOverallStats.percent}% / {leftOverallStats.wins} wins</span>
                    <span>Matchup {leftWinPercent}% / {leftWins} wins</span>
                  </strong>
                </div>

                <div className="rankd-win-row">
                  <span>{currentPair[1].show_name}</span>
                  <div>
                    <i style={{ width: `${rightWinPercent}%` }} />
                  </div>
                  <strong className="rankd-win-summary">
                    <span>Overall {rightOverallStats.percent}% / {rightOverallStats.wins} wins</span>
                    <span>Matchup {rightWinPercent}% / {rightWins} wins</span>
                  </strong>
                </div>
              </div>
            </div>

            <form className="rankd-comment-form" onSubmit={handleAddComment}>
              <div className="rankd-comment-actions">
                <button
                  type="button"
                  className="rankd-outline-button"
                  onClick={() => setShowComments((value) => !value)}
                >
                  {showComments ? "Hide all comments" : "View all comments (0)"}
                </button>

                <button type="button" className="rankd-outline-button" onClick={handleShareMatchup}>
                  {isLoggedIn ? "Share matchup" : "Sign in to share"}
                </button>
              </div>

              {shareStatus ? <p className="rankd-muted">{shareStatus}</p> : null}

              <textarea
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder={
                  isLoggedIn
                    ? "Write a brief comment about this matchup..."
                    : "Sign in to comment on this matchup..."
                }
                rows={3}
              />

              <button type="submit" disabled={!commentText.trim()}>
                {!isLoggedIn ? "Sign in to comment" : "Post comment"}
              </button>
            </form>

            {showComments ? (
              <div className="rankd-comments-panel">
                <div className="rankd-comments-header">
                  <h2>Matchup comments</h2>
                  <button type="button" className="rankd-text-button" onClick={() => setShowComments(false)}>
                    Hide
                  </button>
                </div>
                <p className="rankd-muted">No comments yet. Add the first one.</p>
              </div>
            ) : null}
          </div>

          <div className="section-card rankd-leaderboard-card">
            <div className="rankd-leaderboard-header">
              <div>
                <h2>{isLoggedIn ? "Your Top Shows" : "This Matchup"}</h2>
                <p>
                  {isLoggedIn
                    ? "Your personal ladder from Rank'd decisions."
                    : "Sign in to add these shows and build your personal ladder."}
                </p>
              </div>
              <div>{leaderboard.length} shows</div>
            </div>

            <div className="rankd-leaderboard-list">
              {leaderboard.map((show, index) => (
                <Link
                  key={show.show_id}
                  to={isLoggedIn && show.tvdb_id ? `/my-shows/${show.tvdb_id}` : "#"}
                  className="rankd-leaderboard-row"
                  onClick={(event) => {
                    if (!isLoggedIn || !show.tvdb_id) event.preventDefault();
                  }}
                >
                  <div className="rankd-leaderboard-poster">
                    {show.poster_url ? <img src={show.poster_url} alt={show.show_name} /> : <span>#{index + 1}</span>}
                  </div>

                  <div>
                    <div className="rankd-leaderboard-title">
                      #{index + 1} {show.show_name}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="rankd-rank-button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      startFocusedRanking(show);
                    }}
                  >
                    {isLoggedIn ? "Rank" : "Sign in"}
                  </button>

                  <button
                    type="button"
                    className="rankd-rank-button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openMoveModal(show, index + 1);
                    }}
                  >
                    Move
                  </button>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} redirectTo="/rankd" />

        {moveModalShow ? (
          <div className="login-modal-overlay">
            <div className="login-modal-card">
              <button
                type="button"
                className="login-modal-close"
                onClick={() => {
                  setMoveModalShow(null);
                  setMoveTargetRank("");
                }}
              >
                ×
              </button>

              <h2>Move rank</h2>
              <p className="login-modal-intro">
                Move <strong>{moveModalShow.show_name}</strong> to position:
              </p>

              <form className="login-modal-form" onSubmit={handleMoveSubmit}>
                <input
                  type="number"
                  min="1"
                  max={leaderboard.length}
                  value={moveTargetRank}
                  onChange={(event) => setMoveTargetRank(event.target.value)}
                  placeholder="Rank number"
                  autoFocus
                  required
                />

                <button type="submit" disabled={moveSaving}>
                  {moveSaving ? "Moving..." : "Move show"}
                </button>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
