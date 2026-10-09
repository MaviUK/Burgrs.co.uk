import { shareActivity } from "./lib/shareActivity";

let shareStatusTimer = null;

function showShareToast(message) {
  let toast = document.querySelector(".burgrs-share-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "burgrs-share-toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(shareStatusTimer);
  shareStatusTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 1800);
}

function getText(node, selector) {
  return node?.querySelector?.(selector)?.textContent?.trim() || "";
}

function getHref(node, selector) {
  return node?.querySelector?.(selector)?.getAttribute?.("href") || "";
}

function makeAbsolute(path) {
  if (!path) return window.location.href;
  if (path.startsWith("http")) return path;
  return `${window.location.origin}${path}`;
}

function loadShareImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawCoverImage(ctx, image, x, y, width, height, radius = 34) {
  ctx.save();
  roundRect(ctx, x, y, width, height, radius);
  ctx.clip();

  if (image) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    const fallback = ctx.createLinearGradient(x, y, x + width, y + height);
    fallback.addColorStop(0, "#312e81");
    fallback.addColorStop(1, "#111827");
    ctx.fillStyle = fallback;
    ctx.fillRect(x, y, width, height);
  }

  ctx.restore();
  ctx.save();
  roundRect(ctx, x, y, width, height, radius);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
    if (lines.length >= maxLines) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  lines.slice(0, maxLines).forEach((line, index) => {
    const finalLine = index === maxLines - 1 && words.join(" ").length > lines.join(" ").length
      ? `${line.replace(/\.*$/, "")}...`
      : line;
    ctx.fillText(finalLine, x, y + index * lineHeight);
  });
}

function getCardPosterUrls(card) {
  return Array.from(card.querySelectorAll("img"))
    .map((image) => image.currentSrc || image.src || "")
    .filter(Boolean)
    .slice(0, 8);
}

async function createActivityShareImageFile(card, payload, type) {
  const posterUrls = getCardPosterUrls(card);
  const posterImages = await Promise.all(posterUrls.map(loadShareImage));
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const bg = ctx.createLinearGradient(0, 0, 1200, 900);
  bg.addColorStop(0, "#020617");
  bg.addColorStop(0.55, "#071426");
  bg.addColorStop(1, "#020617");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1200, 900);

  const glow = ctx.createRadialGradient(600, 275, 80, 600, 275, 520);
  glow.addColorStop(0, "rgba(168, 85, 247, 0.34)");
  glow.addColorStop(1, "rgba(168, 85, 247, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1200, 900);

  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  for (let i = 0; i < 24; i += 1) {
    ctx.beginPath();
    ctx.arc((i * 97) % 1200, 70 + ((i * 61) % 760), 2 + (i % 5), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 46px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("BURGRS", 600, 76);

  const cardX = 70;
  const cardY = 120;
  const cardW = 1060;
  const cardH = 700;
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, 46);
  ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(196, 181, 253, 0.28)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  const isReview = type === "review";
  if (isReview) {
    drawCoverImage(ctx, posterImages[0], 110, 170, 330, 470, 34);
  } else {
    const gridX = 110;
    const gridY = 170;
    const size = 150;
    const gap = 14;
    for (let i = 0; i < 6; i += 1) {
      const x = gridX + (i % 3) * (size + gap);
      const y = gridY + Math.floor(i / 3) * (size + gap);
      drawCoverImage(ctx, posterImages[i], x, y, size, 220, 24);
    }
  }

  const textX = isReview ? 490 : 650;
  const textW = isReview ? 570 : 420;
  const creator = getText(card, ".following-creator-name-link strong") || getText(document, ".creator-page .creator-hero-content h1") || "Mavi";
  const heading = type === "review"
    ? getText(card, ".editorial-review-show strong") || getText(card, ".following-show-card strong") || getText(card, ".creator-review-show strong") || "Show review"
    : getText(card, ".creator-list-cover-content h3") || "TV list";
  const subtitle = type === "review"
    ? getText(card, ".editorial-review-summary-text") || getText(card, ".following-review-text") || getText(card, "p") || "Shared a review on BURGRS."
    : getText(card, ".creator-list-cover-content p") || "Shared a TV list on BURGRS.";

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(196, 181, 253, 0.92)";
  ctx.font = "900 30px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(type === "review" ? "REVIEW" : "LIST", textX, 210);

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 64px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  drawWrappedText(ctx, heading, textX, 295, textW, 72, 3);

  ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
  ctx.font = "700 32px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  drawWrappedText(ctx, subtitle, textX, 535, textW, 42, 3);

  ctx.fillStyle = "rgba(255, 255, 255, 0.58)";
  ctx.font = "800 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(`Shared by ${creator}`, textX, 695);

  ctx.fillStyle = "rgba(255, 255, 255, 0.48)";
  ctx.font = "800 24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Vote, rank and review TV on BURGRS", 600, 858);

  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) return resolve(null);
        const safe = String(payload?.title || "burgrs-share")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60);
        resolve(new File([blob], `${safe || "burgrs-share"}.png`, { type: "image/png" }));
      }, "image/png", 0.95);
    } catch {
      resolve(null);
    }
  });
}

function makeShareButton(options, container, type) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "burgrs-activity-share-btn";
  button.textContent = "Share";
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "Sharing...";

    try {
      const payload = typeof options === "function" ? options() : options;
      const imageFile = await createActivityShareImageFile(container, payload, type);
      const result = await shareActivity({ ...payload, files: imageFile ? [imageFile] : [] });

      if (result?.copied) showShareToast("Share text copied");
      else if (result?.ok) showShareToast(result.sharedFiles ? "Image share opened" : "Share opened");
      else if (!result?.cancelled) showShareToast("Could not share");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

  return button;
}

function addShareButton(container, options, type) {
  if (!container || container.querySelector(".burgrs-activity-share-btn")) return;

  const button = makeShareButton(options, container, type);
  const creatorCopy = container.querySelector(".following-creator-copy");
  const creatorName = creatorCopy?.querySelector(".following-creator-name-link");

  if (creatorCopy && creatorName) {
    let topRow = creatorCopy.querySelector(".burgrs-creator-name-share-row");
    if (!topRow) {
      topRow = document.createElement("div");
      topRow.className = "burgrs-creator-name-share-row";
      creatorName.parentNode.insertBefore(topRow, creatorName);
      topRow.appendChild(creatorName);
    }
    topRow.appendChild(button);
    return;
  }

  const target = container.querySelector(".creator-list-expanded-body") || container;
  target.appendChild(button);
}

function addCreatorReviewShares() {
  document.querySelectorAll(".creator-page .creator-review-card").forEach((card) => {
    addShareButton(card, () => {
      const showName = getText(card, ".editorial-review-show strong") || getText(card, ".creator-review-show strong") || "this show";
      const reviewText = getText(card, ".editorial-review-summary-text") || getText(card, "p");
      const showHref = getHref(card, ".editorial-review-cover") || getHref(card, ".creator-review-show") || window.location.pathname;
      const creatorName = getText(document, ".creator-page .creator-hero-content h1") || "Someone";

      return {
        title: `${creatorName}'s review of ${showName} on BURGRS`,
        text: reviewText
          ? `${creatorName} reviewed ${showName}: "${reviewText.slice(0, 140)}${reviewText.length > 140 ? "..." : ""}"`
          : `${creatorName} reviewed ${showName} on BURGRS.`,
        url: makeAbsolute(showHref),
      };
    }, "review");
  });
}

function addCreatorListShares() {
  document.querySelectorAll(".creator-page .creator-list-card").forEach((card) => {
    addShareButton(card, () => {
      const title = getText(card, ".creator-list-cover-content h3") || "TV list";
      const subtitle = getText(card, ".creator-list-cover-content p");
      const creatorName = getText(document, ".creator-page .creator-hero-content h1") || "Someone";
      const currentUrl = window.location.href.split("#")[0];

      return {
        title: `${creatorName}'s ${title} on BURGRS`,
        text: `${creatorName} shared ${title}${subtitle ? ` - ${subtitle}` : ""} on BURGRS.`,
        url: currentUrl,
      };
    }, "list");
  });
}

function addFollowingReviewShares() {
  document.querySelectorAll(".following-page .following-card").forEach((card) => {
    const activityType = getText(card, ".following-meta-type").toLowerCase();
    if (activityType !== "review") return;

    addShareButton(card, () => {
      const creatorName = getText(card, ".following-creator-name-link strong") || "Someone";
      const showName = getText(card, ".editorial-review-show strong") || getText(card, ".following-show-card strong") || "this show";
      const reviewText = getText(card, ".editorial-review-summary-text") || getText(card, ".following-review-text");
      const showHref = getHref(card, ".editorial-review-cover") || getHref(card, ".following-show-card") || window.location.pathname;

      return {
        title: `${creatorName}'s review of ${showName} on BURGRS`,
        text: reviewText
          ? `${creatorName} reviewed ${showName}: "${reviewText.slice(0, 140)}${reviewText.length > 140 ? "..." : ""}"`
          : `${creatorName} reviewed ${showName} on BURGRS.`,
        url: makeAbsolute(showHref),
      };
    }, "review");
  });
}

function addFollowingListShares() {
  document.querySelectorAll(".following-page .following-card-list").forEach((card) => {
    addShareButton(card, () => {
      const creatorName = getText(card, ".following-creator-name-link strong") || "Someone";
      const profileHref = getHref(card, ".following-creator-name-link") || getHref(card, ".following-avatar-link") || window.location.pathname;
      const title = getText(card, ".creator-list-cover-content h3") || "TV list";
      const subtitle = getText(card, ".creator-list-cover-content p");

      return {
        title: `${creatorName}'s ${title} on BURGRS`,
        text: `${creatorName} shared ${title}${subtitle ? ` - ${subtitle}` : ""} on BURGRS.`,
        url: makeAbsolute(profileHref),
      };
    }, "list");
  });
}

function installActivityShareButtons() {
  const path = window.location.pathname;
  if (path.startsWith("/u/")) {
    addCreatorReviewShares();
    addCreatorListShares();
  }

  if (path === "/following") {
    addFollowingReviewShares();
    addFollowingListShares();
  }
}

if (typeof window !== "undefined") {
  const queueInstall = () => window.setTimeout(installActivityShareButtons, 120);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", queueInstall, { once: true });
  } else {
    queueInstall();
  }

  const observer = new MutationObserver(queueInstall);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", queueInstall);
}
