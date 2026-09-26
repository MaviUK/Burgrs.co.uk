import { supabase } from "./lib/supabase";

const PENDING_KEY = "burgrs_pending_rankd_signup_shows";
const GUEST_TOKEN_KEY = "burgrs_rankd_guest_token";
const VOTED_KEY_PREFIX = "burgrs_rankd_guest_voted:";
let cachedSharedMatchup = null;
let voteInFlight = false;
let guestVoteLocked = false;
let claimInFlight = false;

function isSharedRankdPage() {
  return window.location.pathname.startsWith("/rankd/share/");
}

function getSharedSlug() {
  return decodeURIComponent(window.location.pathname.replace(/^\/rankd\/share\//, "").split(/[/?#]/)[0] || "");
}

function getGuestVoteKey() {
  return `${VOTED_KEY_PREFIX}${getSharedSlug()}`;
}

function createGuestToken() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getOrCreateGuestToken() {
  try {
    const existing = window.localStorage.getItem(GUEST_TOKEN_KEY);
    if (existing) return existing;

    const token = createGuestToken();
    window.localStorage.setItem(GUEST_TOKEN_KEY, token);
    return token;
  } catch {
    return createGuestToken();
  }
}

function hasAlreadyGuestVoted() {
  try {
    return window.localStorage.getItem(getGuestVoteKey()) === "1";
  } catch {
    return guestVoteLocked;
  }
}

function markGuestVoted() {
  guestVoteLocked = true;
  try {
    window.localStorage.setItem(getGuestVoteKey(), "1");
  } catch {
    // Ignore storage failures.
  }
}

async function getActiveUser() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user || null;
}

async function loadSharedMatchup() {
  if (cachedSharedMatchup?.share_slug === getSharedSlug()) return cachedSharedMatchup;

  const slug = getSharedSlug();
  if (!slug) return null;

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
      show_a:show_a_id(id, tvdb_id, tmdb_id, name, poster_url),
      show_b:show_b_id(id, tvdb_id, tmdb_id, name, poster_url)
    `)
    .eq("share_slug", slug)
    .eq("is_shareable", true)
    .maybeSingle();

  if (error) throw error;
  cachedSharedMatchup = data || null;
  return cachedSharedMatchup;
}

function closeSharedVoteWindow() {
  window.open("", "_self");
  window.close();

  window.setTimeout(() => {
    if (!document.hidden) {
      window.location.replace("/");
    }
  }, 220);
}

function showGuestThanksModal(matchup, winnerName) {
  document.querySelector(".rankd-guest-thanks-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "rankd-guest-thanks-overlay";

  const card = document.createElement("div");
  card.className = "rankd-guest-thanks-card";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "rankd-guest-thanks-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closeSharedVoteWindow);

  const title = document.createElement("h2");
  title.textContent = "Thanks for voting";

  const intro = document.createElement("p");
  intro.textContent = `${winnerName} got your vote. Sign up and BURGRS will add both shows to your list so you can start ranking properly.`;

  const actions = document.createElement("div");
  actions.className = "rankd-guest-thanks-actions";

  const signup = document.createElement("button");
  signup.type = "button";
  signup.className = "rankd-guest-primary";
  signup.textContent = "Sign up and add shows";
  signup.addEventListener("click", () => {
    savePendingShows(matchup);
    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
  });

  const stay = document.createElement("button");
  stay.type = "button";
  stay.className = "rankd-guest-secondary";
  stay.textContent = "Not now";
  stay.addEventListener("click", closeSharedVoteWindow);

  actions.appendChild(signup);
  actions.appendChild(stay);
  card.appendChild(close);
  card.appendChild(title);
  card.appendChild(intro);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function savePendingShows(matchup) {
  if (!matchup?.show_a_id || !matchup?.show_b_id) return;

  const payload = {
    createdAt: Date.now(),
    source: "rankd_shared_vote",
    showIds: [matchup.show_a_id, matchup.show_b_id],
    shareSlug: matchup.share_slug,
  };

  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}

function readPendingShows() {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.showIds) || parsed.showIds.length < 2) return null;
    if (Date.now() - Number(parsed.createdAt || 0) > 1000 * 60 * 60 * 24) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function addPendingShowsToUser() {
  if (claimInFlight) return;

  const pending = readPendingShows();
  if (!pending?.showIds?.length) return;

  const user = await getActiveUser();
  if (!user?.id) return;

  claimInFlight = true;

  try {
    const payload = pending.showIds.map((showId) => ({
      user_id: user.id,
      show_id: showId,
      watch_status: "watchlist",
    }));

    const { error } = await supabase.from("user_shows_new").upsert(payload, {
      onConflict: "user_id,show_id",
    });

    if (error) throw error;

    window.localStorage.removeItem(PENDING_KEY);
    showClaimedShowsToast();
  } catch (error) {
    console.warn("Could not add shared Rankd shows after signup:", error);
  } finally {
    claimInFlight = false;
  }
}

function showClaimedShowsToast() {
  let toast = document.querySelector(".rankd-guest-claim-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "rankd-guest-claim-toast";
    document.body.appendChild(toast);
  }

  toast.textContent = "Added both shows to your My Shows list.";
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function findWinnerFromButton(button, matchup) {
  const label = button?.getAttribute("aria-label") || button?.getAttribute("title") || button?.textContent || "";
  const clean = label.replace(/^choose\s+/i, "").trim().toLowerCase();

  const showAName = String(matchup?.show_a?.name || "").trim().toLowerCase();
  const showBName = String(matchup?.show_b?.name || "").trim().toLowerCase();

  if (clean && showAName && clean.includes(showAName)) return matchup.show_a;
  if (clean && showBName && clean.includes(showBName)) return matchup.show_b;

  const buttons = Array.from(document.querySelectorAll(".rankd-page .rankd-poster-button"));
  const index = buttons.indexOf(button);
  return index === 0 ? matchup.show_a : matchup.show_b;
}

function lockRankdPosterButtons() {
  document.querySelectorAll(".rankd-page .rankd-poster-button").forEach((posterButton) => {
    posterButton.disabled = true;
    posterButton.style.pointerEvents = "none";
    posterButton.style.opacity = "0.65";
  });
}

async function handleGuestSharedVote(event) {
  if (!isSharedRankdPage()) return;

  const button = event.target?.closest?.(".rankd-page .rankd-poster-button");
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();

  const user = await getActiveUser();
  if (user?.id) return;

  if (voteInFlight || guestVoteLocked || hasAlreadyGuestVoted()) {
    showGuestThanksModal(cachedSharedMatchup, "Your pick");
    return;
  }

  voteInFlight = true;
  markGuestVoted();
  lockRankdPosterButtons();

  let matchup = cachedSharedMatchup;
  let winnerName = "Your pick";

  try {
    matchup = await loadSharedMatchup();
    if (!matchup?.show_a_id || !matchup?.show_b_id) throw new Error("Matchup not found.");

    const winner = findWinnerFromButton(button, matchup);
    const loser = String(winner?.id) === String(matchup.show_a_id) ? matchup.show_b : matchup.show_a;
    winnerName = winner?.name || "Your pick";

    savePendingShows(matchup);
    showGuestThanksModal(matchup, winnerName);

    const { showAId, showBId } = [matchup.show_a_id, matchup.show_b_id]
      .map(String)
      .sort()
      .reduce((acc, id, index) => {
        if (index === 0) acc.showAId = id;
        else acc.showBId = id;
        return acc;
      }, {});

    const guestToken = getOrCreateGuestToken();
    const { data: voteResult, error } = await supabase.functions.invoke(
      "rankd-guest-vote",
      {
        body: {
          share_slug: matchup.share_slug,
          guest_token: guestToken,
          winner_show_id: String(winner.id),
          loser_show_id: String(loser.id),
        },
      }
    );

    if (error) throw error;
    if (voteResult?.rate_limited) {
      throw new Error(voteResult?.message || "Too many guest votes. Try again later.");
    }
    if (!voteResult?.recorded && !voteResult?.duplicate) {
      throw new Error("Guest vote was not recorded.");
    }
    window.dispatchEvent(new CustomEvent("rankd:guest-vote-recorded"));
  } catch (error) {
    console.warn("Guest shared Rankd vote failed:", error);
    if (!document.querySelector(".rankd-guest-thanks-overlay")) {
      showGuestThanksModal(matchup, winnerName);
    }
  } finally {
    voteInFlight = false;
  }
}

if (typeof window !== "undefined") {
  document.addEventListener("click", handleGuestSharedVote, true);

  const runClaim = () => window.setTimeout(addPendingShowsToUser, 500);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runClaim, { once: true });
  } else {
    runClaim();
  }

  supabase.auth.onAuthStateChange(() => runClaim());
  window.addEventListener("popstate", runClaim);
}
