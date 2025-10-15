import { tokenize } from "./indexer.js";

const MAX_RESULTS = 12;
const EXACT_BOOST = 1;
const PREFIX_BOOST = 0.7;
const FUZZY_BOOST = 0.45;
const TAB_BOOST_SHORT_QUERY = 2.5;
const BASE_TYPE_SCORES = {
  tab: 6,
  bookmark: 4,
  history: 2,
};

function computeRecencyBoost(item) {
  const now = Date.now();
  const timestamp = item.lastAccessed || item.lastVisitTime || item.dateAdded || 0;
  if (!timestamp) return 0;
  const hours = Math.max(0, (now - timestamp) / 36e5);
  if (hours < 1) return 2;
  if (hours < 24) return 1.2;
  if (hours < 168) return 0.4;
  return 0.1;
}

function collectCandidateTerms(token, termBuckets) {
  if (!token) return [];
  const firstChar = token[0] || "";
  const primary = termBuckets[firstChar];
  if (Array.isArray(primary) && primary.length) {
    return primary;
  }
  const fallback = termBuckets[""];
  if (Array.isArray(fallback) && fallback.length) {
    return fallback;
  }
  return termBuckets["*"] || [];
}

function isFuzzyMatch(term, queryToken) {
  if (term === queryToken) return true;
  const lenDiff = Math.abs(term.length - queryToken.length);
  if (lenDiff > 1) return false;

  let mismatches = 0;
  let i = 0;
  let j = 0;
  while (i < term.length && j < queryToken.length) {
    if (term[i] === queryToken[j]) {
      i += 1;
      j += 1;
      continue;
    }
    mismatches += 1;
    if (mismatches > 1) return false;
    if (term.length > queryToken.length) {
      i += 1;
    } else if (term.length < queryToken.length) {
      j += 1;
    } else {
      i += 1;
      j += 1;
    }
  }

  if (i < term.length || j < queryToken.length) {
    mismatches += 1;
  }

  return mismatches <= 1;
}

function applyMatches(entry, multiplier, scores) {
  for (const [itemId, weight] of entry.entries()) {
    scores.set(itemId, (scores.get(itemId) || 0) + weight * multiplier);
  }
}

export function runSearch(query, data) {
  const trimmed = (query || "").trim();
  const { index, termBuckets, items } = data;

  if (!trimmed) {
    const tabs = items.filter((item) => item.type === "tab");
    tabs.sort((a, b) => {
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      const aTime = a.lastAccessed || 0;
      const bTime = b.lastAccessed || 0;
      return bTime - aTime;
    });
    return tabs.slice(0, MAX_RESULTS).map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      type: item.type,
      score: BASE_TYPE_SCORES[item.type] + computeRecencyBoost(item),
    }));
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    return [];
  }

  const scores = new Map();

  for (const token of tokens) {
    const exactEntry = index.get(token);
    if (exactEntry) {
      applyMatches(exactEntry, EXACT_BOOST, scores);
    }

    const candidates = collectCandidateTerms(token, termBuckets);
    for (const term of candidates) {
      if (!term) continue;
      const entry = index.get(term);
      if (!entry) continue;

      if (term.startsWith(token) && term !== token) {
        applyMatches(entry, PREFIX_BOOST, scores);
      } else if (isFuzzyMatch(term, token) && term !== token) {
        applyMatches(entry, FUZZY_BOOST, scores);
      }
    }
  }

  const results = [];
  const shortQuery = trimmed.replace(/\s+/g, "").length <= 3;

  for (const [itemId, score] of scores.entries()) {
    const item = items[itemId];
    if (!item) continue;
    let finalScore = score + (BASE_TYPE_SCORES[item.type] || 0) + computeRecencyBoost(item);
    if (shortQuery && item.type === "tab") {
      finalScore += TAB_BOOST_SHORT_QUERY;
    }
    results.push({
      id: item.id,
      title: item.title,
      url: item.url,
      type: item.type,
      score: finalScore,
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.type !== b.type) {
      return (BASE_TYPE_SCORES[b.type] || 0) - (BASE_TYPE_SCORES[a.type] || 0);
    }
    return a.title.localeCompare(b.title);
  });

  return results.slice(0, MAX_RESULTS);
}
