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

function isTitleSearchActive() {
  const activeMode = document.querySelector('.search-mode-button.is-active');
  return activeMode?.textContent?.trim().toLowerCase() === 'title';
}

function sortSearchResultsNewestFirst() {
  // Title searches are ranked by relevance in the search API, including aliases.
  // Do not override that ranking with a client-side newest-first sort.
  if (isTitleSearchActive()) return;

  const list = document.querySelector('.search-results-list');
  if (!list) return;

  const cards = Array.from(list.children).filter((child) =>
    child.classList?.contains('search-result-banner-card')
  );

  if (cards.length < 2) return;

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
    sortSearchResultsNewestFirst();
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
