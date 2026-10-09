import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import ReviewThread from "./ReviewThread";

const REVIEW_SORT_STORAGE_KEY = "burgrs-show-review-sort";

const sortOptions = [
  { value: "newest", label: "Newest", icon: "📅" },
  { value: "oldest", label: "Oldest", icon: "📅" },
  { value: "rating-high", label: "Highest rated", icon: "🍔" },
  { value: "rating-low", label: "Lowest rated", icon: "🍔" },
];

const config = {
  reviewTable: "show_reviews",
  voteTable: "show_review_votes",
  voteIdColumn: "review_id",
  itemColumn: "show_id",
  ratingTable: "burgr_ratings",
  sectionClass: "msd-reviews-section msd-show-reviews-section",
  headingClass: "msd-section-title",
  placeholder: "Write your review...",
  rows: 5,
};

function getInitialSort() {
  try {
    const saved = window.localStorage.getItem(REVIEW_SORT_STORAGE_KEY);
    return sortOptions.some((option) => option.value === saved) ? saved : "newest";
  } catch {
    return "newest";
  }
}

function getReviewValues(reviewElement) {
  const ratingText = reviewElement.querySelector(".msd-review-rating")?.textContent || "";
  const dateText = reviewElement.querySelector(".msd-review-date")?.textContent || "";
  const rating = Number.parseFloat(ratingText.replace("%", ""));
  const date = Date.parse(dateText);

  return {
    pinned: reviewElement.dataset.reviewPinned === "true",
    rating: Number.isFinite(rating) ? rating : null,
    date: Number.isFinite(date) ? date : 0,
  };
}

function applyReviewSort(container, sortOrder) {
  const reviewList = container?.querySelector(".msd-review-list");
  if (!reviewList) return;

  const rootReviews = Array.from(reviewList.children).filter((element) =>
    element.classList.contains("msd-review-item")
  );

  const ranked = rootReviews
    .map((element, originalIndex) => ({
      element,
      originalIndex,
      ...getReviewValues(element),
    }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sortOrder === "oldest") return a.date - b.date || a.originalIndex - b.originalIndex;
      if (sortOrder === "rating-high") {
        if (a.rating === null && b.rating === null) return b.date - a.date;
        if (a.rating === null) return 1;
        if (b.rating === null) return -1;
        return b.rating - a.rating || b.date - a.date;
      }
      if (sortOrder === "rating-low") {
        if (a.rating === null && b.rating === null) return b.date - a.date;
        if (a.rating === null) return 1;
        if (b.rating === null) return -1;
        return a.rating - b.rating || b.date - a.date;
      }
      return b.date - a.date || a.originalIndex - b.originalIndex;
    });

  ranked.forEach(({ element }, index) => {
    element.style.order = String(index);
  });
}

export default function ShowReviews({ showId, currentUserId }) {
  const [canInteract, setCanInteract] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(Boolean(currentUserId && showId));
  const [sortOrder, setSortOrder] = useState(getInitialSort);
  const [sortOpen, setSortOpen] = useState(false);
  const sectionRef = useRef(null);
  const sortMenuRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      if (!currentUserId || !showId) {
        setCanInteract(false);
        setCheckingAccess(false);
        return;
      }

      setCheckingAccess(true);

      try {
        const { data, error } = await supabase
          .from("user_shows_new")
          .select("show_id")
          .eq("user_id", currentUserId)
          .eq("show_id", showId)
          .maybeSingle();

        if (error) throw error;
        if (!cancelled) setCanInteract(Boolean(data?.show_id));
      } catch (error) {
        console.warn("Failed checking review access:", error);
        if (!cancelled) setCanInteract(false);
      } finally {
        if (!cancelled) setCheckingAccess(false);
      }
    }

    checkAccess();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, showId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(REVIEW_SORT_STORAGE_KEY, sortOrder);
    } catch {
      // Sorting still works when storage is unavailable.
    }

    const container = sectionRef.current;
    if (!container) return undefined;

    const sortReviews = () => applyReviewSort(container, sortOrder);
    sortReviews();

    const observer = new MutationObserver(sortReviews);
    observer.observe(container, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [sortOrder, showId]);

  useEffect(() => {
    if (!sortOpen) return undefined;

    function closeSortMenu(event) {
      if (!sortMenuRef.current?.contains(event.target)) setSortOpen(false);
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") setSortOpen(false);
    }

    document.addEventListener("pointerdown", closeSortMenu);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeSortMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [sortOpen]);

  const interactionUserId = !checkingAccess && canInteract ? currentUserId : null;
  const activeSort = sortOptions.find((option) => option.value === sortOrder) || sortOptions[0];

  return (
    <div ref={sectionRef} style={{ position: "relative" }}>
      <style>{`
        .msd-show-reviews-section {
          gap: 8px;
        }

        .msd-show-reviews-section > .msd-section-title {
          margin-bottom: 0;
        }
      `}</style>

      <div
        ref={sortMenuRef}
        style={{
          position: "absolute",
          top: "0",
          right: 0,
          zIndex: 5,
        }}
      >
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={sortOpen}
          onClick={() => setSortOpen((open) => !open)}
          style={{
            border: 0,
            background: "transparent",
            color: "#f8fafc",
            padding: "3px 0 3px 12px",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            font: "inherit",
            fontSize: "0.92rem",
            fontWeight: 700,
            lineHeight: 1.2,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <span>Sort: {activeSort.label}</span>
          <span aria-hidden="true" style={{ fontSize: "0.72em" }}>
            {sortOpen ? "▲" : "▼"}
          </span>
        </button>

        {sortOpen ? (
          <div
            role="menu"
            aria-label="Sort reviews"
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              width: "min(250px, calc(100vw - 44px))",
              padding: "8px",
              border: "1px solid #2b3954",
              borderRadius: "16px",
              background: "#121a2b",
              boxShadow: "0 18px 40px rgba(0, 0, 0, 0.42)",
            }}
          >
            {sortOptions.map((option) => {
              const selected = option.value === sortOrder;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    setSortOrder(option.value);
                    setSortOpen(false);
                  }}
                  style={{
                    width: "100%",
                    border: selected ? "1px solid rgba(190, 24, 93, 0.72)" : "1px solid transparent",
                    borderRadius: "12px",
                    background: selected ? "rgba(190, 24, 93, 0.18)" : "transparent",
                    color: selected ? "#fbcfe8" : "#f8fafc",
                    padding: "11px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    textAlign: "left",
                    font: "inherit",
                    fontWeight: selected ? 800 : 700,
                    cursor: "pointer",
                  }}
                >
                  <span aria-hidden="true" style={{ width: "22px", textAlign: "center" }}>
                    {option.icon}
                  </span>
                  <span style={{ flex: 1 }}>{option.label}</span>
                  {selected ? <span aria-hidden="true">✓</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <ReviewThread
        config={config}
        itemId={showId}
        currentUserId={interactionUserId}
        heading="Reviews"
      />
    </div>
  );
}
