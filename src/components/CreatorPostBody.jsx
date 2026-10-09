import { Fragment } from "react";
import { reviewLinkParts } from "../lib/generatedReviewLinks.mjs";

// Keep ordinary posts as plain text; generated reviews have compact source links.
export default function CreatorPostBody({ post, className, style, hideShowLink = false }) {
  if (!post.body) return null;
  const review = post.is_auto_season_review || post.source_name === "Burgrs TV · AI-generated season review";
  if (!review) return <p className={className} style={style}>{post.body}</p>;
  const parts = reviewLinkParts(post.body, hideShowLink);
  return (
    <p className={className} style={{ whiteSpace: "pre-line", ...style }}>
      {parts.map((part, index) => part.href ? (
        <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>
      ) : <Fragment key={index}>{part.text}</Fragment>)}
    </p>
  );
}
