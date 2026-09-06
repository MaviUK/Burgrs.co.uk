from pathlib import Path
import re

path = Path("src/pages/Rankd.jsx")
text = path.read_text()

focus_helpers = r'''function getFocusBounds(items, focus) {
  if (!focus?.showId) return { opponents: [], low: 0, high: 0 };

  const opponents = [...items]
    .sort(sortByLadder)
    .filter((show) => String(show.show_id) !== String(focus.showId));
  const indexById = new Map(
    opponents.map((show, index) => [String(show.show_id), index])
  );

  let low = 0;
  let high = opponents.length;

  (focus.lostToIds || []).forEach((id) => {
    const index = indexById.get(String(id));
    if (index != null) low = Math.max(low, index + 1);
  });

  (focus.beatenIds || []).forEach((id) => {
    const index = indexById.get(String(id));
    if (index != null) high = Math.min(high, index);
  });

  // Conflicting historic comparisons should never make focused ranking unusable.
  // Collapse to the closest legal insertion point if the bracket crosses over.
  if (low > high) {
    const currentIndex = [...items]
      .sort(sortByLadder)
      .findIndex((show) => String(show.show_id) === String(focus.showId));
    const currentInsertion = Math.max(0, Math.min(currentIndex, opponents.length));
    low = currentInsertion;
    high = currentInsertion;
  }

  return { opponents, low, high };
}

function getFocusInsertionRank(items, focus) {
  const { opponents, low, high } = getFocusBounds(items, focus);
  const insertionIndex = Math.max(0, Math.min(low, high, opponents.length));
  return insertionIndex + 1;
}

function getFocusRemainingPositions(items, focus) {
  const { low, high } = getFocusBounds(items, focus);
  return Math.max(1, high - low + 1);
}

function isFocusSettled(items, focus) {
  if (!focus) return false;
  const { low, high } = getFocusBounds(items, focus);
  return low >= high;
}

function getFocusedPair(items, focusShowId, focus = null) {
  const sorted = [...items].sort(sortByLadder);
  const focusShow = sorted.find(
    (show) => String(show.show_id) === String(focusShowId)
  );
  if (!focusShow) return [];

  const { opponents, low, high } = getFocusBounds(items, focus);
  if (!opponents.length || low >= high) return [];

  // Binary search: every answer eliminates roughly half of the remaining
  // possible positions instead of comparing one neighbouring show at a time.
  const midpoint = Math.floor((low + high) / 2);
  const testedIds = new Set((focus?.testedIds || []).map(String));
  let opponent = opponents[midpoint] || null;

  if (opponent && testedIds.has(String(opponent.show_id))) {
    opponent = null;
    const maxDistance = Math.max(midpoint - low, high - midpoint);
    for (let distance = 1; distance <= maxDistance && !opponent; distance += 1) {
      const leftIndex = midpoint - distance;
      const rightIndex = midpoint + distance;
      const left = leftIndex >= low ? opponents[leftIndex] : null;
      const right = rightIndex < high ? opponents[rightIndex] : null;

      if (left && !testedIds.has(String(left.show_id))) opponent = left;
      else if (right && !testedIds.has(String(right.show_id))) opponent = right;
    }
  }

  if (!opponent) return [];
  return Math.random() > 0.5
    ? [focusShow, opponent]
    : [opponent, focusShow];
}

function moveShowToRank'''

pattern = r'function isFocusSettled\(items, focus\) \{.*?\n\}\n\nfunction getFocusedPair\(items, focusShowId, focus = null\) \{.*?\n\}\n\nfunction moveShowToRank'
text, count = re.subn(pattern, focus_helpers, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit("Focused ranking helpers were not found")

text, count = re.subn(
    r'    const updatedLadder = applyLadderWin\(',
    '    let updatedLadder = applyLadderWin(',
    text,
    count=1,
)
if count != 1:
    raise SystemExit("updatedLadder declaration was not found")

focused_choice = r'''    if (rankFocus?.showId) {
      const focusWon = String(winner.show_id) === String(rankFocus.showId);
      const opponent = focusWon ? loser : winner;

      nextFocus = {
        ...rankFocus,
        testedIds: [
          ...new Set([
            ...(rankFocus.testedIds || []),
            String(opponent.show_id),
          ]),
        ],
        beatenIds: focusWon
          ? [
              ...new Set([
                ...(rankFocus.beatenIds || []),
                String(opponent.show_id),
              ]),
            ]
          : rankFocus.beatenIds || [],
        lostToIds: !focusWon
          ? [
              ...new Set([
                ...(rankFocus.lostToIds || []),
                String(opponent.show_id),
              ]),
            ]
          : rankFocus.lostToIds || [],
      };

      if (isFocusSettled(updatedLadder, nextFocus)) {
        const targetRank = getFocusInsertionRank(updatedLadder, nextFocus);
        updatedLadder = moveShowToRank(
          updatedLadder,
          nextFocus.showId,
          targetRank
        ).nextShows;
        nextFocus = null;
        setRankFocus(null);
        nextNotice = `${rankFocus.showName || "This show"} is confirmed at #${targetRank}.`;
      } else {
        nextPair = getFocusedPair(updatedLadder, nextFocus.showId, nextFocus);
        if (nextPair.length === 2) {
          const remainingPositions = getFocusRemainingPositions(updatedLadder, nextFocus);
          setRankFocus(nextFocus);
          nextNotice = `Ranking ${rankFocus.showName || "this show"}. ${remainingPositions} possible positions left.`;
        } else {
          const targetRank = getFocusInsertionRank(updatedLadder, nextFocus);
          updatedLadder = moveShowToRank(
            updatedLadder,
            nextFocus.showId,
            targetRank
          ).nextShows;
          nextFocus = null;
          setRankFocus(null);
          nextNotice = `${rankFocus.showName || "This show"} is confirmed at #${targetRank}.`;
        }
      }
    }

    if (!nextFocus) {'''

pattern = r'    if \(rankFocus\?\.showId\) \{.*?\n    \}\n\n    if \(!nextFocus\) \{'
text, count = re.subn(pattern, focused_choice, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit("Focused handleChoice block was not found")

start_focus = r'''    const focus = {
      showId: show.show_id,
      showName: show.show_name,
      testedIds: [],
      beatenIds: [],
      lostToIds: [],
    };

    const pair = getFocusedPair(eligibleShows, show.show_id, focus);'''

pattern = r'    const focus = \{\n      showId: show\.show_id,\n      showName: show\.show_name,.*?\n    \};\n\n    const pair = getFocusedPair\(eligibleShows, show\.show_id, focus\);'
text, count = re.subn(pattern, start_focus, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit("Focused ranking start state was not found")

text, count = re.subn(
    r'      `Ranking \$\{show\.show_name\}\. BURGRS will move it higher or lower until its position is confirmed\.`',
    '      `Ranking ${show.show_name}. Each choice cuts the remaining possible positions roughly in half.`',
    text,
    count=1,
)
if count != 1:
    raise SystemExit("Focused ranking start notice was not found")

path.write_text(text)
