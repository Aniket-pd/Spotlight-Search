import { extractHostname } from "../common/urls.js";
import { BOOKMARK_ROOT_FOLDER_KEY } from "../indexing/indexer.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SUBFILTER_OPTIONS = 12;
const COMMON_SECOND_LEVEL_TLDS = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "go", "ne", "or"]);

function toStartOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function computeHistoryBoundaries(now = Date.now()) {
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
    const domain = extractHostname(tab?.url);
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

export function buildSubfilterOptions(filterType, { tabs = [], bookmarks = [] } = {}) {
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
  return [];
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

export function sanitizeSubfilterSelection(filterType, requested, options) {
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

export function matchesSubfilter(item, filterType, subfilterId, context) {
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

  return true;
}
