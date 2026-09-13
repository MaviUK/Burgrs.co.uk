import { supabase } from "./lib/supabase";
import { getProfileDisplayName, getProfileHref } from "./lib/profileLinks";

const AUTO_TITLE = "Top 10 shows of all time";
const HIGHLIGHT_CLASS = "notification-target-highlight";
let scheduled = false;
let profileContext = null;
let routeKey = "";
let processingDeepLink = false;
let handledDeepLinkKey = "";

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function getSlug() {
  const match = window.location.pathname.match(/^\/u\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]).replace(/^@/, "") : "";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadContext() {
  const slug = getSlug();
  const nextKey = slug ? `profile:${slug}` : "";
  if (!slug) return null;
  if (nextKey === routeKey && profileContext) return profileContext;

  routeKey = nextKey;
  profileContext = null;

  let profileResult = await supabase.from("profiles").select("id").eq("username", slug).maybeSingle();
  if (!profileResult.data && !profileResult.error && isUuid(slug)) {
    profileResult = await supabase.from("profiles").select("id").eq("id", slug).maybeSingle();
  }
  if (profileResult.error || !profileResult.data) return null;

  const [{ data: lists }, authResult] = await Promise.all([
    supabase
      .from("creator_lists")
      .select("id, title, created_at")
      .eq("user_id", profileResult.data.id)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase.auth.getUser(),
  ]);

  profileContext = {
    profileId: profileResult.data.id,
    currentUserId: authResult?.data?.user?.id || null,
    lists: lists || [],
  };
  return profileContext;
}

async function getCount(listKey) {
  const { count } = await supabase
    .from("creator_list_comments")
    .select("id", { count: "exact", head: true })
    .eq("list_key", String(listKey));
  return count || 0;
}

async function loadComments(listKey) {
  const { data, error } = await supabase
    .from("creator_list_comments")
    .select("id, user_id, body, created_at")
    .eq("list_key", String(listKey))
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;

  const comments = data || [];
  const userIds = Array.from(new Set(comments.map((comment) => comment.user_id).filter(Boolean)));
  let profileMap = new Map();

  if (userIds.length) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, full_name, display_name, avatar_url")
      .in("id", userIds);

    if (profileError) {
      console.warn("Failed loading creator-list comment profiles", profileError);
    } else {
      profileMap = new Map((profiles || []).map((profile) => [String(profile.id), profile]));
    }
  }

  return comments.map((comment) => ({
    ...comment,
    profile: profileMap.get(String(comment.user_id)) || { id: comment.user_id },
  }));
}

function updateCommentCount(panel) {
  const count = panel.querySelectorAll(".creator-list-comment-row").length;
  const toggle = panel.previousElementSibling?.querySelector(".creator-list-comments-toggle");
  if (toggle) toggle.textContent = count ? `${count} comment${count === 1 ? "" : "s"}` : "Comments";

  const list = panel.querySelector(".creator-list-comment-list");
  if (list && count === 0 && !list.querySelector(".creator-list-comment-muted")) {
    const empty = document.createElement("p");
    empty.className = "creator-list-comment-muted";
    empty.textContent = "No comments yet.";
    list.appendChild(empty);
  }
}

function renderCommentRows(panel, comments) {
  const list = document.createElement("div");
  list.className = "creator-list-comment-list";

  if (!comments.length) {
    const empty = document.createElement("p");
    empty.className = "creator-list-comment-muted";
    empty.textContent = "No comments yet.";
    list.appendChild(empty);
  } else {
    comments.forEach((comment) => {
      const profile = comment.profile || { id: comment.user_id };
      const displayName = getProfileDisplayName(profile, "User");
      const profileUrl = getProfileHref(profile, comment.user_id);
      const username = String(profile.username || "").trim();
      const currentUserId = profileContext?.currentUserId || null;
      const canDelete = Boolean(
        currentUserId &&
        (String(comment.user_id) === String(currentUserId) || String(profileContext?.profileId || "") === String(currentUserId))
      );

      const row = document.createElement("article");
      row.className = "creator-list-comment-row";
      row.dataset.commentId = String(comment.id || "");

      const card = document.createElement("div");
      card.className = "creator-list-comment-card";

      const head = document.createElement("div");
      head.className = "creator-list-comment-head";

      const avatarLink = document.createElement("a");
      avatarLink.className = "creator-list-comment-avatar-link";
      avatarLink.href = profileUrl;
      avatarLink.setAttribute("aria-label", `Open ${displayName}'s profile`);

      if (profile.avatar_url) {
        const avatar = document.createElement("img");
        avatar.className = "creator-list-comment-avatar";
        avatar.src = profile.avatar_url;
        avatar.alt = "";
        avatarLink.appendChild(avatar);
      } else {
        const fallback = document.createElement("div");
        fallback.className = "creator-list-comment-avatar creator-list-comment-avatar-fallback";
        fallback.textContent = displayName.slice(0, 1).toUpperCase() || "?";
        avatarLink.appendChild(fallback);
      }

      const userLine = document.createElement("div");
      userLine.className = "creator-list-comment-user-line";

      const nameLink = document.createElement("a");
      nameLink.className = "creator-list-comment-username";
      nameLink.href = profileUrl;
      nameLink.textContent = displayName;
      userLine.appendChild(nameLink);

      if (username && displayName !== username) {
        const handleLink = document.createElement("a");
        handleLink.className = "creator-list-comment-handle";
        handleLink.href = profileUrl;
        handleLink.textContent = `@${username}`;
        userLine.appendChild(handleLink);
      }

      const date = document.createElement("span");
      date.className = "creator-list-comment-date";
      date.textContent = formatDateTime(comment.created_at);
      userLine.appendChild(date);

      head.append(avatarLink, userLine);

      if (canDelete) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "creator-list-comment-delete";
        deleteButton.textContent = "Delete";
        deleteButton.setAttribute("aria-label", "Delete this comment");
        deleteButton.addEventListener("click", async () => {
          if (!window.confirm("Delete this comment permanently?")) return;
          deleteButton.disabled = true;
          deleteButton.textContent = "Deleting...";
          const { error } = await supabase.rpc("delete_owned_thread_item", {
            p_table_name: "creator_list_comments",
            p_item_id: comment.id,
          });
          if (error) {
            console.error("Failed deleting creator-list comment", error);
            deleteButton.disabled = false;
            deleteButton.textContent = "Delete";
            return;
          }
          row.remove();
          updateCommentCount(panel);
        });
        head.appendChild(deleteButton);
      }

      const body = document.createElement("p");
      body.className = "creator-list-comment-body";
      body.textContent = comment.body || "";

      card.append(head, body);
      row.appendChild(card);
      list.appendChild(row);
    });
  }

  const form = panel.querySelector(":scope > .creator-list-comment-form");
  if (form) panel.insertBefore(list, form);
  else panel.appendChild(list);
  return list;
}

async function openPanel(card, actions, button, listKey, forceOpen = false) {
  const existing = card.querySelector(":scope > .creator-list-comments-panel");
  if (existing) {
    if (forceOpen) return existing;
    existing.remove();
    button.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
    return null;
  }

  button.classList.add("is-open");
  button.setAttribute("aria-expanded", "true");

  const panel = document.createElement("div");
  panel.className = "creator-list-comments-panel";
  panel.textContent = "Loading comments...";
  actions.insertAdjacentElement("afterend", panel);

  try {
    const comments = await loadComments(listKey);
    panel.replaceChildren();
    renderCommentRows(panel, comments);

    const form = document.createElement("form");
    form.className = "creator-list-comment-form";
    const input = document.createElement("textarea");
    input.rows = 3;
    input.maxLength = 1000;
    input.placeholder = "Comment on this list...";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Post";
    form.append(input, submit);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = input.value.trim();
      if (!body) return;

      let userId = profileContext?.currentUserId || null;
      if (!userId) {
        const { data } = await supabase.auth.getUser();
        userId = data?.user?.id || null;
      }
      if (!userId) return;

      submit.disabled = true;
      const { error } = await supabase.from("creator_list_comments").insert({
        list_key: String(listKey),
        user_id: userId,
        body,
      });
      submit.disabled = false;
      if (error) return;

      input.value = "";
      const updated = await loadComments(listKey);
      panel.querySelector(".creator-list-comment-list")?.remove();
      renderCommentRows(panel, updated);
      button.textContent = `${updated.length} comment${updated.length === 1 ? "" : "s"}`;
    });

    panel.appendChild(form);
    return panel;
  } catch (error) {
    console.error("Failed loading list comments", error);
    panel.textContent = "Could not load comments.";
    return panel;
  }
}

function ensureActions(card, listKey) {
  card.dataset.creatorListKey = String(listKey);

  let actions = card.querySelector(":scope > .creator-list-actions-row");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "creator-list-actions-row";
    card.querySelector(":scope > .creator-list-cover-button")?.insertAdjacentElement("afterend", actions);
  }

  let comments = actions.querySelector(".creator-list-comments-toggle");
  if (!comments) {
    comments = document.createElement("button");
    comments.type = "button";
    comments.className = "creator-list-comments-toggle";
    comments.setAttribute("aria-expanded", "false");
    comments.dataset.listKey = String(listKey);
    comments.textContent = "Comments";
    comments.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPanel(card, actions, comments, listKey);
    });
    getCount(listKey).then((count) => {
      comments.textContent = count ? `${count} comment${count === 1 ? "" : "s"}` : "Comments";
    });
  }

  const share = card.querySelector(":scope > .burgrs-activity-share-btn");
  if (share) actions.insertBefore(share, actions.firstChild);
  actions.appendChild(comments);
}

function cleanCreatorListDeepLink() {
  const url = new URL(window.location.href);
  url.searchParams.delete("listComments");
  url.searchParams.delete("notificationTarget");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

async function processCreatorListDeepLink() {
  if (processingDeepLink || !getSlug()) return;

  const params = new URLSearchParams(window.location.search);
  const listKey = params.get("listComments");
  const commentId = params.get("notificationTarget");
  if (!listKey || !commentId) return;

  const deepLinkKey = `${window.location.pathname}|${listKey}|${commentId}`;
  if (handledDeepLinkKey === deepLinkKey) return;

  processingDeepLink = true;
  try {
    const startedAt = Date.now();
    let card = null;

    while (!card && Date.now() - startedAt < 12000) {
      card = [...document.querySelectorAll(".creator-page .creator-list-card")].find(
        (item) => String(item.dataset.creatorListKey || "") === String(listKey)
      );
      if (!card) {
        await sleep(120);
        await install();
      }
    }

    if (!card) return;

    const actions = card.querySelector(":scope > .creator-list-actions-row");
    const button = actions?.querySelector(".creator-list-comments-toggle");
    if (!actions || !button) return;

    const panel = await openPanel(card, actions, button, listKey, true);
    if (!panel) return;

    let target = panel.querySelector(`[data-comment-id="${CSS.escape(String(commentId))}"]`);
    if (!target) {
      const comments = await loadComments(listKey);
      panel.querySelector(".creator-list-comment-list")?.remove();
      renderCommentRows(panel, comments);
      target = panel.querySelector(`[data-comment-id="${CSS.escape(String(commentId))}"]`);
    }

    if (target) {
      target.classList.add(HIGHLIGHT_CLASS);
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => target.classList.remove(HIGHLIGHT_CLASS), 5000);
    } else {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    handledDeepLinkKey = deepLinkKey;
    cleanCreatorListDeepLink();
  } finally {
    processingDeepLink = false;
  }
}

async function install() {
  const context = await loadContext();
  if (!context) return;

  const cards = [...document.querySelectorAll(".creator-page .creator-list-card")];
  let listIndex = 0;

  cards.forEach((card) => {
    const title = card.querySelector(".creator-list-cover-content h3")?.textContent?.trim() || "";
    const listKey = title === AUTO_TITLE
      ? `rankd-top-10-${context.profileId}`
      : String(context.lists[listIndex++]?.id || "");
    if (listKey) ensureActions(card, listKey);
  });

  processCreatorListDeepLink();
}

function scheduleInstall() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    install();
  });
}

new MutationObserver(scheduleInstall).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", () => {
  handledDeepLinkKey = "";
  scheduleInstall();
});
window.addEventListener("pageshow", scheduleInstall);
scheduleInstall();
