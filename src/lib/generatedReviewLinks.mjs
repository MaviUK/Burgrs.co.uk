// Generated content is text, never HTML. Only public HTTPS links become anchors.
export function reviewLinkParts(body, hideShowLink = false) {
  const text = String(body || "").split("\n").filter(line => !hideShowLink || !line.startsWith("View show: ")).join("\n").trim();
  const parts = [];
  const pattern = /\[([^\]\n]{1,160})\]\s*\((https:\/\/[^\s)]+)\)/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    let url;
    try { url = new URL(match[2]); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) continue;
    parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: /^\d+$/.test(match[1]) ? `[${match[1]}]` : match[1], href: url.href });
    offset = match.index + match[0].length;
  }
  parts.push({ text: text.slice(offset) });
  return parts;
}
