import { prefetchShowCoreFromHref } from "./lib/showCoreCache";

const prefetchedHrefs = new Set();

function maybePrefetch(target) {
  const link = target?.closest?.('a[href^="/show/"], a[href^="/my-shows/"]');
  if (!link) return;

  const href = link.getAttribute("href");
  if (!href || prefetchedHrefs.has(href)) return;

  prefetchedHrefs.add(href);
  void prefetchShowCoreFromHref(href);
}

document.addEventListener("pointerover", (event) => {
  if (event.pointerType === "touch") return;
  maybePrefetch(event.target);
}, { passive: true });

document.addEventListener("touchstart", (event) => {
  maybePrefetch(event.target);
}, { passive: true });

document.addEventListener("focusin", (event) => {
  maybePrefetch(event.target);
});
