function publicImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')
      || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')
      || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) return '';
    return url.href;
  } catch { return ''; }
}

export function imageAssets(post, show = null) {
  const original = publicImageUrl(post.image_url);
  const url = original || publicImageUrl(show?.poster_url);
  if (!url) return [];
  const label = !original && show?.name ? `Poster for ${show.name}` : `Artwork accompanying ${post.title || 'this Burgrs TV post'}`;
  return [{ image: { url, metadata: { altText: label.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,300) } } }];
}
