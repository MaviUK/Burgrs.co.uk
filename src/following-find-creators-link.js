import { installSystemAdminProfile } from "./system-admin-profile";

installSystemAdminProfile();

let scheduled = false;
let lastScrolledKey = "";

function goToCreatorSearch(event) {
  event.preventDefault();
  event.stopPropagation();
  window.location.assign("/profile/edit#find-creators");
}

function enhanceFollowingCreatorLink() {
  const pathname = window.location.pathname;

  if (pathname === "/following") {
    const link = document.querySelector(".following-empty-btn");

    if (link) {
      link.textContent = "Find creators";
      link.setAttribute("href", "/profile/edit#find-creators");

      if (link.dataset.findCreatorsBound !== "true") {
        link.dataset.findCreatorsBound = "true";
        link.addEventListener("click", goToCreatorSearch, true);
      }
    }
  }

  if (pathname === "/profile/edit") {
    const section = document.querySelector(".blocked-users-section");
    if (!section) return;

    section.id = "find-creators";
    section.style.scrollMarginTop = "112px";

    const heading = section.querySelector(".blocked-users-heading h2");
    if (heading) heading.textContent = "Find creators";

    const description = section.querySelector(".blocked-users-heading p");
    if (description) {
      description.textContent =
        "Find and follow creators, or block and manage other users.";
    }

    const scrollKey = `${pathname}${window.location.hash}`;
    if (window.location.hash === "#find-creators" && lastScrolledKey !== scrollKey) {
      lastScrolledKey = scrollKey;
      window.requestAnimationFrame(() => {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  } else {
    lastScrolledKey = "";
  }
}

function scheduleEnhancement() {
  if (scheduled) return;
  scheduled = true;

  window.requestAnimationFrame(() => {
    scheduled = false;
    enhanceFollowingCreatorLink();
  });
}

const observer = new MutationObserver(scheduleEnhancement);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

window.addEventListener("popstate", scheduleEnhancement);
window.addEventListener("hashchange", scheduleEnhancement);
window.addEventListener("pageshow", scheduleEnhancement);
scheduleEnhancement();
