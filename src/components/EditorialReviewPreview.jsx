import { useId, useState } from "react";
import { Link } from "react-router-dom";
import "./EditorialReviewPreview.css";

export default function EditorialReviewPreview({ review, show, href }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const blocks = String(review.body || "").trim().split(/\n\s*\n/).filter(Boolean);
  const title = review.creator_post?.title || blocks[0] || "";
  const match = title.match(/^(.+?)\s*[—–]\s*Season\s+(\d+):\s*(.+)$/i);
  const headline = match?.[3] || title;
  const seasonLabel = match ? `Season ${match[2]}` : "Season review";
  const text = blocks[0] === title ? blocks.slice(1) : blocks;
  const artwork = review.creator_post?.image_url || show?.backdrop_url;
  const year = show?.first_aired ? String(show.first_aired).slice(0, 4) : "";
  const expansionButton = text.length > 1 ? (
    <button type="button" className="editorial-review-toggle" aria-expanded={expanded}
      aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}>
      {expanded ? "less..." : "more..."}
    </button>
  ) : null;
  return (
    <div className="editorial-review-preview">
      <Link to={href} className={`editorial-review-cover${artwork ? "" : " editorial-review-cover-plain"}`}>
        {artwork ? <img src={artwork} alt="" loading="lazy" /> : null}
        <div className="editorial-review-show">
          <strong>{show?.name || match?.[1] || "Show review"}</strong>
          <span>{[seasonLabel, year].filter(Boolean).join(" · ")}</span>
        </div>
      </Link>
      {headline ? <h3 className="editorial-review-headline">{headline}</h3> : null}
      {text[0] ? (
        <p className="editorial-review-summary">
          <span className="editorial-review-summary-text">{text[0]}</span>
          {!expanded && expansionButton ? <>{" "}{expansionButton}</> : null}
        </p>
      ) : null}
      {text.length > 1 ? (
        <div id={detailsId} className="editorial-review-details" hidden={!expanded}>
          {text.slice(1).map((paragraph, index) => (
            <p key={index}>
              {paragraph}
              {expanded && index === text.length - 2 ? <>{" "}{expansionButton}</> : null}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
