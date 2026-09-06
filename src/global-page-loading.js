const LOADER_ID = "burgr-global-page-loader";
const PROGRESS_MIN = 8;
const PROGRESS_MAX = 94;

let observer = null;
let progressTimer = null;
let syncFrame = null;
let currentProgress = PROGRESS_MIN;

function getTemplateForPath(pathname = window.location.pathname) {
  if (pathname === "/") return "home";
  if (pathname === "/following") return "following";
  if (pathname === "/notifications") return "notifications";
  if (pathname === "/search") return "search";
  if (pathname === "/my-shows") return "my-shows";
  if (pathname.startsWith("/my-shows/")) return "my-show";
  if (pathname.startsWith("/show/")) return "show";
  if (pathname.startsWith("/actor/")) return "actor";
  if (pathname.startsWith("/u/")) return "profile";
  if (pathname === "/calendar") return "calendar";
  if (pathname.startsWith("/rankd")) return "rankd";
  if (pathname === "/profile/edit") return "profile-edit";
  if (pathname.startsWith("/creator/lists/")) return "editor";
  if (pathname.startsWith("/creator/posts/")) return "editor";
  if (pathname === "/login") return "login";
  return "generic";
}

function getLabelForPath(pathname = window.location.pathname) {
  if (pathname === "/") return "Loading Home";
  if (pathname === "/my-shows") return "Loading your shows";
  if (pathname.startsWith("/my-shows/")) return "Loading your show";
  if (pathname.startsWith("/show/")) return "Loading show";
  if (pathname.startsWith("/actor/")) return "Loading actor";
  if (pathname.startsWith("/u/")) return "Loading profile";
  if (pathname === "/following") return "Loading Following";
  if (pathname === "/notifications") return "Loading alerts";
  if (pathname === "/search") return "Loading Search";
  if (pathname === "/calendar") return "Loading calendar";
  if (pathname.startsWith("/rankd")) return "Loading Rank'd";
  if (pathname === "/profile/edit") return "Loading profile";
  if (pathname === "/login") return "Loading BURGRS";
  return "Loading BURGRS";
}

function line(width = "70%", height = 12, extra = "") {
  return `<div class="burgr-page-loader-line burgr-page-loader-shimmer ${extra}" style="width:${width};height:${height}px"></div>`;
}

function circle(size = 42, extra = "") {
  return `<div class="burgr-page-loader-circle burgr-page-loader-shimmer ${extra}" style="width:${size}px;height:${size}px"></div>`;
}

function poster(extra = "") {
  return `<div class="burgr-page-loader-poster burgr-page-loader-shimmer ${extra}"></div>`;
}

function chip(width = 74) {
  return `<div class="burgr-page-loader-chip burgr-page-loader-shimmer" style="width:${width}px"></div>`;
}

function listRow({ avatar = false, rank = false, wide = false } = {}) {
  return `
    <div class="burgr-page-loader-row${wide ? " is-wide" : ""}">
      ${rank ? '<div class="burgr-page-loader-rank burgr-page-loader-shimmer"></div>' : ""}
      ${avatar ? circle(42) : '<div class="burgr-page-loader-thumb burgr-page-loader-shimmer"></div>'}
      <div class="burgr-page-loader-row-copy">
        ${line("58%", 13)}
        ${line("86%", 11)}
        ${line("40%", 10)}
      </div>
    </div>
  `;
}

function posterGrid(count = 12) {
  return `<div class="burgr-page-loader-poster-grid">${Array.from({ length: count }, () => poster()).join("")}</div>`;
}

function homeTemplate() {
  return `
    <div class="burgr-loader-home">
      ${line("46%", 22, "burgr-loader-title")}
      <section class="burgr-loader-section">
        ${line("42%", 17)}
        <div class="burgr-loader-horizontal-cards">
          ${Array.from({ length: 3 }, () => `
            <div class="burgr-loader-continue-card">
              ${poster()}
              <div class="burgr-loader-card-copy">${line("72%", 12)}${line("50%", 10)}</div>
            </div>
          `).join("")}
        </div>
      </section>
      <div class="burgr-loader-stats-strip">${Array.from({ length: 4 }, () => `<div class="burgr-loader-stat">${line("58%", 9)}${line("42%", 22)}</div>`).join("")}</div>
      <section class="burgr-loader-section">${line("52%", 17)}<div class="burgr-loader-list">${Array.from({ length: 4 }, () => listRow()).join("")}</div></section>
    </div>
  `;
}

function followingTemplate() {
  return `
    <div class="burgr-loader-following">
      <div class="burgr-loader-page-head">${line("36%", 24)}${chip(96)}</div>
      <div class="burgr-loader-tabs">${chip(86)}${chip(86)}${chip(86)}</div>
      <div class="burgr-loader-feed">
        ${Array.from({ length: 3 }, () => `
          <article class="burgr-loader-feed-card">
            <div class="burgr-loader-feed-author">${circle(42)}<div>${line("42%", 12)}${line("28%", 9)}</div></div>
            ${line("88%", 11)}${line("72%", 11)}
            <div class="burgr-loader-feed-media burgr-page-loader-shimmer"></div>
            <div class="burgr-loader-feed-actions">${chip(58)}${chip(58)}${chip(58)}</div>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function notificationsTemplate() {
  return `
    <div class="burgr-loader-notifications">
      ${line("42%", 24)}
      <div class="burgr-loader-tabs">${chip(64)}${chip(78)}${chip(74)}</div>
      <div class="burgr-loader-notification-list">
        ${Array.from({ length: 7 }, () => `
          <div class="burgr-loader-notification-row">
            ${circle(44)}
            <div class="burgr-page-loader-row-copy">${line("90%", 12)}${line("70%", 10)}${line("25%", 9)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function searchTemplate() {
  return `
    <div class="burgr-loader-search">
      ${line("34%", 24)}
      <div class="burgr-loader-search-box burgr-page-loader-shimmer"></div>
      <div class="burgr-loader-tabs">${chip(58)}${chip(74)}${chip(86)}${chip(68)}</div>
      <div class="burgr-loader-search-results">
        ${Array.from({ length: 5 }, () => `
          <div class="burgr-loader-search-result">
            ${poster()}
            <div class="burgr-page-loader-row-copy">${line("72%", 15)}${line("38%", 10)}${line("96%", 10)}${line("82%", 10)}${chip(82)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function myShowsTemplate() {
  return `
    <div class="burgr-loader-my-shows">
      ${line("40%", 24)}
      <div class="burgr-loader-tabs">${chip(58)}${chip(84)}${chip(90)}${chip(70)}</div>
      <div class="burgr-loader-search-box burgr-page-loader-shimmer is-small"></div>
      ${posterGrid(16)}
    </div>
  `;
}

function showTemplate(saved = false) {
  return `
    <div class="burgr-loader-show${saved ? " is-saved" : ""}">
      <div class="burgr-loader-backdrop burgr-page-loader-shimmer"></div>
      <div class="burgr-loader-show-hero">
        ${poster("is-hero")}
        <div class="burgr-loader-show-copy">
          ${line("78%", 23)}${line("46%", 11)}
          <div class="burgr-loader-button-row">${chip(92)}${chip(82)}</div>
          ${line("96%", 10)}${line("88%", 10)}${line("72%", 10)}
        </div>
      </div>
      <div class="burgr-loader-tabs">${chip(70)}${chip(78)}${chip(64)}${chip(68)}</div>
      <div class="burgr-loader-season-select burgr-page-loader-shimmer"></div>
      <div class="burgr-loader-episodes">${Array.from({ length: 4 }, () => listRow({ wide: true })).join("")}</div>
    </div>
  `;
}

function actorTemplate() {
  return `
    <div class="burgr-loader-actor">
      <div class="burgr-loader-actor-head">${circle(104, "is-actor")}${line("52%", 24)}${line("34%", 11)}</div>
      <div class="burgr-loader-bio">${line("100%", 10)}${line("94%", 10)}${line("78%", 10)}</div>
      ${line("38%", 17)}
      <div class="burgr-loader-horizontal-posters">${Array.from({ length: 4 }, () => poster()).join("")}</div>
      ${line("46%", 17)}
      <div class="burgr-loader-list">${Array.from({ length: 4 }, () => listRow()).join("")}</div>
    </div>
  `;
}

function profileTemplate() {
  return `
    <div class="burgr-loader-profile">
      <div class="burgr-loader-profile-banner burgr-page-loader-shimmer"></div>
      <div class="burgr-loader-profile-head">
        ${circle(86, "is-profile")}
        <div class="burgr-loader-profile-copy">${line("62%", 22)}${line("42%", 10)}${line("76%", 10)}</div>
      </div>
      <div class="burgr-loader-profile-actions">${chip(96)}${chip(96)}</div>
      <div class="burgr-loader-tabs">${chip(64)}${chip(74)}${chip(62)}</div>
      <div class="burgr-loader-feed">${Array.from({ length: 3 }, () => `<div class="burgr-loader-profile-post">${line("62%", 13)}${line("96%", 10)}${line("84%", 10)}<div class="burgr-loader-feed-media burgr-page-loader-shimmer"></div></div>`).join("")}</div>
    </div>
  `;
}

function calendarTemplate() {
  return `
    <div class="burgr-loader-calendar">
      ${line("40%", 24)}
      <div class="burgr-loader-calendar-strip">${Array.from({ length: 7 }, () => `<div class="burgr-loader-date">${line("60%", 8)}${circle(34)}</div>`).join("")}</div>
      ${Array.from({ length: 3 }, () => `<section class="burgr-loader-calendar-day">${line("32%", 15)}<div class="burgr-loader-list">${listRow()}${listRow()}</div></section>`).join("")}
    </div>
  `;
}

function rankdTemplate() {
  return `
    <div class="burgr-loader-rankd">
      ${line("32%", 26)}
      <div class="burgr-loader-rankd-controls">${chip(92)}${chip(76)}${chip(88)}</div>
      <div class="burgr-loader-rank-list">${Array.from({ length: 7 }, () => listRow({ rank: true, wide: true })).join("")}</div>
    </div>
  `;
}

function profileEditTemplate() {
  return `
    <div class="burgr-loader-profile-edit">
      ${line("46%", 24)}
      <div class="burgr-loader-edit-avatar">${circle(92)}${chip(102)}</div>
      <div class="burgr-loader-form">
        ${Array.from({ length: 5 }, () => `<div class="burgr-loader-field">${line("28%", 9)}<div class="burgr-loader-input burgr-page-loader-shimmer"></div></div>`).join("")}
        <div class="burgr-loader-save burgr-page-loader-shimmer"></div>
      </div>
    </div>
  `;
}

function editorTemplate() {
  return `
    <div class="burgr-loader-editor">
      <div class="burgr-loader-page-head">${line("48%", 24)}${chip(78)}</div>
      <div class="burgr-loader-field">${line("24%", 9)}<div class="burgr-loader-input burgr-page-loader-shimmer"></div></div>
      <div class="burgr-loader-field">${line("30%", 9)}<div class="burgr-loader-input burgr-page-loader-shimmer is-tall"></div></div>
      ${posterGrid(8)}
    </div>
  `;
}

function loginTemplate() {
  return `
    <div class="burgr-loader-login">
      <div class="burgr-loader-login-card">
        <div class="burgr-loader-login-logo burgr-page-loader-shimmer"></div>
        ${line("56%", 22)}
        <div class="burgr-loader-input burgr-page-loader-shimmer"></div>
        <div class="burgr-loader-input burgr-page-loader-shimmer"></div>
        <div class="burgr-loader-save burgr-page-loader-shimmer"></div>
      </div>
    </div>
  `;
}

function buildTemplate(template) {
  switch (template) {
    case "home": return homeTemplate();
    case "following": return followingTemplate();
    case "notifications": return notificationsTemplate();
    case "search": return searchTemplate();
    case "my-shows": return myShowsTemplate();
    case "my-show": return showTemplate(true);
    case "show": return showTemplate(false);
    case "actor": return actorTemplate();
    case "profile": return profileTemplate();
    case "calendar": return calendarTemplate();
    case "rankd": return rankdTemplate();
    case "profile-edit": return profileEditTemplate();
    case "editor": return editorTemplate();
    case "login": return loginTemplate();
    default: return `<div class="burgr-loader-generic">${line("46%", 24)}<div class="burgr-loader-list">${Array.from({ length: 6 }, () => listRow()).join("")}</div></div>`;
  }
}

function createLoader() {
  const loader = document.createElement("div");
  loader.id = LOADER_ID;
  loader.className = "burgr-page-loader-overlay";
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");
  loader.setAttribute("aria-busy", "true");

  const template = getTemplateForPath();
  const label = getLabelForPath();

  loader.innerHTML = `
    <span class="burgr-page-loader-sr">${label}</span>
    <div class="burgr-page-loader-template" data-template="${template}" aria-hidden="true">
      <div class="burgr-page-loader-template-inner">${buildTemplate(template)}</div>
    </div>
    <div class="burgr-page-loader-center" aria-hidden="true">
      <div class="burgr-page-loader-dial">
        <div class="burgr-page-loader-burger">🍔</div>
        <div class="burgr-page-loader-percent">${PROGRESS_MIN}%</div>
      </div>
      <div class="burgr-page-loader-label">${label}</div>
    </div>
  `;

  return loader;
}

function updateLoaderForPath(loader) {
  if (!loader) return;
  const template = getTemplateForPath();
  const label = getLabelForPath();
  const templateNode = loader.querySelector(".burgr-page-loader-template");
  const templateInner = loader.querySelector(".burgr-page-loader-template-inner");
  const labelNode = loader.querySelector(".burgr-page-loader-label");
  const srNode = loader.querySelector(".burgr-page-loader-sr");

  if (templateNode && templateNode.dataset.template !== template) {
    templateNode.dataset.template = template;
    if (templateInner) templateInner.innerHTML = buildTemplate(template);
  }
  if (labelNode) labelNode.textContent = label;
  if (srNode) srNode.textContent = label;
}

function setProgress(value) {
  currentProgress = Math.max(PROGRESS_MIN, Math.min(100, Math.round(value)));
  const loader = document.getElementById(LOADER_ID);
  if (!loader) return;

  loader.style.setProperty("--burgr-progress", `${currentProgress * 3.6}deg`);
  const text = loader.querySelector(".burgr-page-loader-percent");
  if (text) text.textContent = `${currentProgress}%`;
}

function startProgress() {
  window.clearInterval(progressTimer);
  currentProgress = PROGRESS_MIN;
  setProgress(currentProgress);

  progressTimer = window.setInterval(() => {
    if (currentProgress >= PROGRESS_MAX) return;
    let step = 1;
    if (currentProgress < 45) step = 5;
    else if (currentProgress < 70) step = 3;
    else if (currentProgress < 86) step = 2;
    setProgress(Math.min(PROGRESS_MAX, currentProgress + step));
  }, 190);
}

function showLoader() {
  let loader = document.getElementById(LOADER_ID);
  if (!loader) {
    loader = createLoader();
    document.body.appendChild(loader);
    startProgress();
  } else {
    loader.classList.remove("is-finishing");
    updateLoaderForPath(loader);
  }
}

function hideLoader() {
  const loader = document.getElementById(LOADER_ID);
  if (!loader) return;
  window.clearInterval(progressTimer);
  setProgress(100);
  loader.classList.add("is-finishing");
  window.setTimeout(() => {
    loader.remove();
    currentProgress = PROGRESS_MIN;
  }, 180);
}

function isElementVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function isExplicitFullPageLoader() {
  const startup = document.querySelector('.app-startup-loading[aria-busy="true"]');
  if (startup && isElementVisible(startup)) return true;

  const explicitSelectors = [
    ".my-shows-loading-page",
    ".dashboard-page .dashboard-loading-copy",
    ".actor-page .actor-loading",
    ".calendar-page .calendar-loading",
    ".notifications-page .notifications-loading",
    ".following-page .following-loading",
    ".rankd-page .rankd-loading",
    ".my-show-details-page .loading",
    ".show-details-page .loading",
  ];

  return explicitSelectors.some((selector) => {
    const node = document.querySelector(selector);
    return node && isElementVisible(node);
  });
}

function pageLooksLikeLoadingState(page) {
  if (!page || page.closest(`#${LOADER_ID}`)) return false;
  const text = String(page.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!text || !/(^|\s)loading\b/.test(text)) return false;

  if (page.querySelector("form, input:not([type='hidden']), textarea, select, article, .search-result-banner-card, .trending-card, .show-card, .review-card")) {
    return false;
  }

  const directChildren = [...page.children].filter((child) => {
    const style = window.getComputedStyle(child);
    return style.display !== "none" && style.visibility !== "hidden";
  });
  if (directChildren.length <= 5) return true;

  const loadingNode = [...page.querySelectorAll("p, span, div, h1, h2")].find((node) => {
    if (node.children.length > 2) return false;
    const nodeText = String(node.textContent || "").trim().toLowerCase();
    return nodeText.startsWith("loading ") || nodeText === "loading...";
  });

  return Boolean(loadingNode && page.querySelectorAll("img, article, button").length === 0);
}

function pageIsLoading() {
  if (isExplicitFullPageLoader()) return true;
  const pages = document.querySelectorAll(".page, main");
  return [...pages].some(pageLooksLikeLoadingState);
}

function syncLoader() {
  if (pageIsLoading()) showLoader();
  else hideLoader();
}

function scheduleSync() {
  if (syncFrame != null) return;
  syncFrame = window.requestAnimationFrame(() => {
    syncFrame = null;
    syncLoader();
  });
}

export function installGlobalPageLoadingTheme() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  if (window.__burgrGlobalPageLoadingInstalled) return () => {};
  window.__burgrGlobalPageLoadingInstalled = true;

  observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  window.addEventListener("popstate", scheduleSync);
  window.addEventListener("pageshow", scheduleSync);
  window.addEventListener("burgrs:page-loading", showLoader);
  window.addEventListener("burgrs:page-loaded", hideLoader);
  scheduleSync();

  return () => {
    observer?.disconnect();
    observer = null;
    window.clearInterval(progressTimer);
    if (syncFrame != null) window.cancelAnimationFrame(syncFrame);
    syncFrame = null;
    window.removeEventListener("popstate", scheduleSync);
    window.removeEventListener("pageshow", scheduleSync);
    window.removeEventListener("burgrs:page-loading", showLoader);
    window.removeEventListener("burgrs:page-loaded", hideLoader);
    document.getElementById(LOADER_ID)?.remove();
    window.__burgrGlobalPageLoadingInstalled = false;
  };
}
