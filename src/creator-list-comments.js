import { supabase } from "./lib/supabase";

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
  return data || [];
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
      const row = document.createElement("div");
      row.className = "creator-list-comment-row";
      row.dataset.commentId = String(comment.id || "");
      const body = document.createElement("p");
      body.textContent = comment.body || "";
      row.appendChild(body);
      list.appendChild(row);
    });
  }

  panel.appendChild(list);
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
    input.rows = 2;
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
