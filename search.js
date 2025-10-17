import { tokenize } from "./indexer.js";

const MAX_RESULTS = 12;
const EXACT_BOOST = 1;
const PREFIX_BOOST = 0.7;
const FUZZY_BOOST = 0.45;
const TAB_BOOST_SHORT_QUERY = 2.5;
const COMMAND_SCORE = Number.POSITIVE_INFINITY;
const BASE_TYPE_SCORES = {
  tab: 6,
  bookmark: 4,
  history: 2,
};

const COMMANDS = [
  {
    id: "command:tab-sort",
    title: "Tab sort",
    aliases: ["sort tabs", "tabs sort", "sort tab", "tab order", "order tabs", "organize tabs"],
    action: "tab-sort",
    answer(context) {
      const countLabel = formatTabCount(context.tabCount);
      return `Sorts all ${countLabel} by domain and title`;
    },
    description(context) {
      const countLabel = formatTabCount(context.tabCount);
      return `${countLabel} · Domain + title order`;
    },
    isAvailable(context) {
      return context.tabCount > 0;
    },
  },
  {
    id: "command:tab-shuffle",
    title: "Tab shuffle",
    aliases: ["shuffle tabs", "tabs shuffle", "shuffle my tabs", "randomize tabs", "tab random"],
    action: "tab-shuffle",
    answer(context) {
      const countLabel = formatTabCount(context.tabCount);
      return `Shuffles all ${countLabel} just for fun`;
    },
    description(context) {
      const countLabel = formatTabCount(context.tabCount);
      return `${countLabel} · Random order`;
    },
    isAvailable(context) {
      return context.tabCount > 1;
    },
  },
];

function formatTabCount(count) {
  if (count === 1) {
    return "1 tab";
  }
  return `${count} tabs`;
}

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

function compareResults(a, b) {
  const aScore = typeof a.score === "number" ? a.score : 0;
  const bScore = typeof b.score === "number" ? b.score : 0;

  const aIsCommand = aScore === COMMAND_SCORE;
  const bIsCommand = bScore === COMMAND_SCORE;

  if (aIsCommand && !bIsCommand) return -1;
  if (bIsCommand && !aIsCommand) return 1;

  if (bScore !== aScore) return bScore - aScore;

  if (a.type !== b.type) {
    return (BASE_TYPE_SCORES[b.type] || 0) - (BASE_TYPE_SCORES[a.type] || 0);
  }

  const aTitle = a.title || "";
  const bTitle = b.title || "";
  return aTitle.localeCompare(bTitle);
}

function normalizeCommandToken(text = "") {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findCommandMatch(query, context) {
  const compactQuery = normalizeCommandToken(query);
  if (!compactQuery) {
    return null;
  }

  for (const command of COMMANDS) {
    if (!command.isAvailable?.(context)) {
      continue;
    }
    const phrases = [command.title, ...(command.aliases || [])];
    const matched = phrases.some((phrase) => normalizeCommandToken(phrase).startsWith(compactQuery));
    if (!matched) {
      continue;
    }
    const answer = command.answer ? command.answer(context) : "";
    const description = command.description ? command.description(context) : answer;
    return {
      ghostText: command.title,
      answer,
      result: {
        id: command.id,
        title: command.title,
        url: description,
        description,
        type: "command",
        command: command.action,
        label: "Command",
        score: COMMAND_SCORE,
      },
    };
  }

  return null;
}

function normalizeGhostValue(text = "") {
  return text.toLowerCase().replace(/\s+/g, "");
}

function appendCandidate(list, seen, value) {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  list.push(trimmed);
}

function collectGhostCandidates(result) {
  const candidates = [];
  const seen = new Set();

  appendCandidate(candidates, seen, result.title);
  appendCandidate(candidates, seen, result.url);

  if (result.url) {
    try {
      const url = new URL(result.url);
      appendCandidate(candidates, seen, url.hostname);
      const hostPath = `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
      appendCandidate(candidates, seen, hostPath);
    } catch (err) {
      // Ignore malformed URLs when building ghost candidates.
    }
  }

  return candidates;
}

function findGhostSuggestionForResult(query, result) {
  const normalizedQuery = normalizeGhostValue(query);
  if (!normalizedQuery) return null;

  const candidates = collectGhostCandidates(result);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeGhostValue(candidate);
    if (normalizedCandidate && normalizedCandidate.startsWith(normalizedQuery)) {
      return candidate;
    }
  }

  return null;
}

function findGhostSuggestion(query, results) {
  const normalizedQuery = normalizeGhostValue(query);
  if (!normalizedQuery) {
    return null;
  }

  for (const result of results) {
    if (!result || result.type === "command") {
      continue;
    }
    const suggestion = findGhostSuggestionForResult(query, result);
    if (suggestion) {
      return { text: suggestion, answer: "" };
    }
  }

  return null;
}

export function runSearch(query, data) {
  const trimmed = (query || "").trim();
  const { index, termBuckets, items, metadata = {} } = data;
  const tabCount = typeof metadata.tabCount === "number"
    ? metadata.tabCount
    : items.reduce((count, item) => (item.type === "tab" ? count + 1 : count), 0);

  const commandContext = { tabCount };
  const commandSuggestion = trimmed ? findCommandMatch(trimmed, commandContext) : null;

  if (!trimmed) {
    const tabs = items.filter((item) => item.type === "tab");
    tabs.sort((a, b) => {
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      const aTime = a.lastAccessed || 0;
      const bTime = b.lastAccessed || 0;
      return bTime - aTime;
    });
    return {
      results: tabs.slice(0, MAX_RESULTS).map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        type: item.type,
        score: BASE_TYPE_SCORES[item.type] + computeRecencyBoost(item),
      })),
      ghost: null,
      answer: "",
    };
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    return { results: [], ghost: null, answer: "" };
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

  if (commandSuggestion) {
    results.push(commandSuggestion.result);
  }

  results.sort(compareResults);

  const finalResults = results.slice(0, MAX_RESULTS);
  const hasCommand = commandSuggestion && finalResults.includes(commandSuggestion.result);
  const generalGhost = hasCommand ? null : findGhostSuggestion(trimmed, finalResults);

  return {
    results: finalResults,
    ghost: hasCommand
      ? { text: commandSuggestion.ghostText }
      : generalGhost,
    answer: hasCommand
      ? commandSuggestion.answer
      : generalGhost?.answer || "",
  };
}
