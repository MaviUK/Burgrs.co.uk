import { Fragment } from "react";

// Generated reviews include numbered, clickable citations. Ordinary posts retain
// their current rendering. React escapes all text; no raw HTML is rendered.
export default function CreatorPostBody({ post, className }) {
  if (!post.body) return null;
  const review = post.is_auto_season_review || post.source_name === "Burgrs TV · AI-generated season review";
  if (!review) return <p className={className}>{post.body}</p>;
  const parts = [];
  const pattern = /\[([^\]\n]{1,160})\]\((https:\/\/[^\s)]+)\)/g;
  let offset = 0;
  for (const match of post.body.matchAll(pattern)) {
    parts.push(post.body.slice(offset, match.index));
    parts.push(<a key={match.index} href={match[2]} target="_blank" rel="noopener noreferrer" aria-label={/^\d+$/.test(match[1]) ? `Source ${match[1]}` : match[1]}>{/^\d+$/.test(match[1]) ? `[${match[1]}]` : match[1]}</a>);
    offset = match.index + match[0].length;
  }
  parts.push(post.body.slice(offset));
  return <p className={className} style={{ whiteSpace: "pre-line" }}>{parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)}</p>;
}
