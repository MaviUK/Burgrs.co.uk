import { supabase } from "./lib/supabase";

const HIGHLIGHT_CLASS = "notification-target-highlight";
const MAX_WAIT_MS = 12000;

let activeKey = "";
let scheduled = false;

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function waitFor(getElement, timeout = MAX_WAIT_MS) {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    function check() {
      const element = getElement();
      if (element) {
        resolve(element);
        return;
      }

      if (Date.now() - startedAt >= timeout) {
        resolve(null);
        return;
      }

      window.setTimeout(check, 120);
    }

    check();
  });
}

function clickButtonByText(selector, label) {
  const button = [...document.querySelectorAll(selector)].find(
    (item) => item.textContent?.trim().toLowerCase() === label.toLowerCase()
  );

  button?.click();
  return button || null;
}

function cleanNotificationQuery() {
  const url = new URL(window.location.href);
  ["notificationType", "notificationTarget", "tab", "chat"].forEach((key) =>
    url.searchParams.delete(key)
  );
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function highlightAndScroll(element) {
  const target = element.closest(".msd-review-item") || element;
  target.classList.add(HIGHLIGHT_CLASS);
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => target.classList.remove(HIGHLIGHT_CLASS), 5000);
}

async function getTargetBody(type, targetId) {
  const table = type === "chat_reply" ? "show_chat_messages" : "show_reviews";
  const { data, error } = await supabase
    .from(table)
    .select("id, body")
    .eq("id", targetId)
    .maybeSingle();

  if (error) {
    console.warn("Failed loading notification target", error);
    return "";
  }

  return data?.body || "";
}

function findTextElement(containerSelector, body) {
  const normalizedBody = String(body || "").trim();
  if (!normalizedBody) return null;

  return [...document.querySelectorAll(`${containerSelector} .msd-review-text`)].find(
    (element) => element.textContent?.trim() === normalizedBody
  );
}

async function expandReviewRepliesUntilVisible(body) {
  const section = await waitFor(() =>
    document.querySelector(".msd-reviews-section .msd-review-list")
  );
  if (!section) return null;

  const startedAt = Date.now();
  let quietPasses = 0;

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const target = findTextElement(".msd-reviews-section", body);
    if (target) return target;

    const collapsedButtons = [
      ...section.querySelectorAll(".msd-review-replies-toggle"),
    ].filter((button) =>
      button.textContent?.trim().toLowerCase().startsWith("view")
    );

    if (collapsedButtons.length > 0) {
      quietPasses = 0;
      collapsedButtons.forEach((button) => button.click());
      await sleep(220);
      continue;
    }

    quietPasses += 1;
    if (quietPasses >= 4) break;
    await sleep(220);
  }

  return findTextElement(".msd-reviews-section", body);
}

async function openReviewTarget(targetId) {
  clickButtonByText(".msd-content-tab", "Reviews");

  const body = await getTargetBody("review_reply", targetId);
  const target = await expandReviewRepliesUntilVisible(body);

  if (target) highlightAndScroll(target);
}

async function openPublishedReviewTarget(targetId) {
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) return;
  clickButtonByText(".msd-content-tab", "Reviews");
  const target = await waitFor(() =>
    document.querySelector(`.msd-reviews-section [data-review-id="${targetId}"]`)
  );
  if (target) highlightAndScroll(target);
}

async function openChatTarget(targetId) {
  clickButtonByText(".msd-bottom-action-btn", "Chatboard");

  const body = await getTargetBody("chat_reply", targetId);
  if (!body) return;

  const target = await waitFor(() =>
    findTextElement(".msd-chatboard-screen", body)
  );

  if (target) highlightAndScroll(target);
}

async function processNotificationDeepLink() {
  if (!window.location.pathname.startsWith("/my-shows/")) return;

  const params = new URLSearchParams(window.location.search);
  const type = params.get("notificationType");
  const targetId = params.get("notificationTarget");
  if (!type || !targetId) return;

  const key = `${window.location.pathname}|${type}|${targetId}`;
  if (activeKey === key) return;
  activeKey = key;

  const pageReady = await waitFor(() => document.querySelector(".msd-page .msd-title"));
  if (!pageReady) {
    activeKey = "";
    return;
  }

  try {
    if (type === "new_review") await openPublishedReviewTarget(targetId);
    if (type === "review_reply") await openReviewTarget(targetId);
    if (type === "chat_reply") await openChatTarget(targetId);
  } finally {
    cleanNotificationQuery();
    activeKey = "";
  }
}

function scheduleProcess() {
  if (scheduled) return;
  scheduled = true;

  window.requestAnimationFrame(() => {
    scheduled = false;
    processNotificationDeepLink();
  });
}

const observer = new MutationObserver(scheduleProcess);
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("popstate", scheduleProcess);
window.addEventListener("pageshow", scheduleProcess);
scheduleProcess();
