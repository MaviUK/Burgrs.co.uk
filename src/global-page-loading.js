const LOADER_ID = "burgr-global-page-loader";
const PROGRESS_MIN = 8;
const PROGRESS_MAX = 94;

let observer = null;
let progressTimer = null;
let syncFrame = null;
let currentProgress = PROGRESS_MIN;

function getTemplateForPath(pathname = window.location.pathname) {
  if (
    pathname.startsWith("/show/") ||
    pathname.startsWith("/my-shows/") ||
    pathname.startsWith("/actor/") ||
    pathname.startsWith("/u/")
  ) {
    return "hero";
  }

  if (
    pathname === "/my-shows" ||
    pathname === "/search" ||
    pathname.startsWith("/rankd")
  ) {
    return "grid";
  }

  return "list";
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
  return "Loading BURGRS";
}

function buildLines(count = 3) {
  return Array.from({ length: count }, () =>
    '<div class="burgr-page-loader-line burgr-page-loader-shimmer"></div>'
  ).join("");
}

function buildGrid() {
  return Array.from({ length: 12 }, () =>
    '<div class="burgr-page-loader-grid-card burgr-page-loader-shimmer"></div>'
  ).join("");
}

function buildList() {
  return Array.from({ length: 6 }, () => `
    <div class="burgr-page-loader-list-card">
      <div class="burgr-page-loader-list-poster burgr-page-loader-shimmer"></div>
      <div class="burgr-page-loader-lines">${buildLines(3)}</div>
    </div>
  `).join("");
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
      <div class="burgr-page-loader-template-inner">
        <div class="burgr-page-loader-heading burgr-page-loader-shimmer"></div>
        <div class="burgr-page-loader-subheading burgr-page-loader-shimmer"></div>

        <div class="burgr-page-loader-hero">
          <div class="burgr-page-loader-hero-poster burgr-page-loader-shimmer"></div>
          <div class="burgr-page-loader-hero-copy burgr-page-loader-lines">${buildLines(4)}</div>
        </div>

        <div class="burgr-page-loader-grid">${buildGrid()}</div>
        <div class="burgr-page-loader-list">${buildList()}</div>
      </div>
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
  const labelNode = loader.querySelector(".burgr-page-loader-label");
  const srNode = loader.querySelector(".burgr-page-loader-sr");

  if (templateNode) templateNode.dataset.template = template;
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

  // Avoid replacing partial-action loaders such as search results, forms, or buttons.
  if (
    page.querySelector(
      "form, input:not([type='hidden']), textarea, select, article, .search-result-banner-card, .trending-card, .show-card, .review-card"
    )
  ) {
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
  if (pageIsLoading()) {
    showLoader();
  } else {
    hideLoader();
  }
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
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

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
