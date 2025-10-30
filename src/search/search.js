import { tokenize, BOOKMARK_ROOT_FOLDER_KEY } from "./indexer.js";
import "../shared/web-search.js";

function getWebSearchApi() {
  const api = typeof globalThis !== "undefined" ? globalThis.SpotlightWebSearch : null;
  if (!api || typeof api !== "object") {
    return null;
  }
  return api;
}

function resolveRequestedSearchEngine(webSearchOptions) {
  const api = getWebSearchApi();
  if (!api) {
    return { engine: null, engineId: null };
  }
  const requestedId =
    webSearchOptions && typeof webSearchOptions.engineId === "string"
      ? webSearchOptions.engineId
      : null;
  if (requestedId) {
    const requested = api.findSearchEngine(requestedId);
    if (requested) {
      return { engine: requested, engineId: requested.id };
    }
  }
  const fallback = api.getDefaultSearchEngine ? api.getDefaultSearchEngine() : null;
  return {
    engine: fallback || null,
    engineId: fallback ? fallback.id : null,
  };
}

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
  topSite: 5,
};

const MATCHED_TOKEN_BONUS = 4.5;
const FULL_TOKEN_MATCH_BONUS = 5.5;
const MISSING_TOKEN_PENALTY = 6;

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

function isMeaningfulLocalResult(result, minMatchedTokens, totalTokens) {
  if (!result) {
    return false;
  }
  if (result.type === "webSearch") {
    return false;
  }
  if (result.score === COMMAND_SCORE || result.type === "command") {
    return true;
  }
  if (result.type === "navigation") {
    return true;
  }
  if (typeof result.score !== "number" || !Number.isFinite(result.score)) {
    return true;
  }
  const matchedTokens = typeof result.matchedTokens === "number" ? result.matchedTokens : 0;
  if (totalTokens > 0 && matchedTokens >= totalTokens) {
    return true;
  }
  if (minMatchedTokens <= 0) {
    return result.score > 0;
  }
  return result.score > 0 && matchedTokens >= minMatchedTokens;
}

const COMMAND_ICON_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzYzNzlmZiIvPjxwYXRoIGQ9Ik0xMCAxNmgxMiIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjxwYXRoIGQ9Ik0xNiAxMHYxMiIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvc3ZnPg==";

const AUDIO_KEYWORDS = ["audio", "sound", "music", "noisy", "noise"];
const CLOSE_COMMAND_KEYWORDS = ["close", "remove", "delete", "shut", "kill"];

const FILTER_ALIASES = {
  tab: ["tab:", "tabs:", "t:", "summarize:"],
  bookmark: ["bookmark:", "bookmarks:", "bm:", "b:"],
  history: ["history:", "hist:", "h:"],
  download: ["download:", "downloads:", "dl:", "d:"],
  command: ["command:", "commands:", "cmd:"],
  back: ["back:"],
  forward: ["forward:"],
  topSite: ["topsites:", "topsite:", "top-sites:", "ts:"],
};

const NAVIGATION_FILTERS = new Set(["back", "forward"]);
const MAX_NAVIGATION_RESULTS = 12;
const NAVIGATION_BASE_SCORE = 120;
const NAVIGATION_STEP_PENALTY = 6;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SUBFILTER_OPTIONS = 12;
const COMMON_SECOND_LEVEL_TLDS = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "go", "ne", "or"]);
const DOWNLOAD_STATE_PRIORITY = {
  complete: 0,
  in_progress: 1,
  interrupted: 2,
  paused: 3,
  cancelled: 4,
  unknown: 5,
};

function normalizeDownloadState(state) {
  if (typeof state !== "string") {
    return "unknown";
  }
  const normalized = state.toLowerCase();
  if (normalized in DOWNLOAD_STATE_PRIORITY) {
    return normalized;
  }
  return normalized.replace(/[^a-z0-9]+/g, "_") || "unknown";
}

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

function formatDownloadStateLabel(state) {
  const normalized = normalizeDownloadState(state);
  switch (normalized) {
    case "complete":
      return "Completed";
    case "in_progress":
      return "In Progress";
    case "interrupted":
      return "Interrupted";
    case "paused":
      return "Paused";
    case "cancelled":
      return "Canceled";
    default:
      return toTitleCase(normalized.replace(/_/g, " ")) || "Other";
  }
}

function buildDownloadSubfilters(downloads) {
  const counts = new Map();
  for (const download of downloads || []) {
    const state = normalizeDownloadState(download?.state);
    counts.set(state, (counts.get(state) || 0) + 1);
  }

  const options = [{ id: "all", label: "All Downloads" }];
  const states = ["complete", "in_progress", "interrupted", "paused", "cancelled"];
  for (const state of states) {
    const count = counts.get(state) || 0;
    if (!count) {
      continue;
    }
    options.push({
      id: `state:${state}`,
      label: formatDownloadStateLabel(state),
      count,
    });
  }

  const remainingStates = Array.from(counts.keys()).filter((state) => !states.includes(state));
  for (const state of remainingStates) {
    const count = counts.get(state) || 0;
    if (!count) {
      continue;
    }
    options.push({
      id: `state:${state}`,
      label: formatDownloadStateLabel(state),
      count,
    });
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
    const target = normalizeDownloadState(subfilterId.slice("state:".length));
    if (!target || target === "all") {
      return true;
    }
    const itemState = normalizeDownloadState(item?.state);
    return itemState === target;
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
  {
    id: "command:tab-close-audio",
    title: "Close tabs playing audio",
    aliases: [
      "close audio tabs",
      "close tabs playing audio",
      "close noisy tabs",
      "close active audio tabs",
      "close tabs with audio",
    ],
    action: "tab-close-audio",
    answer(context) {
      const count = context?.audibleTabCount || 0;
      if (count <= 0) {
        return "No tabs are currently playing audio.";
      }
      return count === 1
        ? "Closes the tab that is playing audio."
        : `Closes ${count} tabs that are playing audio.`;
    },
    description(context) {
      const count = context?.audibleTabCount || 0;
      const countLabel = formatTabCount(count);
      return `${countLabel} · Playing audio`;
    },
    isAvailable(context) {
      return (context?.audibleTabCount || 0) > 0;
    },
  },
  {
    id: "command:bookmark-organize",
    title: "Organize bookmarks with AI",
    aliases: [
      "organize bookmarks",
      "bookmark organizer",
      "smart bookmark organizer",
      "ai bookmark cleanup",
      "bookmark cleanup",
    ],
    action: "bookmark-organize",
    answer(context) {
      const count = context?.bookmarkCount || 0;
      if (count <= 0) {
        return "No bookmarks available to organize.";
      }
      const countLabel = formatBookmarkCount(count);
      return `Analyzes ${countLabel} to suggest folders, tags, and duplicates.`;
    },
    description(context) {
      const count = context?.bookmarkCount || 0;
      const countLabel = formatBookmarkCount(count || 0);
      return `${countLabel} · AI organization`;
    },
    isAvailable(context) {
      return (context?.bookmarkCount || 0) > 0;
    },
  },
];

function buildStaticCommandResult(command, context) {
  if (!command || typeof command !== "object") {
    return null;
  }
  if (typeof command.isAvailable === "function" && !command.isAvailable(context)) {
    return null;
  }
  const answer = typeof command.answer === "function" ? command.answer(context) : "";
  const description =
    typeof command.description === "function"
      ? command.description(context)
      : answer;
  return {
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

function formatTabCount(count) {
  if (count === 1) {
    return "1 tab";
  }
  return `${count} tabs`;
}

function formatBookmarkCount(count) {
  if (count === 1) {
    return "1 bookmark";
  }
  if (!Number.isFinite(count) || count <= 0) {
    return "0 bookmarks";
  }
  return `${count} bookmarks`;
}

function buildCloseAudioTabsCommandResult(audibleCount) {
  const countLabel = formatTabCount(audibleCount);
  const title = audibleCount === 1
    ? "Close tab playing audio"
    : `Close ${countLabel} playing audio`;
  const description = `${countLabel} · Playing audio`;
  return {
    id: "command:close-tabs-audio",
    title,
    url: description,
    description,
    type: "command",
    command: "tab-close-audio",
    args: {},
    label: "Command",
    score: COMMAND_SCORE,
    faviconUrl: COMMAND_ICON_DATA_URL,
  };
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

function resolveDownloadTimestampValue(item) {
  if (!item || typeof item !== "object") {
    return 0;
  }
  const candidates = [item.endTime, item.completedAt, item.createdAt, item.startTime];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return 0;
}

function compareDownloadItems(a, b) {
  const aPriority = DOWNLOAD_STATE_PRIORITY[normalizeDownloadState(a?.state)] ?? DOWNLOAD_STATE_PRIORITY.unknown;
  const bPriority = DOWNLOAD_STATE_PRIORITY[normalizeDownloadState(b?.state)] ?? DOWNLOAD_STATE_PRIORITY.unknown;
  if (aPriority !== bPriority) {
    return aPriority - bPriority;
  }
  const aTime = resolveDownloadTimestampValue(a);
  const bTime = resolveDownloadTimestampValue(b);
  if (bTime !== aTime) {
    return bTime - aTime;
  }
  const aTitle = (a && a.title) || "";
  const bTitle = (b && b.title) || "";
  return aTitle.localeCompare(bTitle);
}

function sortTopSiteItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .slice()
    .sort((a, b) => {
      const aVisits = typeof a?.visitCount === "number" ? a.visitCount : 0;
      const bVisits = typeof b?.visitCount === "number" ? b.visitCount : 0;
      if (bVisits !== aVisits) {
        return bVisits - aVisits;
      }
      const aTitle = (a && a.title) || "";
      const bTitle = (b && b.title) || "";
      if (aTitle && bTitle) {
        const diff = aTitle.localeCompare(bTitle);
        if (diff !== 0) {
          return diff;
        }
      }
      const aUrl = (a && a.url) || "";
      const bUrl = (b && b.url) || "";
      return aUrl.localeCompare(bUrl);
    });
}

function computeTopSiteScore(item, rank = 0) {
  const visits = typeof item?.visitCount === "number" && Number.isFinite(item.visitCount) ? item.visitCount : 0;
  const visitBoost = Math.log1p(Math.max(visits, 0)) * 2.2;
  const rankPenalty = Math.max(rank, 0) * 0.05;
  return (BASE_TYPE_SCORES.topSite || 0) + visitBoost - rankPenalty;
}

function interleaveTopSiteResults(primaryResults, topSiteResults, limit) {
  const normalizedLimit = Number.isFinite(limit)
    ? limit
    : (Array.isArray(primaryResults) ? primaryResults.length : 0) + (Array.isArray(topSiteResults) ? topSiteResults.length : 0);

  const baseList = Array.isArray(primaryResults) ? primaryResults.slice() : [];
  const topList = Array.isArray(topSiteResults) ? topSiteResults.slice() : [];

  if (!normalizedLimit) {
    return [];
  }

  if (!topList.length) {
    return baseList.slice(0, normalizedLimit);
  }

  if (!baseList.length) {
    return topList.slice(0, normalizedLimit);
  }

  const allowedTopSites = Math.min(topList.length, Math.max(1, Math.round(normalizedLimit / 3)));
  const nonTopSlots = Math.max(normalizedLimit - allowedTopSites, 0);
  const interval = allowedTopSites ? Math.max(1, Math.round(nonTopSlots / allowedTopSites)) : nonTopSlots || 1;

  const merged = [];
  let primaryIndex = 0;
  let topIndex = 0;
  let insertedTop = 0;

  while (merged.length < normalizedLimit && (primaryIndex < baseList.length || insertedTop < allowedTopSites)) {
    let remainingPrimaryToTake = interval;
    while (remainingPrimaryToTake > 0 && merged.length < normalizedLimit && primaryIndex < baseList.length) {
      merged.push(baseList[primaryIndex++]);
      remainingPrimaryToTake -= 1;
    }

    if (merged.length >= normalizedLimit) {
      break;
    }

    if (insertedTop < allowedTopSites && topIndex < topList.length) {
      merged.push(topList[topIndex++]);
      insertedTop += 1;
    }
  }

  while (merged.length < normalizedLimit && primaryIndex < baseList.length) {
    merged.push(baseList[primaryIndex++]);
  }

  while (merged.length < normalizedLimit && insertedTop < allowedTopSites && topIndex < topList.length) {
    merged.push(topList[topIndex++]);
    insertedTop += 1;
  }

  return merged.slice(0, normalizedLimit);
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
  if (typeof item.description === "string" && item.description) {
    result.description = item.description;
  }
  if (item.iconHint) {
    result.iconHint = item.iconHint;
  }
  if (typeof item.visitCount === "number" && Number.isFinite(item.visitCount)) {
    result.visitCount = item.visitCount;
  }
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
  if (item.type === "download") {
    const normalizedState = normalizeDownloadState(item.state);
    result.state = normalizedState;
    result.downloadId = item.downloadId;
    result.fileUrl = item.fileUrl || null;
    result.filename = item.filename || "";
    result.displayPath = item.displayPath || "";
    if (!result.description) {
      result.description = item.displayPath || item.filename || item.url || "";
    }
    result.iconHint = result.iconHint || "download";
    if (typeof item.endTime === "number" && Number.isFinite(item.endTime) && item.endTime > 0) {
      result.completedAt = item.endTime;
    }
    if (typeof item.startTime === "number" && Number.isFinite(item.startTime) && item.startTime > 0) {
      result.startTime = item.startTime;
    }
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

function applyMatches(entry, multiplier, scores, token, tokenMatches) {
  if (!entry) {
    return;
  }
  for (const [itemId, weight] of entry.entries()) {
    scores.set(itemId, (scores.get(itemId) || 0) + weight * multiplier);
    if (!token || !tokenMatches) {
      continue;
    }
    let matched = tokenMatches.get(itemId);
    if (!matched) {
      matched = new Set();
      tokenMatches.set(itemId, matched);
    }
    matched.add(token);
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

  if (a?.type === "download" && b?.type === "download") {
    const aPriority = DOWNLOAD_STATE_PRIORITY[a.state] ?? DOWNLOAD_STATE_PRIORITY.unknown;
    const bPriority = DOWNLOAD_STATE_PRIORITY[b.state] ?? DOWNLOAD_STATE_PRIORITY.unknown;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    const aTime = typeof a.completedAt === "number" ? a.completedAt : typeof a.createdAt === "number" ? a.createdAt : 0;
    const bTime = typeof b.completedAt === "number" ? b.completedAt : typeof b.createdAt === "number" ? b.createdAt : 0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }
  }

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

function hasAudioCommandIntent(text = "", words = []) {
  const normalizedText = normalizeCommandToken(text);
  if (
    normalizedText &&
    AUDIO_KEYWORDS.some((keyword) => normalizedText.includes(keyword))
  ) {
    return true;
  }
  for (const word of words || []) {
    const normalizedWord = normalizeCommandToken(word);
    if (
      normalizedWord &&
      AUDIO_KEYWORDS.some((keyword) => normalizedWord.includes(keyword))
    ) {
      return true;
    }
  }
  return false;
}

function hasCloseCommandIntent(text = "", words = []) {
  const normalizedText = normalizeCommandToken(text);
  if (
    normalizedText &&
    CLOSE_COMMAND_KEYWORDS.some((keyword) => normalizedText.startsWith(keyword))
  ) {
    return true;
  }
  for (const word of words || []) {
    const normalizedWord = normalizeCommandToken(word);
    if (
      normalizedWord &&
      CLOSE_COMMAND_KEYWORDS.some((keyword) => normalizedWord.startsWith(keyword))
    ) {
      return true;
    }
  }
  return false;
}

function findBestStaticCommand(query, context) {
  const compactQuery = normalizeCommandToken(query);
  if (!compactQuery) {
    return null;
  }

  for (const command of STATIC_COMMANDS) {
    const payload = buildStaticCommandResult(command, context);
    if (!payload) {
      continue;
    }
    const phrases = [command.title, ...(command.aliases || [])];
    const matched = phrases.some((phrase) => normalizeCommandToken(phrase).startsWith(compactQuery));
    if (!matched) {
      continue;
    }
    return {
      ghostText: command.title,
      answer: payload.answer,
      result: payload.result,
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

function findMatchingTabsByQuery(tabs, query, limit = 6) {
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

  const cap = Number.isFinite(limit) ? Math.max(1, limit) : 6;
  return scored.slice(0, cap).map((entry) => entry.tab);
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
    normalizeWord(query).startsWith("close") ||
    hasCloseCommandIntent(query, query.split(/\s+/));

  if (!looksLikeClose) {
    return { results: [], ghost: null, answer: "" };
  }

  const remainder = query.slice((query.match(/^\s*\S+/)?.[0] || "").length).trim();
  const remainderWords = remainder.split(/\s+/).filter(Boolean);
  const audibleCount = typeof context?.audibleTabCount === "number"
    ? context.audibleTabCount
    : tabs.reduce((count, tab) => (tab.audible ? count + 1 : count), 0);

  if (hasAudioCommandIntent(remainder, remainderWords)) {
    if (!audibleCount) {
      return {
        results: [],
        ghost: null,
        answer: "No tabs are currently playing audio.",
      };
    }
    const result = buildCloseAudioTabsCommandResult(audibleCount);
    return {
      results: [result],
      ghost: result.title,
      answer:
        audibleCount === 1
          ? "Closes the tab that is playing audio."
          : `Closes ${audibleCount} tabs that are playing audio.`,
    };
  }

  const firstRemainder = normalizeWord(remainderWords[0]);

  const looksLikeAll =
    matchToken(firstRemainder, "all") ||
    normalizeCommandToken(query).startsWith("closeall");
  if (looksLikeAll) {
    return collectCloseAllSuggestions(remainderWords.slice(1), context);
  }

  const matchingTabs = findMatchingTabsByQuery(tabs, remainder, 6);
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

function buildCloseAllTabsCommandPayload(context) {
  const tabs = Array.isArray(context?.tabs) ? context.tabs : [];
  if (!tabs.length) {
    return null;
  }
  const activeTab = tabs.find((tab) => tab && tab.active);
  const windowId = typeof activeTab?.windowId === "number" ? activeTab.windowId : null;
  const windowTabs = windowId === null ? tabs : tabs.filter((tab) => tab.windowId === windowId);
  const totalInWindow = windowTabs.length;
  if (totalInWindow <= 0) {
    return null;
  }
  const closingCount = Math.max(totalInWindow - 1, 0);
  const countLabel = formatTabCount(totalInWindow);
  const title = "Close all tabs";
  const description = `${countLabel} in window · Active tab stays open`;
  const answer =
    closingCount === 0
      ? "Only the active tab is open in this window."
      : `Closes ${closingCount} other ${closingCount === 1 ? "tab" : "tabs"} in this window.`;
  return {
    answer,
    result: {
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
  };
}

function buildFocusCommandDescription(tabLike) {
  const domain = getTabDomain(tabLike);
  const windowLabel = formatWindowLabel(tabLike);
  const descriptionParts = [];
  if (domain) {
    descriptionParts.push(domain);
  }
  if (windowLabel) {
    descriptionParts.push(windowLabel);
  }
  const joined = descriptionParts.join(" · ");
  if (joined) {
    return joined;
  }
  if (tabLike && typeof tabLike.url === "string") {
    return tabLike.url;
  }
  return "";
}

function buildFocusTabCommandResult(tab) {
  if (!tab) {
    return null;
  }
  const tabId =
    typeof tab.tabId === "number"
      ? tab.tabId
      : typeof tab.id === "number"
      ? tab.id
      : null;
  if (tabId === null) {
    return null;
  }
  const description = buildFocusCommandDescription(tab);
  return {
    id: `command:focus-tab:${tabId}`,
    title: `Focus “${tab.title || tab.url || "Untitled"}”`,
    url: description,
    description,
    type: "command",
    command: "tab-focus",
    args: { tabId },
    label: "Command",
    score: COMMAND_SCORE,
    faviconUrl: COMMAND_ICON_DATA_URL,
  };
}

function buildFocusJumpCommandResult(focusedTab, options = {}) {
  if (!focusedTab || typeof focusedTab.tabId !== "number") {
    return null;
  }
  const { shortcut = false } = options;
  const titleText = focusedTab.title || focusedTab.url || "Focused tab";
  const description = buildFocusCommandDescription(focusedTab);
  return {
    id: shortcut ? "command:focus-jump-shortcut" : "command:focus-jump",
    title: shortcut ? `⭐ Focused Tab · ${titleText}` : `Jump to Focused tab “${titleText}”`,
    url: description,
    description: description || focusedTab.url || "",
    type: "command",
    command: "tab-focus-jump",
    label: "Command",
    score: COMMAND_SCORE,
    faviconUrl: COMMAND_ICON_DATA_URL,
  };
}

function buildFocusRemoveCommandResult(focusedTab) {
  if (!focusedTab || typeof focusedTab.tabId !== "number") {
    return null;
  }
  const titleText = focusedTab.title || focusedTab.url || "Focused tab";
  const description = buildFocusCommandDescription(focusedTab);
  return {
    id: "command:focus-unfocus",
    title: "Remove Focus highlight",
    url: description,
    description: `Restore “${titleText}” to its normal state`,
    type: "command",
    command: "tab-unfocus",
    label: "Command",
    score: COMMAND_SCORE,
    faviconUrl: COMMAND_ICON_DATA_URL,
  };
}

function collectFocusCommandSuggestions(query, context) {
  const trimmed = (query || "").trim();
  if (!trimmed) {
    return { results: [], ghost: null, answer: "" };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return { results: [], ghost: null, answer: "" };
  }

  const lower = trimmed.toLowerCase();
  const focusedTab = context?.focusedTab || null;
  const tabs = Array.isArray(context?.tabs) ? context.tabs : [];
  const activeTab = tabs.find((tab) => tab.active);
  const firstWord = tokens[0]?.toLowerCase() || "";
  const wantsUnfocus = firstWord.startsWith("unfocus") || lower.startsWith("remove focus");
  const wantsFocus = firstWord.startsWith("focus") || lower.startsWith("focus on");
  const wantsJump = lower.startsWith("jump to focus") || (lower.includes("jump") && lower.includes("focus"));

  const results = [];
  const seenIds = new Set();
  let ghost = null;
  let answer = "";

  const pushResult = (result) => {
    if (!result || !result.id || seenIds.has(result.id)) {
      return;
    }
    seenIds.add(result.id);
    results.push(result);
  };

  if (wantsUnfocus) {
    if (focusedTab) {
      const result = buildFocusRemoveCommandResult(focusedTab);
      pushResult(result);
      ghost = ghost || "Unfocus tab";
      answer = answer || "Removes the Focus highlight and restores the tab.";
    } else {
      answer = answer || "No tab is currently focused.";
    }
    return { results, ghost, answer };
  }

  if (wantsJump && focusedTab) {
    pushResult(buildFocusJumpCommandResult(focusedTab));
    ghost = ghost || "Jump to focused tab";
    answer = answer || "Instantly switches to the focused tab.";
    if (!wantsFocus) {
      return { results, ghost, answer };
    }
  }

  if (!wantsFocus) {
    return { results, ghost, answer };
  }

  const remainder = trimmed.slice(tokens[0].length).trim();
  const remainderLower = remainder.toLowerCase();

  if (!remainder || remainderLower === "tab" || remainderLower === "the tab") {
    if (focusedTab) {
      pushResult(buildFocusJumpCommandResult(focusedTab));
      ghost = ghost || "Jump to focused tab";
      answer = answer || "Instantly switches to the focused tab.";
    }
    if (activeTab && (!focusedTab || activeTab.tabId !== focusedTab.tabId)) {
      const focusResult = buildFocusTabCommandResult(activeTab);
      pushResult(focusResult);
      if (focusResult && !ghost) {
        ghost = focusResult.title;
      }
      answer = answer || "Pins and highlights the current tab so it stands out.";
    }
    return { results, ghost, answer };
  }

  const normalizedRemainder = remainderLower.replace(/^(this|the|that|my)\s+/, "").trim();
  if (normalizedRemainder === "tab" || normalizedRemainder === "current tab") {
    if (activeTab) {
      const focusResult = buildFocusTabCommandResult(activeTab);
      pushResult(focusResult);
      if (focusResult && !ghost) {
        ghost = focusResult.title;
      }
      answer = answer || "Pins and highlights the current tab so it stands out.";
    }
    return { results, ghost, answer };
  }

  const matches = findMatchingTabsByQuery(tabs, remainder, 5);
  if (matches.length) {
    matches.forEach((tab) => {
      const result = buildFocusTabCommandResult(tab);
      pushResult(result);
    });
    if (!ghost && results.length) {
      ghost = results[0]?.title || null;
    }
    answer = answer || "Marks the chosen tab as your Focus tab.";
    return { results, ghost, answer };
  }

  if (focusedTab) {
    pushResult(buildFocusJumpCommandResult(focusedTab));
    ghost = ghost || "Jump to focused tab";
    answer = answer || "Instantly switches back to your focused tab.";
  }

  return { results, ghost, answer };
}

function prependFocusShortcut(results, focusInfo, limit) {
  const list = Array.isArray(results) ? results.slice() : [];
  if (!focusInfo || typeof focusInfo.tabId !== "number") {
    return list;
  }
  const shortcut = buildFocusJumpCommandResult(focusInfo, { shortcut: true });
  if (!shortcut) {
    return list;
  }
  if (list.some((item) => item && item.id === shortcut.id)) {
    return list;
  }
  list.unshift(shortcut);
  if (Number.isFinite(limit) && list.length > limit) {
    return list.slice(0, limit);
  }
  return list;
}

function collectCloseAllSuggestions(words, context) {
  const tabs = context.tabs || [];
  const rest = words || [];
  let remainingWords = rest.slice();
  const audibleCount = typeof context?.audibleTabCount === "number"
    ? context.audibleTabCount
    : tabs.reduce((count, tab) => (tab.audible ? count + 1 : count), 0);

  if (remainingWords.length) {
    const first = normalizeWord(remainingWords[0]);
    if (matchToken(first, "tabs")) {
      remainingWords = remainingWords.slice(1);
    }
  }

  const audioIntent =
    hasAudioCommandIntent(remainingWords.join(" "), remainingWords) ||
    hasAudioCommandIntent(rest.join(" "), rest);
  if (audioIntent) {
    if (!audibleCount) {
      return {
        results: [],
        ghost: null,
        answer: "No tabs are currently playing audio.",
      };
    }
    const result = buildCloseAudioTabsCommandResult(audibleCount);
    return {
      results: [result],
      ghost: result.title,
      answer:
        audibleCount === 1
          ? "Closes the tab that is playing audio."
          : `Closes ${audibleCount} tabs that are playing audio.`,
    };
  }

  const domainQuery = remainingWords.join(" ").trim();
  if (!domainQuery) {
    const payload = buildCloseAllTabsCommandPayload(context);
    if (!payload) {
      return { results: [], ghost: null, answer: "" };
    }
    return {
      results: [payload.result],
      ghost: payload.result.title,
      answer: payload.answer,
    };
  }

  const sanitizedDomainQuery = sanitizeDomainQueryForClose(domainQuery);
  const domainMatches = collectDomainMatches(
    tabs,
    sanitizedDomainQuery || domainQuery
  );
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

function sanitizeDomainQueryForClose(query = "") {
  return query
    .replace(/\b(tabs?|tab|all|the|from|of|on|in|my|this|these|those)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function collectCommandSuggestions(query, context, options = {}) {
  const suggestions = [];
  const seenIds = new Set();
  let ghost = null;
  let answer = "";
  const { collectAll = false } = options || {};

  const pushSuggestion = (result) => {
    if (!result || !result.id || seenIds.has(result.id)) {
      return;
    }
    seenIds.add(result.id);
    suggestions.push({ ...result, commandRank: suggestions.length });
  };

  if (collectAll) {
    for (const command of STATIC_COMMANDS) {
      const payload = buildStaticCommandResult(command, context);
      if (!payload) {
        continue;
      }
      pushSuggestion(payload.result);
    }

    const tabs = Array.isArray(context?.tabs) ? context.tabs : [];
    const focusedTab = context?.focusedTab || null;
    const activeTab = tabs.find((tab) => tab && tab.active);

    if (focusedTab) {
      pushSuggestion(buildFocusJumpCommandResult(focusedTab));
      pushSuggestion(buildFocusRemoveCommandResult(focusedTab));
    }

    if (activeTab) {
      pushSuggestion(buildFocusTabCommandResult(activeTab));
      const closeActive = buildCloseTabResult(activeTab);
      if (closeActive) {
        pushSuggestion(closeActive);
      }
    }

    const closeAllPayload = buildCloseAllTabsCommandPayload(context);
    if (closeAllPayload) {
      pushSuggestion(closeAllPayload.result);
    }

    if (!ghost && suggestions.length) {
      ghost = suggestions[0]?.title || null;
    }

    return { results: suggestions, ghost, answer };
  }

  const trimmed = (query || "").trim();
  if (!trimmed) {
    return { results: [], ghost: null, answer: "" };
  }

  const staticMatch = findBestStaticCommand(trimmed, context);
  if (staticMatch) {
    pushSuggestion(staticMatch.result);
    ghost = ghost || staticMatch.ghostText;
    answer = answer || staticMatch.answer;
  }

  const focusSuggestions = collectFocusCommandSuggestions(trimmed, context);
  if (focusSuggestions.results.length) {
    focusSuggestions.results.forEach((result) => pushSuggestion(result));
    if (!ghost && focusSuggestions.ghost) {
      ghost = focusSuggestions.ghost;
    }
    if (!answer && focusSuggestions.answer) {
      answer = focusSuggestions.answer;
    }
  }

  const closeSuggestions = collectTabCloseSuggestions(trimmed, context);
  if (closeSuggestions.results.length) {
    closeSuggestions.results.forEach((result) => pushSuggestion(result));
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
  const bookmarkCount = typeof metadata.bookmarkCount === "number"
    ? metadata.bookmarkCount
    : items.reduce((count, item) => (item.type === "bookmark" ? count + 1 : count), 0);
  const focusedTabInfo = metadata && typeof metadata.focusedTab === "object" ? metadata.focusedTab : null;

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
  const bookmarkItems = filterType === "bookmark" ? items.filter((item) => item.type === "bookmark") : [];
  const downloadItems = filterType === "download" ? items.filter((item) => item.type === "download") : [];
  const topSiteItems = items.filter((item) => item.type === "topSite");
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
  const audibleTabCount = tabs.reduce((count, tab) => (tab.audible ? count + 1 : count), 0);
  const commandContext = { tabCount, tabs, audibleTabCount, bookmarkCount, focusedTab: focusedTabInfo };

  if (filterType === "command") {
    const commandSuggestions = collectCommandSuggestions(trimmed, commandContext, {
      collectAll: !trimmed,
    });
    const limit = getResultLimit(filterType);
    return {
      results: sliceResultsForLimit(commandSuggestions.results, limit),
      ghost: commandSuggestions.ghost ? { text: commandSuggestions.ghost } : null,
      answer: commandSuggestions.answer || "",
      filter: filterType,
      subfilters: null,
    };
  }

  const commandSuggestions = trimmed
    ? collectCommandSuggestions(trimmed, commandContext)
    : { results: [], ghost: null, answer: "" };

  if (!trimmed) {
    let defaultItems = filterType
      ? filterType === "download"
        ? downloadItems.slice()
        : items.filter((item) => item.type === filterType)
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
    } else if (filterType === "download") {
      defaultItems.sort((a, b) => compareDownloadItems(a, b));
    } else if (filterType === "topSite") {
      defaultItems = sortTopSiteItems(defaultItems);
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

    const limit = getResultLimit(filterType);

    if (filterType === "topSite") {
      const limitedItems = sliceResultsForLimit(defaultItems, limit);
      return {
        results: limitedItems
          .map((item, index) => buildResultFromItem(item, computeTopSiteScore(item, index)))
          .filter(Boolean),
        ghost: null,
        answer: "",
        filter: filterType,
        subfilters: subfilterPayload,
      };
    }

    if (!filterType) {
      const sortedTopSites = sortTopSiteItems(topSiteItems);
      const topSiteCap = sortedTopSites.length
        ? Math.min(sortedTopSites.length, Math.max(1, Math.round(limit / 3)))
        : 0;
      const topSiteSelection = sortedTopSites.slice(0, topSiteCap);
      const baseLimit = Number.isFinite(limit) ? limit + topSiteSelection.length : defaultItems.length;
      const baseResults = defaultItems
        .slice(0, baseLimit)
        .map((item) => buildResultFromItem(item))
        .filter(Boolean);
      const topSiteResults = topSiteSelection
        .map((item, index) => buildResultFromItem(item, computeTopSiteScore(item, index)))
        .filter(Boolean);
      const merged = interleaveTopSiteResults(baseResults, topSiteResults, limit);
      return {
        results: prependFocusShortcut(merged, focusedTabInfo, limit),
        ghost: null,
        answer: "",
        filter: filterType,
        subfilters: subfilterPayload,
      };
    }

    const limitedItems = sliceResultsForLimit(defaultItems, limit);
    const baseList = limitedItems.map((item) => buildResultFromItem(item)).filter(Boolean);
    const withShortcut = filterType === "tab" ? prependFocusShortcut(baseList, focusedTabInfo, limit) : baseList;
    return {
      results: withShortcut,
      ghost: null,
      answer: "",
      filter: filterType,
      subfilters: subfilterPayload,
    };
  }

  const tokens = tokenize(trimmed);
  const uniqueTokens = Array.from(new Set(tokens));
  const totalTokens = uniqueTokens.length;
  if (tokens.length === 0) {
    return { results: [], ghost: null, answer: "", filter: filterType };
  }

  const scores = new Map();
  const tokenMatches = new Map();

  for (const token of tokens) {
    const exactEntry = index.get(token);
    if (exactEntry) {
      applyMatches(exactEntry, EXACT_BOOST, scores, token, tokenMatches);
    }

    const candidates = collectCandidateTerms(token, termBuckets);
    for (const term of candidates) {
      if (!term) continue;
      const entry = index.get(term);
      if (!entry) continue;

      if (term.startsWith(token) && term !== token) {
        applyMatches(entry, PREFIX_BOOST, scores, token, tokenMatches);
      } else if (isFuzzyMatch(term, token) && term !== token) {
        applyMatches(entry, FUZZY_BOOST, scores, token, tokenMatches);
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
    let matchedCount = 0;
    if (totalTokens > 0) {
      const matchedSet = tokenMatches.get(itemId);
      matchedCount = matchedSet ? Math.min(matchedSet.size, totalTokens) : 0;
      if (matchedCount > 0) {
        finalScore += matchedCount * MATCHED_TOKEN_BONUS;
        if (matchedCount === totalTokens) {
          finalScore += FULL_TOKEN_MATCH_BONUS;
        } else {
          const missingCount = totalTokens - matchedCount;
          finalScore -= missingCount * MISSING_TOKEN_PENALTY;
        }
      } else {
        finalScore -= totalTokens * MISSING_TOKEN_PENALTY;
      }
    }
    if (shortQuery && item.type === "tab") {
      finalScore += TAB_BOOST_SHORT_QUERY;
    }
    if (item.type === "download") {
      const state = normalizeDownloadState(item.state);
      if (state === "complete") {
        finalScore += 0.6;
      } else if (state === "in_progress") {
        finalScore -= 0.4;
      } else if (state === "interrupted" || state === "cancelled") {
        finalScore -= 0.7;
      }
    }
    const mapped = buildResultFromItem(item, finalScore);
    if (mapped) {
      if (totalTokens > 0) {
        mapped.matchedTokens = matchedCount;
      }
      results.push(mapped);
    }
  }

  if (commandSuggestions.results.length) {
    results.push(...commandSuggestions.results);
  }

  results.sort(compareResults);

  const limit = getResultLimit(filterType);
  let finalResults = sliceResultsForLimit(results, limit);
  const minRequiredMatches = totalTokens >= 3 ? 2 : totalTokens >= 1 ? 1 : 0;
  const hasMeaningfulLocalResults = finalResults.some((result) =>
    isMeaningfulLocalResult(result, minRequiredMatches, totalTokens)
  );
  const { engine: requestedEngine } = resolveRequestedSearchEngine(options?.webSearch);
  let activeWebSearchEngine = requestedEngine;
  const webSearchApi = getWebSearchApi();
  let fallbackResult = null;

  const shouldOfferFallback =
    trimmed &&
    webSearchApi &&
    typeof webSearchApi.createWebSearchResult === "function" &&
    (!finalResults.length || !hasMeaningfulLocalResults);

  if (shouldOfferFallback) {
    const desiredEngineId = activeWebSearchEngine ? activeWebSearchEngine.id : null;
    fallbackResult = webSearchApi.createWebSearchResult(trimmed, { engineId: desiredEngineId });
    if (fallbackResult) {
      finalResults = [fallbackResult];
      if (webSearchApi.findSearchEngine && fallbackResult.engineId) {
        const resolvedEngine = webSearchApi.findSearchEngine(fallbackResult.engineId);
        if (resolvedEngine) {
          activeWebSearchEngine = resolvedEngine;
        }
      }
    }
  }

  const topResult = finalResults[0] || null;
  const hasCommand = finalResults.some((result) => result?.score === COMMAND_SCORE);
  let ghostPayload = null;
  let answer = "";

  if (fallbackResult) {
    const engineName = fallbackResult.engineName || activeWebSearchEngine?.name || "the web";
    answer = `Search with ${engineName}`;
  } else {
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
  }

  const webSearchInfo = activeWebSearchEngine
    ? {
        engineId: activeWebSearchEngine.id,
        engineName: activeWebSearchEngine.name,
        engineDomain: activeWebSearchEngine.domain || "",
        query: trimmed,
        fallback: Boolean(fallbackResult),
      }
    : null;

  return {
    results: finalResults,
    ghost: ghostPayload,
    answer,
    filter: filterType,
    subfilters: subfilterPayload,
    webSearch: webSearchInfo,
  };
}
