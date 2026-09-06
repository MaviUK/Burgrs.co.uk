let specialsCollapseScheduled = false;

function enhanceSpecialsPanel() {
  const panel = document.querySelector(".burgr-specials-panel");
  if (!panel) return;

  const list = panel.querySelector(".burgr-specials-list");
  if (!list) return;

  if (!panel.dataset.specialsCollapseReady) {
    panel.dataset.specialsCollapseReady = "true";

    const title = panel.querySelector(":scope > .msd-season-title");
    const subtitle = panel.querySelector(":scope > .msd-season-subtitle");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "msd-season-toggle burgr-specials-toggle";
    toggle.setAttribute("aria-expanded", "false");

    const copy = document.createElement("div");
    if (title) copy.appendChild(title);
    if (subtitle) copy.appendChild(subtitle);

    const right = document.createElement("div");
    right.className = "msd-season-toggle-right";

    const chevron = document.createElement("span");
    chevron.className = "msd-season-chevron";
    chevron.textContent = "▼";
    right.appendChild(chevron);

    toggle.append(copy, right);
    panel.insertBefore(toggle, list);

    const setOpen = (open) => {
      list.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      chevron.textContent = open ? "▲" : "▼";
      panel.classList.toggle("burgr-specials-open", open);
    };

    toggle.addEventListener("click", () => {
      setOpen(list.hidden);
    });

    panel.__burgrSetSpecialsOpen = setOpen;
    setOpen(false);
  }

  const specialsChip = Array.from(
    document.querySelectorAll(".burgr-season-chip")
  ).find((button) =>
    String(button.textContent || "")
      .trim()
      .toLowerCase()
      .startsWith("specials")
  );

  if (specialsChip && !specialsChip.dataset.specialsCollapseReady) {
    specialsChip.dataset.specialsCollapseReady = "true";
    specialsChip.addEventListener("click", () => {
      panel.__burgrSetSpecialsOpen?.(true);
    });
  }
}

function scheduleSpecialsCollapse() {
  if (specialsCollapseScheduled) return;
  specialsCollapseScheduled = true;

  window.requestAnimationFrame(() => {
    specialsCollapseScheduled = false;
    enhanceSpecialsPanel();
  });
}

const specialsCollapseObserver = new MutationObserver(scheduleSpecialsCollapse);
specialsCollapseObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

window.addEventListener("pageshow", scheduleSpecialsCollapse);
window.addEventListener("popstate", scheduleSpecialsCollapse);
scheduleSpecialsCollapse();
