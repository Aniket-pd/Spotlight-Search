import { tokenize, BOOKMARK_ROOT_FOLDER_KEY } from "./indexer.js";

const DEFAULT_MAX_RESULTS = 12;
const HISTORY_MAX_RESULTS = Number.POSITIVE_INFINITY;
const EXACT_BOOST = 1;
const PREFIX_BOOST = 0.7;
const FUZZY_BOOST = 0.45;
const TAB_BOOST_SHORT_QUERY = 2.5;
const COMMAND_SCORE = Number.POSITIVE_INFINITY;
const BASE_TYPE_SCORES = {
  tab: 6,
  bookmark: 4,
  history: 2,
  download: 3,
};

function getResultLimit(filterType) {
  if (filterType === "history") {
    return HISTORY_MAX_RESULTS;
  }
  return DEFAULT_MAX_RESULTS;
}

function sliceResultsForLimit(items, limit) {
  if (!Array.isArray(items)) {
    return [];
  }
  if (!Number.isFinite(limit)) {
    return items.slice();
  }
  return items.slice(0, limit);
}

const COMMAND_ICON_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzYzNzlmZiIvPjxwYXRoIGQ9Ik0xMCAxNmgxMiIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjxwYXRoIGQ9Ik0xNiAxMHYxMiIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvc3ZnPg==";

const FILTER_ALIASES = {
  tab: ["tab:", "tabs:", "t:"],
  bookmark: ["bookmark:", "bookmarks:", "bm:", "b:"],
  history: ["history:", "hist:", "h:"],
  download: ["download:", "downloads:", "dl:", "d:"],
  back: ["back:"],
  forward: ["forward:"],
};

const NAVIGATION_FILTERS = new Set(["back", "forward"]);
const MAX_NAVIGATION_RESULTS = 12;
const NAVIGATION_BASE_SCORE = 120;
const NAVIGATION_STEP_PENALTY = 6;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SUBFILTER_OPTIONS = 12;
const COMMON_SECOND_LEVEL_TLDS = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "go", "ne", "or"]);

function toStartOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function computeHistoryBoundaries(now = Date.now()) {
  const startToday = toStartOfDay(now);
  const startYesterday = startToday - DAY_MS;
  const sevenDaysAgo = now - 7 * DAY_MS;
  const thirtyDaysAgo = now - 30 * DAY_MS;
  return {
    startToday,
    startYesterday,
    sevenDaysAgo,
    thirtyDaysAgo,
  };
}

function matchesHistoryRange(timestamp, rangeId, boundaries) {
  if (!timestamp) {
    return false;
  }
  const { startToday, startYesterday, sevenDaysAgo, thirtyDaysAgo } = boundaries;
  switch (rangeId) {
    case "today":
      return timestamp >= startToday;
    case "yesterday":
      return timestamp >= startYesterday && timestamp < startToday;
    case "last7":
      return timestamp >= sevenDaysAgo;
    case "last30":
      return timestamp >= thirtyDaysAgo;
    case "older":
      return timestamp > 0 && timestamp < thirtyDaysAgo;
    default:
      return true;
  }
}

function buildHistorySubfilters() {
  return [
    { id: "all", label: "All History" },
    { id: "today", label: "Today" },
    { id: "yesterday", label: "Yesterday" },
    { id: "last7", label: "Last 7 Days" },
    { id: "last30", label: "Last 30 Days" },
    { id: "older", label: "Older" },
  ];
}

function extractHostname(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (err) {
    return "";
  }
}

function toTitleCase(text) {
  if (!text) return "";
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatTokenLabel(token) {
  if (!token) return "";
  const cleaned = token.replace(/[-_]+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  const compact = cleaned.replace(/\s+/g, "");
  if (compact.length <= 3) {
    return cleaned.toUpperCase();
  }
  return toTitleCase(cleaned);
}

function formatDomainLabel(domain) {
  if (!domain) return "Unknown";
  const trimmed = domain.replace(/^www\./i, "");
  const segments = trimmed.split(".").filter(Boolean);
  if (!segments.length) {
    return "Unknown";
  }
  if (segments.length === 1) {
    return formatTokenLabel(segments[0]);
  }
  const last = segments[segments.length - 1];
  const secondLast = segments[segments.length - 2];
  const shortSecond = secondLast && secondLast.length <= 3;
  if (segments.length >= 3 && (shortSecond || COMMON_SECOND_LEVEL_TLDS.has(secondLast))) {
    const candidate = segments[segments.length - 3];
    if (candidate) {
      return formatTokenLabel(candidate);
    }
  }
  return formatTokenLabel(secondLast) || formatTokenLabel(segments[0]);
}

function buildTabSubfilters(tabs) {
  const counts = new Map();
  for (const tab of tabs || []) {
    const domain = extractHostname(tab.url);
    if (!domain) continue;
    counts.set(domain, (counts.get(domain) || 0) + 1);
  }

  const entries = Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, MAX_SUBFILTER_OPTIONS);

  const options = [{ id: "all", label: "All Tabs" }];
  for (const [domain, count] of entries) {
    options.push({
      id: `domain:${domain}`,
      label: formatDomainLabel(domain),
      hint: domain,
      count,
    });
  }
  return options;
}

function formatFolderLabel(path) {
  if (!Array.isArray(path) || !path.length) {
    return "Unsorted";
  }
  const last = path[path.length - 1];
  return last || "Unsorted";
}

function normalizeFolderKey(value) {
  if (typeof value === "string" && value) {
    return value;
  }
  return BOOKMARK_ROOT_FOLDER_KEY;
}

function buildBookmarkSubfilters(bookmarks) {
  const counts = new Map();
  for (const bookmark of bookmarks || []) {
    const path = Array.isArray(bookmark.folderPath) ? bookmark.folderPath.filter(Boolean) : [];
    const key = normalizeFolderKey(bookmark.folderKey);
    const existing = counts.get(key) || { count: 0, path };
    existing.count += 1;
    if (!existing.path.length && path.length) {
      existing.path = path;
    }
    counts.set(key, existing);
  }

  const options = [{ id: "all", label: "All Bookmarks" }];
  const entries = Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      const labelA = formatFolderLabel(a[1].path);
      const labelB = formatFolderLabel(b[1].path);
      return labelA.localeCompare(labelB);
    })
    .slice(0, MAX_SUBFILTER_OPTIONS);

  for (const [key, info] of entries) {
    const label = formatFolderLabel(info.path);
    const hint = info.path.length > 1 ? info.path.join(" › ") : info.path[0] || label;
    options.push({
      id: `folder:${key}`,
      label,
      hint,
      count: info.count,
    });
  }

  return options;
}

function buildDownloadSubfilters(downloads) {
  const options = [{ id: "all", label: "All Downloads" }];
  let inProgress = 0;
  let completed = 0;
  let interrupted = 0;

  for (const download of downloads || []) {
    const state = typeof download?.state === "string" ? download.state.toLowerCase() : "";
    if (state === "in_progress") {
      inProgress += 1;
    } else if (state === "complete") {
      completed += 1;
    } else if (state === "interrupted") {
      interrupted += 1;
    }
  }

  if (inProgress > 0) {
    options.push({ id: "state:in_progress", label: "In Progress", count: inProgress });
  }
  if (completed > 0) {
    options.push({ id: "state:complete", label: "Completed", count: completed });
  }
  if (interrupted > 0) {
    options.push({ id: "state:interrupted", label: "Interrupted", count: interrupted });
  }

  return options;
}

function buildSubfilterOptions(filterType, { tabs = [], bookmarks = [], downloads = [] } = {}) {
  if (!filterType) {
    return [];
  }
  if (filterType === "history") {
    return buildHistorySubfilters();
  }
  if (filterType === "tab") {
    return buildTabSubfilters(tabs);
  }
  if (filterType === "bookmark") {
    return buildBookmarkSubfilters(bookmarks);
  }
  if (filterType === "download") {
    return buildDownloadSubfilters(downloads);
  }
  return [];
}

function sanitizeSubfilterSelection(filterType, requested, options) {
  if (!filterType || !Array.isArray(options) || !options.length) {
    return null;
  }

  const validIds = new Set(options.map((option) => option.id));
  const requestedId =
    requested &&
    typeof requested === "object" &&
    requested.type === filterType &&
    typeof requested.id === "string"
      ? requested.id
      : null;

  if (requestedId && validIds.has(requestedId)) {
    return requestedId;
  }

  if (validIds.has("all")) {
    return "all";
  }

  return options[0]?.id || null;
}

function matchesSubfilter(item, filterType, subfilterId, context) {
  if (!filterType) {
    return true;
  }
  if (!subfilterId || subfilterId === "all") {
    return true;
  }

  if (filterType === "history") {
    const boundaries = context?.historyBoundaries || computeHistoryBoundaries(Date.now());
    const timestamp = typeof item?.lastVisitTime === "number" ? item.lastVisitTime : 0;
    return matchesHistoryRange(timestamp, subfilterId, boundaries);
  }

  if (filterType === "tab") {
    if (!subfilterId.startsWith("domain:")) {
      return true;
    }
    const target = subfilterId.slice("domain:".length);
    if (!target) {
      return true;
    }
    const itemDomain = extractHostname(item?.url || "");
    return itemDomain === target;
  }

  if (filterType === "bookmark") {
    if (!subfilterId.startsWith("folder:")) {
      return true;
    }
    const key = subfilterId.slice("folder:".length);
    const itemKey = normalizeFolderKey(item?.folderKey);
    return key === itemKey;
  }

  if (filterType === "download") {
    if (!subfilterId.startsWith("state:")) {
      return true;
    }
    const target = subfilterId.slice("state:".length);
    const state = typeof item?.state === "string" ? item.state.toLowerCase() : "";
    if (!target) {
      return true;
    }
    if (target === "in_progress") {
      return state === "in_progress";
    }
    if (target === "complete") {
      return state === "complete";
    }
    if (target === "interrupted") {
      return state === "interrupted";
    }
    return true;
  }

  return true;
}

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

function buildResultFromItem(item, scoreValue) {
  if (!item) {
    return null;
  }
  const result = {
    id: item.id,
    title: item.title,
    url: item.url,
    type: item.type,
    score:
      typeof scoreValue === "number"
        ? scoreValue
        : (BASE_TYPE_SCORES[item.type] || 0) + computeRecencyBoost(item),
    faviconUrl: item.faviconUrl || null,
    origin: item.origin || "",
    tabId: item.tabId,
  };
  if (typeof item.lastVisitTime === "number") {
    result.lastVisitTime = item.lastVisitTime;
  }
  if (typeof item.lastAccessed === "number") {
    result.lastAccessed = item.lastAccessed;
  }
  if (typeof item.dateAdded === "number") {
    result.dateAdded = item.dateAdded;
  }
  if (typeof item.createdAt === "number") {
    result.createdAt = item.createdAt;
  }
  return result;
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

  if (a?.type === "history" && b?.type === "history") {
    const aTime = typeof a.lastVisitTime === "number" ? a.lastVisitTime : 0;
    const bTime = typeof b.lastVisitTime === "number" ? b.lastVisitTime : 0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }
  }

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

function matchToken(word, target) {
  const lowerWord = normalizeWord(word);
  const lowerTarget = normalizeWord(target);
  if (!lowerWord) return false;
  return lowerTarget.startsWith(lowerWord) || lowerWord.startsWith(lowerTarget);
}

function formatWindowLabel(tab) {
  if (typeof tab.windowId !== "number") {
    return "";
  }
  return `Window ${tab.windowId}`;
}

function buildCloseTabResult(tab) {
  const tabId = typeof tab.tabId === "number" ? tab.tabId : null;
  if (tabId === null) {
    return null;
  }
  const domain = getTabDomain(tab);
  const windowLabel = formatWindowLabel(tab);
  const descriptionParts = [];
  if (domain) {
    descriptionParts.push(domain);
  }
  if (windowLabel) {
    descriptionParts.push(windowLabel);
  }

  const description = descriptionParts.join(" · ") || tab.url || "";

  return {
    id: `command:close-tab:${tab.tabId ?? tab.id}`,
    title: `Close “${tab.title || tab.url || "Untitled"}”`,
    url: description,
    description,
    type: "command",
    command: "tab-close",
    args: { tabId },
    label: "Command",
    score: COMMAND_SCORE,
    faviconUrl: COMMAND_ICON_DATA_URL,
  };
}

function collectTabCloseSuggestions(query, context) {
  const tabs = context.tabs || [];
  if (!tabs.length) {
    return { results: [], ghost: null, answer: "" };
  }

  const firstWord = normalizeWord(query.split(/\s+/)[0]);
  const normalizedToken = normalizeCommandToken(query);
  const looksLikeClose =
    matchToken(firstWord, "close") ||
    matchToken(normalizedToken, "close") ||
    normalizeWord(query).startsWith("close");

  if (!looksLikeClose) {
    return { results: [], ghost: null, answer: "" };
  }

  const remainder = query.slice((query.match(/^\s*\S+/)?.[0] || "").length).trim();
  const remainderWords = remainder.split(/\s+/).filter(Boolean);
  const firstRemainder = normalizeWord(remainderWords[0]);

  const looksLikeAll =
    matchToken(firstRemainder, "all") ||
    normalizeCommandToken(query).startsWith("closeall");
  if (looksLikeAll) {
    return collectCloseAllSuggestions(remainderWords.slice(1), context);
  }

  const matchingTabs = findMatchingTabsForCloseCommand(tabs, remainder);
  if (!matchingTabs.length) {
    return {
      results: [],
      ghost: remainder ? null : "Close all tabs",
      answer: "",
    };
  }

  const results = matchingTabs
    .map((tab) => buildCloseTabResult(tab))
    .filter(Boolean);
  if (!results.length) {
    return { results: [], ghost: null, answer: "" };
  }
  return {
    results,
    ghost: results[0]?.title || null,
    answer: "",
  };
}

function collectCloseAllSuggestions(words, context) {
  const tabs = context.tabs || [];
  const rest = words || [];
  let remainingWords = rest.slice();

  if (remainingWords.length) {
    const first = normalizeWord(remainingWords[0]);
    if (matchToken(first, "tabs")) {
      remainingWords = remainingWords.slice(1);
    }
  }

  const domainQuery = remainingWords.join(" ").trim();
  if (!domainQuery) {
    const activeTab = tabs.find((tab) => tab.active);
    const windowId = typeof activeTab?.windowId === "number" ? activeTab.windowId : null;
    const windowTabs = windowId === null ? tabs : tabs.filter((tab) => tab.windowId === windowId);
    const totalInWindow = windowTabs.length;
    const closingCount = Math.max(totalInWindow - 1, 0);
    const countLabel = formatTabCount(totalInWindow);
    const title = "Close all tabs";
    const description = `${countLabel} in window · Active tab stays open`;
    const answer = closingCount === 0
      ? "Only the active tab is open in this window."
      : `Closes ${closingCount} other ${closingCount === 1 ? "tab" : "tabs"} in this window.`;
    return {
      results: [
        {
          id: "command:close-tabs-all",
          title,
          url: description,
          description,
          type: "command",
          command: "tab-close-all",
          args: {},
          label: "Command",
          score: COMMAND_SCORE,
          faviconUrl: COMMAND_ICON_DATA_URL,
        },
      ],
      ghost: title,
      answer,
    };
  }

  const domainMatches = collectDomainMatches(tabs, domainQuery);
  if (!domainMatches.length) {
    return { results: [], ghost: null, answer: "" };
  }

  const results = domainMatches.map(({ domain, count }) => {
    const title = `Close all ${count === 1 ? "tab" : "tabs"} from ${domain}`;
    const description = `${count} ${count === 1 ? "tab" : "tabs"} · ${domain}`;
    return {
      id: `command:close-domain:${domain}`,
      title,
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

function computeDownloadStatePriority(item) {
  if (!item || item.type !== "download") {
    return 5;
  }
  const state = typeof item.state === "string" ? item.state.toLowerCase() : "";
  if (state === "in_progress") {
    return item.paused ? 1 : 0;
  }
  if (state === "complete") {
    return 2;
  }
  if (state === "interrupted") {
    return 3;
  }
  return 4;
}

function computeDownloadBoost(item) {
  if (!item || item.type !== "download") {
    return 0;
  }
  const state = typeof item.state === "string" ? item.state.toLowerCase() : "";
  if (state === "in_progress") {
    return item.paused ? 1.5 : 3.5;
  }
  if (state === "complete") {
    return 1.8;
  }
  if (state === "interrupted") {
    return -0.5;
  }
  return 0.2;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  if (value >= 100) {
    return `${Math.round(value)} ${units[index]}`;
  }
  if (value >= 10) {
    return `${value.toFixed(1)} ${units[index]}`;
  }
  return `${value.toFixed(2)} ${units[index]}`;
}

function formatSpeed(speedBps) {
  if (!Number.isFinite(speedBps) || speedBps <= 0) {
    return "";
  }
  return `${formatBytes(speedBps)}\/s`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  const rounded = Math.max(Math.round(seconds), 0);
  if (rounded < 60) {
    return `${rounded}s left`;
  }
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) {
    if (remainingSeconds < 5) {
      return `${minutes}m left`;
    }
    return `${minutes}m ${remainingSeconds}s left`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes < 5) {
    return `${hours}h left`;
  }
  return `${hours}h ${remainingMinutes}m left`;
}

function formatDownloadDescription(download) {
  if (!download) {
    return "";
  }
  const parts = [];
  const state = typeof download.state === "string" ? download.state.toLowerCase() : "";
  if (state === "in_progress") {
    parts.push(download.paused ? "Paused" : "In progress");
  } else if (state === "complete") {
    parts.push("Completed");
  } else if (state === "interrupted") {
    parts.push("Interrupted");
  } else if (state) {
    parts.push(toTitleCase(state.replace(/_/g, " ")));
  }

  const bytesReceived = Number.isFinite(download.bytesReceived) ? Math.max(download.bytesReceived, 0) : 0;
  const totalBytes = Number.isFinite(download.totalBytes) ? Math.max(download.totalBytes, 0) : 0;

  if (state === "complete" && totalBytes > 0) {
    parts.push(formatBytes(totalBytes));
  } else if (totalBytes > 0) {
    parts.push(`${formatBytes(bytesReceived)} of ${formatBytes(totalBytes)}`);
  } else if (bytesReceived > 0) {
    parts.push(formatBytes(bytesReceived));
  }

  if (state === "in_progress" && !download.paused) {
    const speedLabel = formatSpeed(download.speedBps || download.bytesPerSecond || 0);
    if (speedLabel) {
      parts.push(speedLabel);
    }
    const etaLabel = formatDuration(download.etaSeconds);
    if (etaLabel) {
      parts.push(etaLabel);
    }
  }

  return parts.filter(Boolean).join(" · ");
}

function mapItemToResult(item, score) {
  const result = {
    id: item.id,
    title: item.title,
    url: item.url,
    type: item.type,
    score,
    faviconUrl: item.faviconUrl || null,
    origin: item.origin || "",
    tabId: item.tabId,
  };

  if (item.type === "download") {
    const bytesReceived = Number.isFinite(item.bytesReceived) ? Math.max(item.bytesReceived, 0) : 0;
    const totalBytes = Number.isFinite(item.totalBytes) ? Math.max(item.totalBytes, 0) : 0;
    const progress = totalBytes > 0 ? Math.min(100, Math.max(0, (bytesReceived / totalBytes) * 100)) : item.state === "complete" ? 100 : null;
    const downloadDetails = {
      id: item.downloadId,
      state: item.state,
      paused: Boolean(item.paused),
      canResume: Boolean(item.canResume),
      bytesReceived,
      totalBytes,
      progress,
      speedBps: Number.isFinite(item.speedBps) ? Math.max(item.speedBps, 0) : Number.isFinite(item.bytesPerSecond) ? Math.max(item.bytesPerSecond, 0) : 0,
      etaSeconds: Number.isFinite(item.etaSeconds) ? Math.max(item.etaSeconds, 0) : null,
      startTime: item.startTime,
      endTime: item.endTime,
      estimatedEndTime: item.estimatedEndTime,
      filename: item.filename,
      filePath: item.filePath,
      completedAt: item.endTime,
      sourceHost: extractHostname(item.url),
    };
    result.download = downloadDetails;
    result.description = formatDownloadDescription(downloadDetails);
  } else {
    result.description = item.description || item.url || "";
  }

  return result;
}

function computeBaseScore(item) {
  return (BASE_TYPE_SCORES[item.type] || 0) + computeRecencyBoost(item) + computeDownloadBoost(item);
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

function computeNavigationOrigin(url) {
  if (!url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    return parsed.origin || "";
  } catch (err) {
    return "";
  }
}

function buildNavigationResults(filterType, query, navigationState) {
  if (!NAVIGATION_FILTERS.has(filterType)) {
    return [];
  }
  const state = navigationState || {};
  const tabId = typeof state.tabId === "number" ? state.tabId : null;
  const sourceList = filterType === "back" ? state.back || [] : state.forward || [];
  if (!sourceList.length) {
    return [];
  }
  const tokens = tokenize(query).map((token) => token.toLowerCase());
  const results = [];
  sourceList.forEach((entry, index) => {
    if (!entry || !entry.url) {
      return;
    }
    const delta = typeof entry.delta === "number"
      ? entry.delta
      : filterType === "back"
      ? -(index + 1)
      : index + 1;
    const normalizedDelta = Math.abs(delta);
    const baseScore = Math.max(0, NAVIGATION_BASE_SCORE - NAVIGATION_STEP_PENALTY * Math.min(normalizedDelta, 20));
    const title = entry.title || entry.url || "Untitled";
    if (tokens.length) {
      const haystack = `${title} ${entry.url}`.toLowerCase();
      let matches = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) {
          matches += 1;
        } else {
          matches -= 0.35;
        }
      }
      if (matches <= 0) {
        return;
      }
      results.push({
        id: `nav-${filterType}-${tabId ?? "tab"}-${index}`,
        title,
        url: entry.url,
        description: entry.url,
        type: "navigation",
        direction: filterType,
        navigationDelta: delta,
        score: baseScore + matches * 14,
        faviconUrl: entry.faviconUrl || null,
        origin: entry.origin || computeNavigationOrigin(entry.url),
        tabId,
        timeStamp: entry.timeStamp || Date.now(),
      });
      return;
    }
    results.push({
      id: `nav-${filterType}-${tabId ?? "tab"}-${index}`,
      title,
      url: entry.url,
      description: entry.url,
      type: "navigation",
      direction: filterType,
      navigationDelta: delta,
      score: baseScore,
      faviconUrl: entry.faviconUrl || null,
      origin: entry.origin || computeNavigationOrigin(entry.url),
      tabId,
      timeStamp: entry.timeStamp || Date.now(),
    });
  });

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.timeStamp && b.timeStamp && a.timeStamp !== b.timeStamp) {
      return b.timeStamp - a.timeStamp;
    }
    return (a.title || "").localeCompare(b.title || "");
  });

  return results.slice(0, MAX_NAVIGATION_RESULTS);
}

export function runSearch(query, data, options = {}) {
  const initial = (query || "").trim();
  const { filterType, remainder } = extractFilterPrefix(initial);
  const trimmed = remainder.trim();
  const { index, termBuckets, items, metadata = {} } = data;
  const tabCount = typeof metadata.tabCount === "number"
    ? metadata.tabCount
    : items.reduce((count, item) => (item.type === "tab" ? count + 1 : count), 0);

  const navigationState = options.navigation || null;

  if (NAVIGATION_FILTERS.has(filterType)) {
    const navigationResults = buildNavigationResults(filterType, trimmed, navigationState);
    return {
      results: navigationResults,
      ghost: null,
      answer: "",
      filter: filterType,
      subfilters: null,
    };
  }

  const tabs = items.filter((item) => item.type === "tab");
  const downloads = items.filter((item) => item.type === "download");
  const bookmarkItems = filterType === "bookmark" ? items.filter((item) => item.type === "bookmark") : [];
  const downloadItems = filterType === "download" ? downloads : [];
  const historyBoundaries = computeHistoryBoundaries(Date.now());
  const availableSubfilters = buildSubfilterOptions(filterType, {
    tabs,
    bookmarks: bookmarkItems,
    downloads: downloadItems,
  });
  const activeSubfilterId = sanitizeSubfilterSelection(filterType, options?.subfilter, availableSubfilters);
  const subfilterPayload =
    filterType && availableSubfilters.length
      ? { type: filterType, options: availableSubfilters, activeId: activeSubfilterId }
      : null;
  const subfilterContext = { historyBoundaries };
  const commandContext = { tabCount, tabs };
  const commandSuggestions = trimmed ? collectCommandSuggestions(trimmed, commandContext) : { results: [], ghost: null, answer: "" };

  if (!trimmed) {
    let defaultItems = filterType
      ? items.filter((item) => item.type === filterType)
      : items.filter((item) => item.type === "tab");

    defaultItems = defaultItems.filter((item) => matchesSubfilter(item, filterType, activeSubfilterId, subfilterContext));

    if (filterType === "download") {
      defaultItems.sort((a, b) => {
        const priorityDiff = computeDownloadStatePriority(a) - computeDownloadStatePriority(b);
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        const scoreA = computeBaseScore(a);
        const scoreB = computeBaseScore(b);
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        const timeA = a.endTime || a.lastUpdated || a.startTime || a.dateAdded || 0;
        const timeB = b.endTime || b.lastUpdated || b.startTime || b.dateAdded || 0;
        if (timeB !== timeA) {
          return timeB - timeA;
        }
        const titleCompare = (a.title || "").localeCompare(b.title || "");
        if (titleCompare) {
          return titleCompare;
        }
        return (b.id || 0) - (a.id || 0);
      });
    } else if (filterType === "tab" || !filterType) {
      defaultItems.sort((a, b) => {
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        const aTime = a.lastAccessed || 0;
        const bTime = b.lastAccessed || 0;
        return bTime - aTime;
      });
    } else if (filterType === "history") {
      defaultItems.sort((a, b) => {
        const aTime = typeof a.lastVisitTime === "number" ? a.lastVisitTime : 0;
        const bTime = typeof b.lastVisitTime === "number" ? b.lastVisitTime : 0;
        if (bTime !== aTime) return bTime - aTime;
        const aScore = (BASE_TYPE_SCORES[a.type] || 0) + computeRecencyBoost(a);
        const bScore = (BASE_TYPE_SCORES[b.type] || 0) + computeRecencyBoost(b);
        if (bScore !== aScore) return bScore - aScore;
        const aTitle = a.title || "";
        const bTitle = b.title || "";
        return aTitle.localeCompare(bTitle);
      });
    } else {
      defaultItems.sort((a, b) => {
        const aScore = computeBaseScore(a);
        const bScore = computeBaseScore(b);
        if (bScore !== aScore) return bScore - aScore;
        const aTitle = a.title || "";
        const bTitle = b.title || "";
        return aTitle.localeCompare(bTitle);
      });
    }
    const limit = getResultLimit(filterType);
    const limitedItems = sliceResultsForLimit(defaultItems, limit);
    return {
      results: defaultItems
        .slice(0, MAX_RESULTS)
        .map((item) => mapItemToResult(item, computeBaseScore(item))),
      results: limitedItems.map((item) => buildResultFromItem(item)).filter(Boolean),
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
    let finalScore = score + (BASE_TYPE_SCORES[item.type] || 0) + computeRecencyBoost(item) + computeDownloadBoost(item);
    if (shortQuery && item.type === "tab") {
      finalScore += TAB_BOOST_SHORT_QUERY;
    }
    results.push(mapItemToResult(item, finalScore));
    const mapped = buildResultFromItem(item, finalScore);
    if (mapped) {
      results.push(mapped);
    }
  }

  if (commandSuggestions.results.length) {
    results.push(...commandSuggestions.results);
  }

  results.sort(compareResults);

  const limit = getResultLimit(filterType);
  const finalResults = sliceResultsForLimit(results, limit);
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
