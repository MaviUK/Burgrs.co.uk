import { supabase } from "./lib/supabase";

let rankdLastShareUrl = "";
let rankdShareSheet = null;
let rankdCopiedTimer = null;
let rankdShareInFlight = false;
let rankdLastShareImageFile = null;

function isRankdShareUrl(value) {
  return typeof value === "string" && value.includes("/rankd/share/");
}

function makePairKey(firstId, secondId) {
  return [firstId, secondId].map(String).sort().join(":");
}

function getOrderedPair(firstId, secondId) {
  const [showAId, showBId] = [firstId, secondId].map(String).sort();
  return { showAId, showBId, pairKey: `${showAId}:${showBId}` };
}

function makeShareSlug(leftTitle, rightTitle) {
  const clean = (value) =>
    String(value || "show")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "show";

  return `${clean(leftTitle)}-vs-${clean(rightTitle)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getRankdShareTitles() {
  const titles = Array.from(document.querySelectorAll(".rankd-page .rankd-card-title"))
    .map((element) => element.textContent?.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (titles.length === 2) return titles;
  return ["this show", "that show"];
}

function getRankdPosterUrls() {
  return Array.from(document.querySelectorAll(".rankd-page .rankd-battle-shell .rankd-poster-image"))
    .map((image) => image.currentSrc || image.src || "")
    .filter(Boolean)
    .slice(0, 2);
}

function getRankdShareCopy(url) {
  const [leftTitle, rightTitle] = getRankdShareTitles();
  const title = `${leftTitle} vs ${rightTitle} on BURGRS`;
  const text = `Which show wins: ${leftTitle} or ${rightTitle}? Vote on BURGRS.`;

  return { title, text, url };
}

function setRankdInlineShareStatus(message) {
  const form = document.querySelector(".rankd-page .rankd-comment-form");
  const actions = form?.querySelector(".rankd-comment-actions");
  if (!form || !actions) return;

  let status = form.querySelector(".rankd-share-helper-status");
  if (!status) {
    status = document.createElement("p");
    status.className = "rankd-muted rankd-share-helper-status";
    actions.insertAdjacentElement("afterend", status);
  }

  status.textContent = message || "";
  status.hidden = !message;
}

function getRankdShareButton(target) {
  const button = target?.closest?.("button");
  if (!button) return null;
  if (!document.querySelector(".rankd-page")?.contains(button)) return null;

  const label = button.textContent?.trim().toLowerCase() || "";
  return label.includes("share matchup") ? button : null;
}

async function findCurrentShowsByTitle(leftTitle, rightTitle) {
  const wanted = [leftTitle, rightTitle].filter(Boolean);
  if (wanted.length !== 2) throw new Error("Could not read this matchup.");

  const { data, error } = await supabase
    .from("shows")
    .select("id, name")
    .in("name", wanted);

  if (error) throw error;

  const rows = data || [];
  const left = rows.find((row) => row.name === leftTitle);
  const right = rows.find((row) => row.name === rightTitle);

  if (!left?.id || !right?.id) {
    throw new Error("Could not find both shows for this matchup.");
  }

  return { left, right };
}

async function createRankdShareUrl() {
  const [leftTitle, rightTitle] = getRankdShareTitles();
  const { left, right } = await findCurrentShowsByTitle(leftTitle, rightTitle);
  const { showAId, showBId, pairKey } = getOrderedPair(left.id, right.id);

  const { data: existing, error: existingError } = await supabase
    .from("rankd_matchups")
    .select("id, share_slug")
    .eq("pair_key", pairKey)
    .maybeSingle();

  if (existingError) throw existingError;

  const shareSlug = existing?.share_slug || makeShareSlug(leftTitle, rightTitle);

  const { data: sharedMatchup, error: shareError } = await supabase.rpc(
    "set_rankd_matchup_share",
    {
      p_show_a_id: showAId,
      p_show_b_id: showBId,
      p_share_slug: shareSlug,
    }
  );

  if (shareError) throw shareError;

  const finalShareSlug = sharedMatchup?.share_slug || shareSlug;
  return `${window.location.origin}/rankd/share/${finalShareSlug}`;
}

function openExternalShare(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

async function copyRankdShareLink(url, message = "Link copied") {
  try {
    await navigator.clipboard?.writeText(url);
    showRankdCopied(message);
  } catch {
    showRankdCopied("Copy failed");
  }
}

async function shareViaNativeOrCopy(title, text, url, platformName, fallbackUrl = "") {
  if (navigator.share) {
    try {
      const payload = rankdLastShareImageFile && navigator.canShare?.({ files: [rankdLastShareImageFile] })
        ? { title, text, url, files: [rankdLastShareImageFile] }
        : { title, text, url };
      await navigator.share(payload);
      closeRankdShareSheet();
      return;
    } catch (shareError) {
      const isCancel = String(shareError?.name || "").toLowerCase().includes("abort");
      if (isCancel) return;
    }
  }

  await copyRankdShareLink(url, `Link copied - paste it into ${platformName}`);
  if (fallbackUrl) {
    window.setTimeout(() => {
      openExternalShare(fallbackUrl);
    }, 450);
  }
}

async function shareToInstagram(title, text, url) {
  await shareViaNativeOrCopy(title, text, url, "Instagram", "https://www.instagram.com/");
}

async function shareToThreads(title, text, url) {
  await shareViaNativeOrCopy(title, text, url, "Threads", "https://www.threads.net/");
}

async function shareToMessenger(title, text, url) {
  await shareViaNativeOrCopy(title, text, url, "Messenger", "https://www.messenger.com/");
}

function loadShareImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }

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

function drawPoster(ctx, image, x, y, width, height, title) {
  ctx.save();
  roundRect(ctx, x, y, width, height, 34);
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
    ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 44px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(title || "BURGRS", x + width / 2, y + height / 2, width - 52);
  }

  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, width, height, 34);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function drawCenteredText(ctx, text, x, y, maxWidth, fontSize = 52) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;

  let size = fontSize;
  while (ctx.measureText(text).width > maxWidth && size > 28) {
    size -= 2;
    ctx.font = `900 ${size}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
  }

  ctx.fillText(text, x, y);
  ctx.restore();
}

async function createRankdShareImageFile(url) {
  const [leftTitle, rightTitle] = getRankdShareTitles();
  const [leftPoster, rightPoster] = getRankdPosterUrls();
  const [leftImage, rightImage] = await Promise.all([loadShareImage(leftPoster), loadShareImage(rightPoster)]);

  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 864;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const background = ctx.createLinearGradient(0, 0, 1536, 864);
  background.addColorStop(0, "#020617");
  background.addColorStop(0.52, "#071426");
  background.addColorStop(1, "#020617");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1536, 864);

  const glow = ctx.createRadialGradient(768, 390, 40, 768, 390, 390);
  glow.addColorStop(0, "rgba(168, 85, 247, 0.30)");
  glow.addColorStop(1, "rgba(168, 85, 247, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1536, 864);

  ctx.save();
  ctx.globalAlpha = 0.26;
  ctx.fillStyle = "#7c3aed";
  ctx.beginPath();
  ctx.ellipse(768, 430, 330, 170, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const posterWidth = 520;
  const posterHeight = 620;
  const posterTop = 72;
  const leftX = 120;
  const rightX = 896;

  drawPoster(ctx, leftImage, leftX, posterTop, posterWidth, posterHeight, leftTitle);
  drawPoster(ctx, rightImage, rightX, posterTop, posterWidth, posterHeight, rightTitle);

  const vsGradient = ctx.createLinearGradient(680, 344, 856, 520);
  vsGradient.addColorStop(0, "#8b5cf6");
  vsGradient.addColorStop(1, "#db2777");
  ctx.fillStyle = vsGradient;
  ctx.beginPath();
  ctx.arc(768, 420, 88, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 48px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("VS", 768, 420);

  drawCenteredText(ctx, leftTitle, leftX + posterWidth / 2, 760, 520, 56);
  drawCenteredText(ctx, rightTitle, rightX + posterWidth / 2, 760, 520, 56);

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.52)";
  ctx.textAlign = "center";
  ctx.font = "800 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("Vote now on BURGRS", 768, 828);
  ctx.restore();

  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }

        const safeName = `${leftTitle}-vs-${rightTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        resolve(new File([blob], `${safeName || "burgrs-matchup"}.png`, { type: "image/png" }));
      }, "image/png", 0.95);
    } catch (error) {
      console.warn("Rankd share image failed:", error);
      resolve(null);
    }
  });
}

async function tryNativeImageShare(title, text, url, imageFile) {
  if (!navigator.share || !imageFile || !navigator.canShare?.({ files: [imageFile] })) return false;

  try {
    await navigator.share({ title, text, url, files: [imageFile] });
    return true;
  } catch (shareError) {
    const isCancel = String(shareError?.name || "").toLowerCase().includes("abort");
    if (isCancel) return true;
    console.warn("Rankd native image share failed:", shareError);
    return false;
  }
}

async function downloadRankdShareImage() {
  try {
    const imageFile = rankdLastShareImageFile || await createRankdShareImageFile(rankdLastShareUrl);
    if (!imageFile) {
      showRankdCopied("Could not create image");
      return;
    }

    rankdLastShareImageFile = imageFile;
    const objectUrl = URL.createObjectURL(imageFile);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = imageFile.name || "burgrs-matchup.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
    showRankdCopied("Image downloaded");
  } catch (error) {
    console.warn("Rankd image download failed:", error);
    showRankdCopied("Could not download image");
  }
}

function showRankdCopied(message) {
  const copied = rankdShareSheet?.querySelector?.(".rankd-share-copied");
  if (!copied) return;

  copied.textContent = message;
  copied.hidden = false;

  window.clearTimeout(rankdCopiedTimer);
  rankdCopiedTimer = window.setTimeout(() => {
    copied.hidden = true;
  }, 2200);
}

function closeRankdShareSheet() {
  rankdShareSheet?.remove();
  rankdShareSheet = null;
}

function createShareButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `rankd-share-option ${className || ""}`.trim();
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function showRankdShareSheet(url, imageFile = rankdLastShareImageFile) {
  if (!isRankdShareUrl(url)) return;

  rankdLastShareUrl = url;
  rankdLastShareImageFile = imageFile || rankdLastShareImageFile;
  closeRankdShareSheet();

  const { title, text } = getRankdShareCopy(url);
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);
  const encodedTitle = encodeURIComponent(title);
  const combinedText = encodeURIComponent(`${text}\n${url}`);

  const overlay = document.createElement("div");
  overlay.className = "rankd-share-sheet-overlay";

  const sheet = document.createElement("div");
  sheet.className = "rankd-share-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Share Rank'd matchup");

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "rankd-share-close";
  closeButton.setAttribute("aria-label", "Close share options");
  closeButton.textContent = "×";

  const heading = document.createElement("h2");
  heading.textContent = "Share matchup";

  const intro = document.createElement("p");
  intro.textContent = text;

  const options = document.createElement("div");
  options.className = "rankd-share-options";

  const urlLabel = document.createElement("small");
  urlLabel.className = "rankd-share-url";
  urlLabel.textContent = url;

  const copied = document.createElement("strong");
  copied.className = "rankd-share-copied";
  copied.hidden = true;

  closeButton.addEventListener("click", closeRankdShareSheet);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeRankdShareSheet();
  });

  if (navigator.share) {
    options.appendChild(
      createShareButton("Share via phone", "rankd-share-native", async () => {
        try {
          const payload = rankdLastShareImageFile && navigator.canShare?.({ files: [rankdLastShareImageFile] })
            ? { title, text, url, files: [rankdLastShareImageFile] }
            : { title, text, url };
          await navigator.share(payload);
          closeRankdShareSheet();
        } catch (shareError) {
          const isCancel = String(shareError?.name || "").toLowerCase().includes("abort");
          if (!isCancel) showRankdCopied("Could not open share menu");
        }
      })
    );
  }

  options.appendChild(
    createShareButton("Download image", "rankd-share-download", () => {
      downloadRankdShareImage();
    })
  );

  options.appendChild(
    createShareButton("Instagram", "rankd-share-instagram", () => {
      shareToInstagram(title, text, url);
    })
  );

  options.appendChild(
    createShareButton("Threads", "rankd-share-threads", () => {
      shareToThreads(title, text, url);
    })
  );

  options.appendChild(
    createShareButton("WhatsApp", "rankd-share-whatsapp", () => {
      openExternalShare(`https://wa.me/?text=${combinedText}`);
    })
  );

  options.appendChild(
    createShareButton("Facebook", "rankd-share-facebook", () => {
      openExternalShare(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`);
    })
  );

  options.appendChild(
    createShareButton("X", "rankd-share-x", () => {
      openExternalShare(`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`);
    })
  );

  options.appendChild(
    createShareButton("Reddit", "rankd-share-reddit", () => {
      openExternalShare(`https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`);
    })
  );

  options.appendChild(
    createShareButton("Messenger", "rankd-share-messenger", () => {
      shareToMessenger(title, text, url);
    })
  );

  options.appendChild(
    createShareButton("Telegram", "rankd-share-telegram", () => {
      openExternalShare(`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`);
    })
  );

  options.appendChild(
    createShareButton("SMS", "rankd-share-sms", () => {
      window.location.href = `sms:?body=${combinedText}`;
    })
  );

  options.appendChild(
    createShareButton("Copy link", "rankd-share-copy", () => {
      copyRankdShareLink(url);
    })
  );

  sheet.appendChild(closeButton);
  sheet.appendChild(heading);
  sheet.appendChild(intro);
  sheet.appendChild(options);
  sheet.appendChild(urlLabel);
  sheet.appendChild(copied);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  rankdShareSheet = overlay;
}

async function handleRankdShareButtonClick(event) {
  const button = getRankdShareButton(event.target);
  if (!button || rankdShareInFlight) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();

  rankdShareInFlight = true;
  const originalText = button.textContent;
  button.textContent = "Preparing share...";
  button.disabled = true;
  setRankdInlineShareStatus("Creating share image...");

  try {
    const shareUrl = await createRankdShareUrl();
    const { title, text } = getRankdShareCopy(shareUrl);
    rankdLastShareUrl = shareUrl;

    const imageFile = await createRankdShareImageFile(shareUrl);
    rankdLastShareImageFile = imageFile;

    setRankdInlineShareStatus("");

    const nativeShared = await tryNativeImageShare(title, text, shareUrl, imageFile);
    if (!nativeShared) {
      showRankdShareSheet(shareUrl, imageFile);
    }
  } catch (shareError) {
    console.error("RANKD SOCIAL SHARE FAILED:", shareError);
    setRankdInlineShareStatus(shareError.message || "Could not create share link.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
    rankdShareInFlight = false;
  }
}

function patchRankdClipboardShare() {
  if (!navigator.clipboard?.writeText || navigator.clipboard.writeText.__rankdSharePatched) return;

  const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);

  async function patchedWriteText(value) {
    const result = await originalWriteText(value);

    if (isRankdShareUrl(value)) {
      rankdLastShareUrl = value;
      window.dispatchEvent(new CustomEvent("rankd:share-url-ready", { detail: { url: value } }));
    }

    return result;
  }

  patchedWriteText.__rankdSharePatched = true;
  navigator.clipboard.writeText = patchedWriteText;
}

if (typeof window !== "undefined") {
  patchRankdClipboardShare();

  document.addEventListener("click", handleRankdShareButtonClick, true);

  window.addEventListener("rankd:share-url-ready", (event) => {
    const url = event.detail?.url || rankdLastShareUrl;
    window.setTimeout(() => showRankdShareSheet(url), 80);
  });
}
