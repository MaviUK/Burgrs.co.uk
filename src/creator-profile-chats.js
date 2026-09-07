import { supabase } from "./lib/supabase";

const CHAT_BUTTON_ATTR = "data-creator-chats-stat";
const CHAT_PANEL_ATTR = "data-creator-chats-panel";
const CHAT_EXTERNAL_PANEL_ATTR = "data-creator-chats-external-panel";

let routeKey = "";
let profileId = null;
let chatCount = 0;
let chats = [];
let savedShowIds = new Set();
let loadingPromise = null;
let loadedRouteKey = "";
let loadError = "";
let chatsActive = false;
let syncScheduled = false;

function currentProfileSlug() {
  const match = window.location.pathname.match(/^\/u\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]).replace(/^@/, "") : "";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function getNativePanel() {
  return document.querySelector(
    `.creator-page .creator-profile-panel:not([${CHAT_EXTERNAL_PANEL_ATTR}])`
  );
}

function getExternalPanel() {
  return document.querySelector(`[${CHAT_EXTERNAL_PANEL_ATTR}]`);
}

function restoreNativePanel() {
  const nativePanel = getNativePanel();
  const externalPanel = getExternalPanel();

  if (nativePanel) {
    nativePanel.hidden = false;
    nativePanel.removeAttribute(CHAT_PANEL_ATTR);
  }

  if (externalPanel) {
    externalPanel.hidden = true;
    externalPanel.setAttribute("aria-hidden", "true");
  }
}

function removeExternalPanel() {
  getExternalPanel()?.remove();
}

function resetForRoute(nextRouteKey) {
  restoreNativePanel();
  removeExternalPanel();

  routeKey = nextRouteKey;
  profileId = null;
  chatCount = 0;
  chats = [];
  savedShowIds = new Set();
  loadingPromise = null;
  loadedRouteKey = "";
  loadError = "";
  chatsActive = false;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function publicShowHref(show) {
  if (show?.tmdb_id) return `/show/tmdb/${show.tmdb_id}`;
  if (show?.tvdb_id) return `/show/${show.tvdb_id}`;
  return show?.id ? `/show/${show.id}` : "#";
}

function chatHref(chat) {
  const show = chat?.show;
  if (!show) return "#";

  if (savedShowIds.has(String(show.id))) {
    const params = new URLSearchParams({
      notificationType: "chat_reply",
      notificationTarget: String(chat.id),
      chat: "1",
    });

    if (show.tmdb_id) {
      return `/my-shows/tmdb/${show.tmdb_id}?${params.toString()}`;
    }

    if (show.tvdb_id) {
      return `/my-shows/${show.tvdb_id}?${params.toString()}`;
    }
  }

  return publicShowHref(show);
}

async function resolveProfile(slug) {
  let result = await supabase
    .from("profiles")
    .select("id")
    .eq("username", slug)
    .maybeSingle();

  if (!result.data && !result.error && isUuid(slug)) {
    result = await supabase
      .from("profiles")
      .select("id")
      .eq("id", slug)
      .maybeSingle();
  }

  if (result.error) throw result.error;
  return result.data || null;
}

async function loadCreatorChats(slug, expectedRouteKey) {
  const profile = await resolveProfile(slug);
  if (!profile?.id || routeKey !== expectedRouteKey) return;

  profileId = profile.id;

  const [
    { count, error: countError },
    { data: messageRows, error: messagesError },
    authResult,
  ] = await Promise.all([
    supabase
      .from("show_chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id),
    supabase
      .from("show_chat_messages")
      .select("id, show_id, parent_id, body, created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.auth.getUser(),
  ]);

  if (countError) throw countError;
  if (messagesError) throw messagesError;

  const rows = messageRows || [];
  const showIds = Array.from(
    new Set(rows.map((row) => row.show_id).filter(Boolean))
  );
  let showMap = new Map();

  if (showIds.length) {
    const { data: showRows, error: showsError } = await supabase
      .from("shows")
      .select("id, name, tvdb_id, tmdb_id, poster_url")
      .in("id", showIds);

    if (showsError) throw showsError;
    showMap = new Map(
      (showRows || []).map((show) => [String(show.id), show])
    );
  }

  const viewer = authResult?.data?.user || null;
  let nextSavedShowIds = new Set();

  if (viewer?.id) {
    const { data: savedRows, error: savedError } = await supabase
      .from("user_shows_new")
      .select("show_id")
      .eq("user_id", viewer.id);

    if (!savedError) {
      nextSavedShowIds = new Set(
        (savedRows || []).map((row) => String(row.show_id)).filter(Boolean)
      );
    }
  }

  if (routeKey !== expectedRouteKey) return;

  chatCount = count || 0;
  savedShowIds = nextSavedShowIds;
  chats = rows.map((row) => ({
    ...row,
    show: showMap.get(String(row.show_id)) || null,
  }));
}

function ensureDataLoaded(slug, expectedRouteKey) {
  if (loadedRouteKey === expectedRouteKey) {
    return Promise.resolve();
  }

  if (loadingPromise) return loadingPromise;

  loadError = "";
  loadingPromise = loadCreatorChats(slug, expectedRouteKey)
    .then(() => {
      if (routeKey === expectedRouteKey) {
        loadedRouteKey = expectedRouteKey;
      }
    })
    .catch((error) => {
      console.error("Failed loading creator chats", error);
      if (routeKey === expectedRouteKey) {
        loadedRouteKey = expectedRouteKey;
        loadError = error?.message || "Could not load chatboard activity.";
        chatCount = 0;
        chats = [];
      }
    })
    .finally(() => {
      loadingPromise = null;
      scheduleSync();
    });

  return loadingPromise;
}

function createChatCard(chat) {
  const link = document.createElement("a");
  link.className = "creator-chat-card";
  link.href = chatHref(chat);

  const show = chat.show;
  if (show?.poster_url) {
    const poster = document.createElement("img");
    poster.src = show.poster_url;
    poster.alt = "";
    poster.className = "creator-chat-poster";
    link.appendChild(poster);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className =
      "creator-chat-poster creator-chat-poster-placeholder";
    placeholder.textContent = "TV";
    link.appendChild(placeholder);
  }

  const copy = document.createElement("div");
  copy.className = "creator-chat-copy";

  const topLine = document.createElement("div");
  topLine.className = "creator-chat-topline";

  const showName = document.createElement("strong");
  showName.textContent = show?.name || "Show chat";

  const type = document.createElement("span");
  type.textContent = chat.parent_id ? "Reply" : "Message";

  topLine.append(showName, type);

  const body = document.createElement("p");
  body.textContent = chat.body || "";

  const date = document.createElement("small");
  date.textContent = formatDate(chat.created_at);

  copy.append(topLine, body, date);
  link.appendChild(copy);
  return link;
}

function ensureExternalPanel() {
  const nativePanel = getNativePanel();
  if (!nativePanel) return null;

  nativePanel.removeAttribute(CHAT_PANEL_ATTR);

  let externalPanel = getExternalPanel();
  if (!externalPanel) {
    externalPanel = document.createElement("section");
    externalPanel.setAttribute(CHAT_EXTERNAL_PANEL_ATTR, "true");
  }

  externalPanel.className = `${nativePanel.className} creator-chats-external-panel`;

  if (externalPanel.previousElementSibling !== nativePanel) {
    nativePanel.insertAdjacentElement("afterend", externalPanel);
  }

  nativePanel.hidden = chatsActive;
  externalPanel.hidden = !chatsActive;
  externalPanel.setAttribute("aria-hidden", chatsActive ? "false" : "true");

  return externalPanel;
}

function getRenderSignature() {
  return JSON.stringify({
    routeKey,
    loading: Boolean(loadingPromise && loadedRouteKey !== routeKey),
    loadError,
    chats: chats.map((chat) => [
      chat.id,
      chat.parent_id,
      chat.body,
      chat.created_at,
      chat.show?.id,
      chat.show?.name,
      chat.show?.poster_url,
    ]),
  });
}

function renderChatsPanel() {
  if (!chatsActive) {
    restoreNativePanel();
    return;
  }

  const panel = ensureExternalPanel();
  if (!panel) return;

  const signature = getRenderSignature();
  if (panel.dataset.renderSignature === signature) return;

  panel.replaceChildren();
  panel.dataset.renderSignature = signature;

  const head = document.createElement("div");
  head.className = "creator-section-head";

  const heading = document.createElement("h2");
  heading.textContent = "Chatboard activity";
  head.appendChild(heading);
  panel.appendChild(head);

  if (loadingPromise && loadedRouteKey !== routeKey) {
    const loading = document.createElement("p");
    loading.className = "creator-muted";
    loading.textContent = "Loading chats...";
    panel.appendChild(loading);
    return;
  }

  if (loadError) {
    const error = document.createElement("p");
    error.className = "creator-error";
    error.textContent = loadError;
    panel.appendChild(error);
    return;
  }

  if (!chats.length) {
    const empty = document.createElement("p");
    empty.className = "creator-muted";
    empty.textContent = "No chatboard messages yet.";
    panel.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "creator-chat-list";
  chats.forEach((chat) => list.appendChild(createChatCard(chat)));
  panel.appendChild(list);
}

function activateChats(button) {
  chatsActive = true;

  const statsCard = button.closest(".creator-stats-card");
  statsCard?.querySelectorAll("button").forEach((item) =>
    item.classList.toggle("is-active", item === button)
  );

  renderChatsPanel();
}

function deactivateChats() {
  if (!chatsActive) return;

  chatsActive = false;
  document
    .querySelector(`[${CHAT_BUTTON_ATTR}]`)
    ?.classList.remove("is-active");
  restoreNativePanel();
}

function ensureChatsButton(statsCard) {
  let button = statsCard.querySelector(`[${CHAT_BUTTON_ATTR}]`);

  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.setAttribute(CHAT_BUTTON_ATTR, "true");
    button.addEventListener("click", () => activateChats(button));

    const count = document.createElement("strong");
    const label = document.createElement("span");
    label.textContent = "Chats";
    button.append(count, label);
    statsCard.appendChild(button);
  }

  const countElement = button.querySelector("strong");
  const nextText =
    loadingPromise && !profileId && loadedRouteKey !== routeKey
      ? "…"
      : String(chatCount);

  if (countElement && countElement.textContent !== nextText) {
    countElement.textContent = nextText;
  }

  button.classList.toggle("is-active", chatsActive);
  return button;
}

function syncCreatorChats() {
  const slug = currentProfileSlug();
  const nextRouteKey = slug ? `profile:${slug}` : "";

  if (nextRouteKey !== routeKey) resetForRoute(nextRouteKey);
  if (!slug) {
    restoreNativePanel();
    return;
  }

  if (["burgrs", "admin"].includes(slug.toLowerCase())) {
    document.querySelector(`[${CHAT_BUTTON_ATTR}]`)?.remove();
    restoreNativePanel();
    return;
  }

  const statsCard = document.querySelector(
    ".creator-stats-card.creator-stats-card-clickable"
  );
  if (!statsCard) return;

  ensureDataLoaded(slug, nextRouteKey);
  ensureChatsButton(statsCard);

  if (chatsActive) renderChatsPanel();
  else restoreNativePanel();
}

function scheduleSync() {
  if (syncScheduled) return;
  syncScheduled = true;

  window.requestAnimationFrame(() => {
    syncScheduled = false;
    syncCreatorChats();
  });
}

document.addEventListener(
  "click",
  (event) => {
    const button = event.target.closest(
      ".creator-stats-card.creator-stats-card-clickable button"
    );
    if (!button || button.hasAttribute(CHAT_BUTTON_ATTR)) return;

    deactivateChats();
  },
  true
);

const observer = new MutationObserver(scheduleSync);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", scheduleSync);
window.addEventListener("pageshow", scheduleSync);
scheduleSync();
