const clean = (value) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
// Conservatively count non-ASCII code points as two; X links have fixed weight 23.
export const weight = (value) => [...value].reduce((n, c) => n + (c.codePointAt(0) > 127 ? 2 : 1), 0);
export function shorten(value, limit) {
  if (weight(value) <= limit) return value;
  let result = '';
  for (const c of value) {
    if (weight(result + c) > limit - 2) break;
    result += c;
  }
  return result.trimEnd() + '…';
}
export function formatPost(post, username) {
  const title = clean(post.title), body = clean(post.body);
  if (!title && !body) throw new Error('Post has no text to share');
  const source = post.is_auto_news && post.source_name ? '\nSource: ' + shorten(clean(post.source_name), 45) : '';
  const link = post.related_show_id
    ? 'https://burgrs.co.uk/show/' + encodeURIComponent(post.related_show_id)
    : 'https://burgrs.co.uk/u/' + encodeURIComponent(username);
  const text = shorten([title, body].filter(Boolean).join('\n\n'), 280 - weight(source) - 25);
  return text + source + '\n\n' + link;
}
