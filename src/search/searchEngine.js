import { tokenize } from "../common/text.js";
import {
  buildSubfilterOptions,
  sanitizeSubfilterSelection,
  matchesSubfilter,
  computeHistoryBoundaries,
} from "./subfilters.js";

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

const COMMAND_ICON_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzYzNzlmZiIvPjxwYXRoIGQ9Ik0xMCAxNmgxMiIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjxwYXRoIGQ9Ik0xNiAxMHYxMiIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvc3ZnPg==";

const FILTER_ALIASES = {
  tab: ["tab:", "tabs:", "t:"],
  bookmark: ["bookmark:", "bookmarks:", "bm:", "b:"],
  history: ["history:", "hist:", "h:", "back:", "forward:"],
};

const STATIC_COMMANDS = [
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
  const aIsCommandType = a && a.type === "command";
  const bIsCommandType = b && b.type === "command";

  if (aIsCommandType && !bIsCommandType) return -1;
  if (bIsCommandType && !aIsCommandType) return 1;

  const aScore = typeof a.score === "number" ? a.score : 0;
  const bScore = typeof b.score === "number" ? b.score : 0;

  const aIsCommand = aScore === COMMAND_SCORE;
  const bIsCommand = bScore === COMMAND_SCORE;

  if (aIsCommand && !bIsCommand) return -1;
  if (bIsCommand && !aIsCommand) return 1;
  if (aIsCommand && bIsCommand) {
    const aRank = typeof a.commandRank === "number" ? a.commandRank : Number.MAX_SAFE_INTEGER;
    const bRank = typeof b.commandRank === "number" ? b.commandRank : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
  }

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

function findBestStaticCommand(query, context) {
  const compactQuery = normalizeCommandToken(query);
  if (!compactQuery) {
    return null;
  }

  for (const command of STATIC_COMMANDS) {
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
        faviconUrl: COMMAND_ICON_DATA_URL,
      },
    };
  }

  return null;
}

function getTabDomain(tab) {
  if (!tab || !tab.url) return "";
  try {
    const url = new URL(tab.url);
    return url.hostname || "";
  } catch (err) {
    return "";
  }
}

function findMatchingTabsForCloseCommand(tabs, query) {
  const normalizedQuery = query.trim().toLowerCase();
  const scored = [];

  for (const tab of tabs) {
    const title = (tab.title || "").toLowerCase();
    const url = (tab.url || "").toLowerCase();
    const domain = getTabDomain(tab).toLowerCase();
    let score = 0;

    if (!normalizedQuery) {
      score = 1;
    } else {
      if (title.includes(normalizedQuery)) score += 4;
      if (domain.includes(normalizedQuery)) score += 3;
      if (url.includes(normalizedQuery)) score += 1;
      if (title.startsWith(normalizedQuery)) score += 2;
      if (domain.startsWith(normalizedQuery)) score += 2;
    }

    if (!score && normalizedQuery) {
      continue;
    }

    if (tab.active) score += 0.5;
    const recency = typeof tab.lastAccessed === "number" ? tab.lastAccessed : 0;
    scored.push({ tab, score, recency });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.recency || 0) - (a.recency || 0);
  });

  return scored.slice(0, 6).map((entry) => entry.tab);
}

function normalizeWord(word) {
  return (word || "").toLowerCase();
}

function formatTabLabel(tab) {
  const title = tab.title || tab.url || "Untitled tab";
  const domain = getTabDomain(tab);
  if (!domain) {
    return title;
  }
  return `${title} (${domain})`;
}

function collectTabCloseSuggestions(query, context) {
  const tabs = context?.tabs || [];
  if (!tabs.length) {
    return { results: [], ghost: null, answer: "" };
  }

  const matches = findMatchingTabsForCloseCommand(tabs, query);
  if (!matches.length) {
    return { results: [], ghost: null, answer: "" };
  }

  const results = matches.map((tab, index) => {
    const domain = getTabDomain(tab);
    const title = formatTabLabel(tab);
    const description = domain ? `Closes ${domain}` : "Close matching tab";
    return {
      id: `command:tab-close:${index}`,
      title,
      url: tab.url,
      description,
      type: "command",
      command: "tab-close",
      args: { tabId: tab.id },
      label: "Command",
      score: COMMAND_SCORE,
      faviconUrl: COMMAND_ICON_DATA_URL,
    };
  });

  return {
    results,
    ghost: results[0]?.title || null,
    answer: `Closes ${results.length === 1 ? "the matching tab" : "matching tabs"}.`,
  };
}

function collectDomainMatches(tabs, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const counts = new Map();
  for (const tab of tabs) {
    const domain = getTabDomain(tab);
    if (!domain) continue;
    const lowerDomain = domain.toLowerCase();
    if (!lowerDomain.includes(normalized)) continue;
    counts.set(domain, (counts.get(domain) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.domain.localeCompare(b.domain);
    })
    .slice(0, 5);
}

function collectTabCloseByDomainSuggestions(query, context) {
  const tabs = context?.tabs || [];
  if (!tabs.length) {
    return { results: [], ghost: null, answer: "" };
  }

  const domains = collectDomainMatches(tabs, query);
  if (!domains.length) {
    return { results: [], ghost: null, answer: "" };
  }

  const results = domains.map(({ domain, count }, index) => {
    const label = `${domain} (${count})`;
    const description = `Closes ${count} tab${count === 1 ? "" : "s"} from ${domain}`;
    return {
      id: `command:tab-close-domain:${index}`,
      title: label,
      url: description,
      description,
      type: "command",
      command: "tab-close-domain",
      args: { domain },
      label: "Command",
      score: COMMAND_SCORE,
      faviconUrl: COMMAND_ICON_DATA_URL,
    };
  });

  return {
    results,
    ghost: results[0]?.title || null,
    answer: `Closes ${results[0].description || "matching tabs"}.`,
  };
}

function collectCommandSuggestions(query, context) {
  const suggestions = [];
  let ghost = null;
  let answer = "";

  const staticMatch = findBestStaticCommand(query, context);
  if (staticMatch) {
    const ranked = { ...staticMatch.result, commandRank: suggestions.length };
    suggestions.push(ranked);
    ghost = ghost || staticMatch.ghostText;
    answer = answer || staticMatch.answer;
  }

  const closeSuggestions = collectTabCloseSuggestions(query, context);
  if (closeSuggestions.results.length) {
    closeSuggestions.results.forEach((result) => {
      suggestions.push({ ...result, commandRank: suggestions.length });
    });
    if (!ghost && closeSuggestions.ghost) {
      ghost = closeSuggestions.ghost;
    }
    if (!answer && closeSuggestions.answer) {
      answer = closeSuggestions.answer;
    }
  }

  const domainCloseSuggestions = collectTabCloseByDomainSuggestions(query, context);
  if (domainCloseSuggestions.results.length) {
    domainCloseSuggestions.results.forEach((result) => {
      suggestions.push({ ...result, commandRank: suggestions.length });
    });
    if (!ghost && domainCloseSuggestions.ghost) {
      ghost = domainCloseSuggestions.ghost;
    }
    if (!answer && domainCloseSuggestions.answer) {
      answer = domainCloseSuggestions.answer;
    }
  }

  return { results: suggestions, ghost, answer };
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

function extractFilterPrefix(query) {
  const lowerQuery = query.toLowerCase();
  for (const [type, prefixes] of Object.entries(FILTER_ALIASES)) {
    for (const prefix of prefixes) {
      if (lowerQuery.startsWith(prefix)) {
        return { filterType: type, remainder: query.slice(prefix.length) };
      }
    }
  }
  return { filterType: null, remainder: query };
}

export function runSearch(query, data, options = {}) {
  const initial = (query || "").trim();
  const { filterType, remainder } = extractFilterPrefix(initial);
  const trimmed = remainder.trim();
  const { index, termBuckets, items, metadata = {} } = data;
  const tabCount =
    typeof metadata.tabCount === "number"
      ? metadata.tabCount
      : items.reduce((count, item) => (item.type === "tab" ? count + 1 : count), 0);

  const tabs = items.filter((item) => item.type === "tab");
  const bookmarkItems = filterType === "bookmark" ? items.filter((item) => item.type === "bookmark") : [];
  const historyBoundaries = computeHistoryBoundaries(Date.now());
  const availableSubfilters = buildSubfilterOptions(filterType, { tabs, bookmarks: bookmarkItems });
  const activeSubfilterId = sanitizeSubfilterSelection(filterType, options?.subfilter, availableSubfilters);
  const subfilterPayload =
    filterType && availableSubfilters.length
      ? { type: filterType, options: availableSubfilters, activeId: activeSubfilterId }
      : null;
  const subfilterContext = { historyBoundaries };
  const commandContext = { tabCount, tabs };
  const commandSuggestions = trimmed
    ? collectCommandSuggestions(trimmed, commandContext)
    : { results: [], ghost: null, answer: "" };

  if (!trimmed) {
    let defaultItems = filterType
      ? items.filter((item) => item.type === filterType)
      : items.filter((item) => item.type === "tab");

    defaultItems = defaultItems.filter((item) => matchesSubfilter(item, filterType, activeSubfilterId, subfilterContext));

    if (filterType === "tab" || !filterType) {
      defaultItems.sort((a, b) => {
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        const aTime = a.lastAccessed || 0;
        const bTime = b.lastAccessed || 0;
        return bTime - aTime;
      });
    } else {
      defaultItems.sort((a, b) => {
        const aScore = (BASE_TYPE_SCORES[a.type] || 0) + computeRecencyBoost(a);
        const bScore = (BASE_TYPE_SCORES[b.type] || 0) + computeRecencyBoost(b);
        if (bScore !== aScore) return bScore - aScore;
        const aTitle = a.title || "";
        const bTitle = b.title || "";
        return aTitle.localeCompare(bTitle);
      });
    }
    return {
      results: defaultItems.slice(0, MAX_RESULTS).map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        type: item.type,
        score: BASE_TYPE_SCORES[item.type] + computeRecencyBoost(item),
        faviconUrl: item.faviconUrl || null,
        origin: item.origin || "",
        tabId: item.tabId,
      })),
      ghost: null,
      answer: "",
      filter: filterType,
      subfilters: subfilterPayload,
    };
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    return { results: [], ghost: null, answer: "", filter: filterType };
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
    if (filterType && item.type !== filterType) {
      continue;
    }
    if (!matchesSubfilter(item, filterType, activeSubfilterId, subfilterContext)) {
      continue;
    }
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
      faviconUrl: item.faviconUrl || null,
      origin: item.origin || "",
      tabId: item.tabId,
    });
  }

  if (commandSuggestions.results.length) {
    results.push(...commandSuggestions.results);
  }

  results.sort(compareResults);

  const finalResults = results.slice(0, MAX_RESULTS);
  const topResult = finalResults[0] || null;
  const hasCommand = finalResults.some((result) => result?.score === COMMAND_SCORE);
  let ghostPayload = null;
  let answer = "";

  const topIsCommand = Boolean(topResult && (topResult.type === "command" || topResult.score === COMMAND_SCORE));

  if (topIsCommand) {
    const commandGhostText = topResult.title || commandSuggestions.ghost || "";
    ghostPayload = commandGhostText ? { text: commandGhostText } : null;
    answer = commandSuggestions.answer || "";
  } else if (topResult) {
    const normalizedQuery = normalizeGhostValue(trimmed);
    const topDisplay = topResult.title || topResult.url || "";
    if (normalizedQuery && topDisplay && normalizeGhostValue(topDisplay).startsWith(normalizedQuery)) {
      ghostPayload = { text: topDisplay };
    } else {
      const primarySuggestion = findGhostSuggestionForResult(trimmed, topResult);
      if (primarySuggestion) {
        ghostPayload = { text: primarySuggestion };
      } else {
        const fallbackGhost = findGhostSuggestion(trimmed, finalResults);
        if (fallbackGhost) {
          ghostPayload = fallbackGhost;
          answer = fallbackGhost.answer || "";
        }
      }
    }
  } else if (hasCommand && commandSuggestions.ghost) {
    ghostPayload = { text: commandSuggestions.ghost };
    answer = commandSuggestions.answer || "";
  }

  if (!ghostPayload && !hasCommand) {
    const fallbackGhost = findGhostSuggestion(trimmed, finalResults);
    if (fallbackGhost) {
      ghostPayload = fallbackGhost;
      answer = fallbackGhost.answer || "";
    }
  }

  return {
    results: finalResults,
    ghost: ghostPayload,
    answer,
    filter: filterType,
    subfilters: subfilterPayload,
  };
}
