function getFirstAiredTimestamp(card) {
  const rows = Array.from(card.querySelectorAll('.search-result-meta-row'));
  const firstAiredRow = rows.find((row) => {
    const label = row.querySelector('.search-result-meta-label');
    return label?.textContent?.trim().toLowerCase() === 'first aired';
  });

  const value = firstAiredRow
    ?.querySelector('.search-result-meta-value')
    ?.textContent?.trim();

  if (!value) return Number.NEGATIVE_INFINITY;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isTitleSearchActive() {
  const activeMode = document.querySelector('.search-mode-button.is-active');
  return activeMode?.textContent?.trim().toLowerCase() === 'title';
}

function getAliasRow(card) {
  const rows = Array.from(card.querySelectorAll('.search-result-meta-row'));
  return rows.find((row) => {
    const label = row.querySelector('.search-result-meta-label');
    return label?.textContent?.trim().toLowerCase() === 'also known as';
  }) || null;
}

function getAliasText(card) {
  return getAliasRow(card)
    ?.querySelector('.search-result-meta-value')
    ?.textContent?.trim() || '';
}

function applyExactAliasDisplay(card, query) {
  const normalizedQuery = normalizeTitle(query);
  if (!normalizedQuery) return;

  const aliasRow = getAliasRow(card);
  if (!aliasRow) return;

  const aliasValue = aliasRow
    .querySelector('.search-result-meta-value')
    ?.textContent?.trim() || '';

  if (normalizeTitle(aliasValue) !== normalizedQuery) return;

  const titleElement = card.querySelector('.search-result-title');
  if (!titleElement) return;

  const originalTitle = titleElement.textContent?.trim() || '';
  if (!originalTitle || normalizeTitle(originalTitle) === normalizedQuery) return;

  titleElement.textContent = aliasValue;

  const labelElement = aliasRow.querySelector('.search-result-meta-label');
  const valueElement = aliasRow.querySelector('.search-result-meta-value');
  if (labelElement) labelElement.textContent = 'Original title';
  if (valueElement) valueElement.textContent = originalTitle;
}

function getTitleMatchScore(card, query) {
  const normalizedQuery = normalizeTitle(query);
  if (!normalizedQuery) return 0;

  const title = normalizeTitle(
    card.querySelector('.search-result-title')?.textContent?.trim() || ''
  );
  const alias = normalizeTitle(getAliasText(card));

  // Exact primary titles are best, followed immediately by exact aliases.
  if (title === normalizedQuery) return 12000;
  if (alias === normalizedQuery) return 11000;

  if (title.startsWith(normalizedQuery)) return 6000;
  if (alias.startsWith(normalizedQuery)) return 5500;

  if (title.includes(normalizedQuery)) return 3000;
  if (alias.includes(normalizedQuery)) return 2750;

  return 0;
}

function sortTitleResultsByRelevance(list, cards) {
  const query = document.querySelector('.search-page-input')?.value || '';

  cards.forEach((card) => applyExactAliasDisplay(card, query));

  const sorted = [...cards].sort((a, b) => {
    const scoreDifference =
      getTitleMatchScore(b, query) - getTitleMatchScore(a, query);
    if (scoreDifference !== 0) return scoreDifference;

    const dateDifference = getFirstAiredTimestamp(b) - getFirstAiredTimestamp(a);
    if (dateDifference !== 0) return dateDifference;

    const aTitle = a.querySelector('.search-result-title')?.textContent?.trim() || '';
    const bTitle = b.querySelector('.search-result-title')?.textContent?.trim() || '';
    return aTitle.localeCompare(bTitle);
  });

  sorted.forEach((card) => list.appendChild(card));
}

function sortSearchResults() {
  const list = document.querySelector('.search-results-list');
  if (!list) return;

  const cards = Array.from(list.children).filter((child) =>
    child.classList?.contains('search-result-banner-card')
  );

  if (cards.length < 2) return;

  if (isTitleSearchActive()) {
    sortTitleResultsByRelevance(list, cards);
    return;
  }

  const sorted = [...cards].sort((a, b) => {
    const dateDifference = getFirstAiredTimestamp(b) - getFirstAiredTimestamp(a);
    if (dateDifference !== 0) return dateDifference;

    const aTitle = a.querySelector('.search-result-title')?.textContent?.trim() || '';
    const bTitle = b.querySelector('.search-result-title')?.textContent?.trim() || '';
    return aTitle.localeCompare(bTitle);
  });

  sorted.forEach((card) => list.appendChild(card));
}

let scheduled = false;
function scheduleSearchSort() {
  if (scheduled) return;
  scheduled = true;

  window.requestAnimationFrame(() => {
    scheduled = false;
    sortSearchResults();
  });
}

const observer = new MutationObserver((mutations) => {
  const searchChanged = mutations.some((mutation) => {
    const target = mutation.target;
    return (
      target instanceof Element &&
      (target.matches('.search-results-list') || target.closest('.search-results-list'))
    );
  });

  if (searchChanged) scheduleSearchSort();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

window.addEventListener('pageshow', scheduleSearchSort);
window.addEventListener('popstate', scheduleSearchSort);

scheduleSearchSort();
