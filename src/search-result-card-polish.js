let searchCardPolishScheduled = false;

function getMetaRow(card, labelText) {
  const target = String(labelText || "").trim().toLowerCase();
  return Array.from(card.querySelectorAll(".search-result-meta-row")).find((row) => {
    const label = row.querySelector(".search-result-meta-label");
    return String(label?.textContent || "").trim().toLowerCase() === target;
  }) || null;
}

function getMetaValue(card, labelText) {
  return String(
    getMetaRow(card, labelText)
      ?.querySelector(".search-result-meta-value")
      ?.textContent || ""
  ).trim();
}

function getYear(value) {
  const match = String(value || "").match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function hideOriginalRows(card) {
  [
    "First aired",
    "Platform",
    "Studio",
    "Genre",
    "Total seasons",
    "Total episodes",
  ].forEach((label) => {
    getMetaRow(card, label)?.classList.add("burgr-search-meta-hidden");
  });
}

function ensureBadgeRow(card, titleLink, platform) {
  let row = card.querySelector(".burgr-search-badge-row");

  if (!platform) {
    row?.remove();
    return;
  }

  if (!row) {
    row = document.createElement("div");
    row.className = "burgr-search-badge-row";
    titleLink.insertAdjacentElement("afterend", row);
  }

  let badge = row.querySelector(".burgr-search-platform-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "burgr-search-platform-badge";
    row.appendChild(badge);
  }

  badge.textContent = platform;
  badge.dataset.provider = platform.toLowerCase();
}

function ensureQuickFacts(card, meta) {
  let row = card.querySelector(".burgr-search-quick-facts");
  if (!row) {
    row = document.createElement("div");
    row.className = "burgr-search-quick-facts";
    meta.insertAdjacentElement("beforebegin", row);
  }

  const facts = [];
  if (meta.firstAired) facts.push(meta.firstAired);
  if (meta.seasons) facts.push(`${meta.seasons} season${meta.seasons === "1" ? "" : "s"}`);
  if (meta.episodes) facts.push(`${meta.episodes} episode${meta.episodes === "1" ? "" : "s"}`);

  row.replaceChildren(
    ...facts.map((fact) => {
      const item = document.createElement("span");
      item.className = "burgr-search-quick-fact";
      item.textContent = fact;
      return item;
    })
  );

  if (!facts.length) row.remove();
}

function ensureSecondaryCopy(card, meta) {
  let copy = card.querySelector(".burgr-search-secondary-copy");
  const parts = [meta.genres, meta.studio].filter(Boolean);

  if (!parts.length) {
    copy?.remove();
    return;
  }

  if (!copy) {
    copy = document.createElement("div");
    copy.className = "burgr-search-secondary-copy";
    const actions = card.querySelector(".search-result-actions");
    actions?.insertAdjacentElement("beforebegin", copy);
  }

  copy.textContent = parts.join(" · ");
}

function enhanceAction(card) {
  const actions = card.querySelector(".search-result-actions");
  const button = actions?.querySelector(".search-add-btn");
  if (!actions || !button) return;

  const saved = button.classList.contains("is-saved");
  const adding = button.disabled && !saved;
  let viewLink = actions.querySelector(".burgr-search-view-show");

  button.classList.add("burgr-search-add-compact");

  if (saved) {
    button.classList.add("burgr-search-add-hidden");

    if (!viewLink) {
      viewLink = document.createElement("a");
      viewLink.className = "burgr-search-view-show";
      viewLink.textContent = "View show";
      actions.appendChild(viewLink);
    }

    const href = card.querySelector(".search-result-title-link")?.getAttribute("href");
    if (href) viewLink.href = href;
    return;
  }

  button.classList.remove("burgr-search-add-hidden");
  viewLink?.remove();

  if (adding) {
    button.textContent = "…";
    button.setAttribute("aria-label", "Adding show");
    button.title = "Adding show";
  } else {
    button.textContent = "+";
    button.setAttribute("aria-label", "Add to My Shows");
    button.title = "Add to My Shows";
  }
}

function enhanceSearchCard(card) {
  const title = card.querySelector(".search-result-title");
  const titleLink = card.querySelector(".search-result-title-link");
  const metaContainer = card.querySelector(".search-result-meta");
  if (!title || !titleLink || !metaContainer) return;

  const firstAired = getMetaValue(card, "First aired");
  const platform = getMetaValue(card, "Platform");
  const studio = getMetaValue(card, "Studio");
  const genres = getMetaValue(card, "Genre");
  const seasons = getMetaValue(card, "Total seasons");
  const episodes = getMetaValue(card, "Total episodes");

  const year = getYear(firstAired);
  if (year) title.dataset.searchYear = year;
  else delete title.dataset.searchYear;

  ensureBadgeRow(card, titleLink, platform);
  ensureQuickFacts(card, {
    firstAired,
    seasons,
    episodes,
  });
  ensureSecondaryCopy(card, { genres, studio });
  hideOriginalRows(card);
  enhanceAction(card);
  card.classList.add("burgr-search-card-polished");
}

function polishSearchCards() {
  document
    .querySelectorAll(".search-results-list .search-result-banner-card")
    .forEach(enhanceSearchCard);
}

function scheduleSearchCardPolish() {
  if (searchCardPolishScheduled) return;
  searchCardPolishScheduled = true;

  window.requestAnimationFrame(() => {
    searchCardPolishScheduled = false;
    polishSearchCards();
  });
}

const searchCardObserver = new MutationObserver(scheduleSearchCardPolish);
searchCardObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["class", "disabled", "href"],
});

window.addEventListener("pageshow", scheduleSearchCardPolish);
window.addEventListener("popstate", scheduleSearchCardPolish);

scheduleSearchCardPolish();
