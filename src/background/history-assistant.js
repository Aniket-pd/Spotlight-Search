const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_ACTION_BATCH = 8;
const SUMMARY_LIMIT = 20;
const STORAGE_FLAG_KEY = "smartHistoryAssistantEnabled";

function toStartOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function resolveTimeRange(timeframe = {}) {
  const now = Date.now();
  const preset = typeof timeframe.preset === "string" ? timeframe.preset.toLowerCase() : "all";
  const customStart = typeof timeframe.start === "string" ? Date.parse(timeframe.start) : null;
  const customEnd = typeof timeframe.end === "string" ? Date.parse(timeframe.end) : null;
  const directStart = typeof timeframe.start === "number" && Number.isFinite(timeframe.start)
    ? timeframe.start
    : null;
  const directEnd = typeof timeframe.end === "number" && Number.isFinite(timeframe.end) ? timeframe.end : null;
  const resolvedStart = Number.isFinite(directStart) ? directStart : customStart;
  const resolvedEnd = Number.isFinite(directEnd) ? directEnd : customEnd;

  switch (preset) {
    case "today": {
      const start = toStartOfDay(now);
      return { start, end: null, label: "today" };
    }
    case "yesterday": {
      const startToday = toStartOfDay(now);
      const startYesterday = startToday - DAY_MS;
      return { start: startYesterday, end: startToday, label: "yesterday" };
    }
    case "last7days":
    case "last7": {
      const start = now - 7 * DAY_MS;
      return { start, end: null, label: "last 7 days" };
    }
    case "last30days":
    case "last30": {
      const start = now - 30 * DAY_MS;
      return { start, end: null, label: "last 30 days" };
    }
    case "past3days":
    case "last3days": {
      const start = now - 3 * DAY_MS;
      return { start, end: null, label: "past 3 days" };
    }
    case "past24hours":
    case "last24hours": {
      const start = now - 24 * 60 * 60 * 1000;
      return { start, end: null, label: "past 24 hours" };
    }
    case "custom": {
      const start = Number.isFinite(resolvedStart) ? resolvedStart : null;
      const end = Number.isFinite(resolvedEnd) ? resolvedEnd : null;
      if (start && end && end < start) {
        return { start: end, end: start, label: "custom" };
      }
      return { start: start || null, end: end || null, label: "custom" };
    }
    case "all":
    default:
      return { start: null, end: null, label: "all time" };
  }
}

function clampLimit(limit, fallback = DEFAULT_LIMIT, maximum = MAX_LIMIT) {
  if (!Number.isFinite(limit) || limit <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.floor(limit), maximum));
}

function extractHostname(url) {
  if (!url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (err) {
    return "";
  }
}

function normalizeDomains(domains) {
  if (!Array.isArray(domains)) {
    return [];
  }
  return domains
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter(Boolean);
}

function matchesDomain(hostname, domains) {
  if (!domains.length) {
    return true;
  }
  const lower = (hostname || "").toLowerCase();
  if (!lower) {
    return false;
  }
  return domains.some((domain) => lower === domain || lower.endsWith(`.${domain}`));
}

function sanitizeHistoryItem(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  return {
    url: typeof entry.url === "string" ? entry.url : "",
    title: typeof entry.title === "string" ? entry.title : "",
    lastVisitTime: Number.isFinite(entry.lastVisitTime) ? entry.lastVisitTime : null,
    visitCount: Number.isFinite(entry.visitCount) ? entry.visitCount : null,
    typedCount: Number.isFinite(entry.typedCount) ? entry.typedCount : null,
  };
}

async function fetchHistoryItems({ text, start, end, limit, domains }) {
  const maxResults = Math.min(400, Math.max(limit * 4, 80));
  const query = {
    text: typeof text === "string" ? text : "",
    maxResults,
  };
  if (Number.isFinite(start) && start > 0) {
    query.startTime = start;
  }

  let historyItems = [];
  try {
    historyItems = await chrome.history.search(query);
  } catch (err) {
    console.warn("Spotlight: history assistant search failed", err);
    return [];
  }

  const filtered = [];
  const domainList = normalizeDomains(domains);
  for (const item of historyItems) {
    if (!item || typeof item.url !== "string") {
      continue;
    }
    if (Number.isFinite(end) && item.lastVisitTime && item.lastVisitTime > end) {
      continue;
    }
    if (Number.isFinite(start) && item.lastVisitTime && item.lastVisitTime < start) {
      continue;
    }
    const hostname = extractHostname(item.url);
    if (!matchesDomain(hostname, domainList)) {
      continue;
    }
    const sanitized = sanitizeHistoryItem(item);
    if (sanitized) {
      filtered.push({ ...sanitized, hostname });
    }
    if (filtered.length >= limit) {
      break;
    }
  }

  filtered.sort((a, b) => {
    const aTime = Number.isFinite(a.lastVisitTime) ? a.lastVisitTime : 0;
    const bTime = Number.isFinite(b.lastVisitTime) ? b.lastVisitTime : 0;
    return bTime - aTime;
  });

  return filtered.slice(0, limit);
}

async function openHistoryItems(items) {
  let opened = 0;
  for (const item of items) {
    if (!item || typeof item.url !== "string") {
      continue;
    }
    try {
      await chrome.tabs.create({ url: item.url, active: false });
      opened += 1;
    } catch (err) {
      console.warn("Spotlight: failed to open history item", item.url, err);
    }
  }
  return opened;
}

async function deleteHistoryItems(items) {
  let deleted = 0;
  for (const item of items) {
    if (!item || typeof item.url !== "string") {
      continue;
    }
    try {
      await chrome.history.deleteUrl({ url: item.url });
      deleted += 1;
    } catch (err) {
      console.warn("Spotlight: failed to delete history item", item.url, err);
    }
  }
  return deleted;
}

async function isAssistantEnabled() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_FLAG_KEY);
    return Boolean(stored?.[STORAGE_FLAG_KEY]);
  } catch (err) {
    console.warn("Spotlight: unable to read history assistant flag", err);
    return false;
  }
}

export function createSmartHistoryAssistantService() {
  return {
    async handleRequest(message = {}) {
      const enabled = await isAssistantEnabled();
      if (!enabled) {
        return { success: false, error: "Smart History Assistant is disabled" };
      }

      const command = message.command || {};
      const action = typeof command.action === "string" ? command.action.toLowerCase() : "";
      if (!action) {
        return { success: false, error: "Missing assistant action" };
      }

      if (action === "meta") {
        const metaAnswer = typeof command.metaAnswer === "string" && command.metaAnswer.trim()
          ? command.metaAnswer.trim()
          : "I'm Spotlight's Smart History Assistant. I can search, reopen, summarize, or clean up your recent browsing history.";
        return {
          success: true,
          action: "meta",
          message: metaAnswer,
        };
      }

      const scope = typeof command.scope === "string" ? command.scope.toLowerCase() : "history";
      if (scope && scope !== "history") {
        return { success: false, error: "Only history scope is supported right now" };
      }

      const limit = clampLimit(command.limit);
      const timeRange = resolveTimeRange(command.timeframe || {});
      const items = await fetchHistoryItems({
        text: command.query,
        start: timeRange.start,
        end: timeRange.end,
        limit: action === "summarize" ? clampLimit(limit, DEFAULT_LIMIT, SUMMARY_LIMIT) : limit,
        domains: command.includeDomains,
      });

      if (!items.length) {
        return {
          success: false,
          action,
          message: "No matching history entries found.",
          resolvedTimeframe: timeRange,
        };
      }

      if (action === "show") {
        return {
          success: true,
          action: "show",
          items,
          resolvedTimeframe: timeRange,
        };
      }

      if (action === "open") {
        const subset = items.slice(0, Math.min(items.length, MAX_ACTION_BATCH));
        const openedCount = await openHistoryItems(subset);
        return {
          success: Boolean(openedCount),
          action: "open",
          openedCount,
          items: subset,
          resolvedTimeframe: timeRange,
          message: openedCount ? `Opened ${openedCount} item${openedCount === 1 ? "" : "s"}` : "Unable to open history entries.",
        };
      }

      if (action === "delete") {
        const subset = items.slice(0, Math.min(items.length, MAX_ACTION_BATCH));
        const deletedCount = await deleteHistoryItems(subset);
        return {
          success: Boolean(deletedCount),
          action: "delete",
          deletedCount,
          items: subset,
          resolvedTimeframe: timeRange,
          message: deletedCount
            ? `Deleted ${deletedCount} item${deletedCount === 1 ? "" : "s"} from history`
            : "Unable to delete history entries.",
        };
      }

      if (action === "summarize") {
        const subset = items.slice(0, Math.min(items.length, SUMMARY_LIMIT));
        return {
          success: true,
          action: "summarize",
          items: subset,
          resolvedTimeframe: timeRange,
        };
      }

      return { success: false, error: `Unsupported history assistant action: ${action}` };
    },
  };
}

