import { isHistoryAssistantEnabled } from "../shared/feature-flags.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;
const MAX_OPEN_LIMIT = 10;
const SUMMARY_FETCH_LIMIT = 60;
const RECENTLY_CLOSED_LIMIT = 10;

function clampLimit(limit, fallback, ceiling = MAX_LIMIT) {
  const base = Number.isFinite(limit) ? Number(limit) : fallback;
  if (!Number.isFinite(base) || base <= 0) {
    return Math.min(ceiling, fallback);
  }
  return Math.min(Math.max(1, Math.floor(base)), ceiling);
}

function normalizeDomains(domains) {
  if (!Array.isArray(domains)) {
    return [];
  }
  return domains
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter(Boolean);
}

function normalizeUrls(urls) {
  if (!Array.isArray(urls)) {
    return [];
  }
  const unique = new Set();
  urls.forEach((entry) => {
    if (typeof entry === "string" && entry.trim()) {
      unique.add(entry.trim());
    }
  });
  return Array.from(unique);
}

function extractHost(url) {
  if (typeof url !== "string" || !url) {
    return "";
  }
  try {
    const host = new URL(url).hostname || "";
    return host.toLowerCase();
  } catch (error) {
    return "";
  }
}

function matchesDomain(host, domain) {
  if (!host || !domain) {
    return false;
  }
  return host === domain || host.endsWith(`.${domain}`);
}

function toStartOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function resolveTimeRange(filters = {}, now = Date.now()) {
  const range = typeof filters.timeRange === "string" ? filters.timeRange : "auto";
  const customStart = Number.isFinite(filters.startTime) ? Number(filters.startTime) : null;
  const customEnd = Number.isFinite(filters.endTime) ? Number(filters.endTime) : null;

  if (range === "custom" && customStart !== null && customEnd !== null) {
    const start = Math.min(customStart, customEnd);
    const end = Math.max(customStart, customEnd);
    return { startTime: Math.max(0, start), endTime: end };
  }

  const startOfToday = toStartOfDay(now);
  if (range === "today") {
    return { startTime: startOfToday, endTime: now };
  }
  if (range === "yesterday") {
    return { startTime: startOfToday - DAY_MS, endTime: startOfToday };
  }
  if (range === "last_3_days") {
    return { startTime: now - DAY_MS * 3, endTime: now };
  }
  if (range === "last_7_days") {
    return { startTime: now - DAY_MS * 7, endTime: now };
  }
  if (range === "last_30_days") {
    return { startTime: now - DAY_MS * 30, endTime: now };
  }
  if (range === "last_90_days") {
    return { startTime: now - DAY_MS * 90, endTime: now };
  }
  if (range === "all") {
    return { startTime: 0, endTime: now };
  }

  if (customStart !== null || customEnd !== null) {
    const start = customStart !== null ? customStart : 0;
    const end = customEnd !== null ? customEnd : now;
    return { startTime: Math.max(0, Math.min(start, end)), endTime: Math.max(start, end) };
  }

  return { startTime: now - DAY_MS * 30, endTime: now };
}

function sortHistoryItems(items, sortOrder = "recent") {
  if (!Array.isArray(items)) {
    return [];
  }
  const sorted = items.slice();
  if (sortOrder === "frequent") {
    sorted.sort((a, b) => {
      const aCount = Number.isFinite(a?.visitCount) ? a.visitCount : 0;
      const bCount = Number.isFinite(b?.visitCount) ? b.visitCount : 0;
      if (bCount === aCount) {
        const aTime = Number.isFinite(a?.lastVisitTime) ? a.lastVisitTime : 0;
        const bTime = Number.isFinite(b?.lastVisitTime) ? b.lastVisitTime : 0;
        return bTime - aTime;
      }
      return bCount - aCount;
    });
    return sorted;
  }
  if (sortOrder === "earliest") {
    sorted.sort((a, b) => {
      const aTime = Number.isFinite(a?.lastVisitTime) ? a.lastVisitTime : 0;
      const bTime = Number.isFinite(b?.lastVisitTime) ? b.lastVisitTime : 0;
      return aTime - bTime;
    });
    return sorted;
  }
  sorted.sort((a, b) => {
    const aTime = Number.isFinite(a?.lastVisitTime) ? a.lastVisitTime : 0;
    const bTime = Number.isFinite(b?.lastVisitTime) ? b.lastVisitTime : 0;
    return bTime - aTime;
  });
  return sorted;
}

function formatHistoryItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  return {
    id: item.id || null,
    url: typeof item.url === "string" ? item.url : "",
    title: typeof item.title === "string" ? item.title : "",
    lastVisitTime: Number.isFinite(item.lastVisitTime) ? item.lastVisitTime : null,
    visitCount: Number.isFinite(item.visitCount) ? item.visitCount : null,
  };
}

async function lookupHistoryItem(url) {
  if (!url || typeof chrome?.history?.search !== "function") {
    return null;
  }
  try {
    const results = await chrome.history.search({ text: url, maxResults: 5 });
    const match = Array.isArray(results) ? results.find((entry) => entry && entry.url === url) : null;
    return formatHistoryItem(match || { url });
  } catch (error) {
    console.warn("Spotlight: history lookup failed", error);
    return formatHistoryItem({ url });
  }
}

async function queryHistory(filters = {}, options = {}) {
  const { startTime, endTime } = resolveTimeRange(filters);
  const limit = clampLimit(filters.limit, options.fallbackLimit || DEFAULT_LIMIT, options.ceiling);
  const searchText = typeof filters.query === "string" ? filters.query.trim() : "";
  const domains = normalizeDomains(filters.domains);
  const urlContains = typeof filters.urlContains === "string" ? filters.urlContains.trim().toLowerCase() : "";
  const requestedUrls = normalizeUrls(filters.urls);

  if (requestedUrls.length) {
    const items = await Promise.all(requestedUrls.map((url) => lookupHistoryItem(url)));
    return items.filter(Boolean).slice(0, limit);
  }

  if (typeof chrome?.history?.search !== "function") {
    return [];
  }

  const maxResults = Math.min(limit * 6, 400);
  let results = [];
  try {
    results = await chrome.history.search({
      text: searchText,
      startTime,
      endTime,
      maxResults,
    });
  } catch (error) {
    console.warn("Spotlight: history query failed", error);
    return [];
  }

  const filtered = results.filter((item) => {
    if (!item || typeof item.url !== "string") {
      return false;
    }
    const url = item.url.toLowerCase();
    if (urlContains && !url.includes(urlContains)) {
      return false;
    }
    if (domains.length) {
      const host = extractHost(item.url);
      if (!domains.some((domain) => matchesDomain(host, domain))) {
        return false;
      }
    }
    return true;
  });

  const sorted = sortHistoryItems(filtered, filters.sort);
  return sorted.slice(0, limit).map(formatHistoryItem).filter(Boolean);
}

async function deleteHistoryEntries(filters, items) {
  const urls = normalizeUrls(filters.urls);
  const targets = urls.length ? urls : items.map((item) => item.url).filter(Boolean);
  if (!targets.length || !chrome?.history) {
    return 0;
  }
  const results = await Promise.allSettled(
    targets.map((url) => {
      try {
        return chrome.history.deleteUrl({ url });
      } catch (error) {
        return Promise.reject(error);
      }
    })
  );
  return results.filter((entry) => entry.status === "fulfilled").length;
}

async function openHistoryEntries(items, disposition = "new_tab") {
  if (!Array.isArray(items) || !items.length) {
    return { opened: 0 };
  }
  const urls = items.map((item) => item?.url).filter(Boolean);
  if (!urls.length) {
    return { opened: 0 };
  }
  const limited = urls.slice(0, MAX_OPEN_LIMIT);
  if (!chrome?.tabs) {
    return { opened: 0 };
  }

  const results = [];
  if (disposition === "current_tab") {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && typeof activeTab.id === "number") {
        await chrome.tabs.update(activeTab.id, { url: limited[0], active: true });
        results.push({ status: "fulfilled" });
        const remaining = limited.slice(1);
        const created = await Promise.allSettled(
          remaining.map((url) => chrome.tabs.create({ url, active: disposition !== "background" }))
        );
        results.push(...created);
        return { opened: results.filter((entry) => entry.status === "fulfilled").length };
      }
    } catch (error) {
      console.warn("Spotlight: failed to reuse active tab", error);
    }
  }

  const created = await Promise.allSettled(
    limited.map((url, index) =>
      chrome.tabs.create({ url, active: disposition !== "background" || index === 0 })
    )
  );
  return { opened: created.filter((entry) => entry.status === "fulfilled").length };
}

function filterSessionsByCriteria(entries, filters) {
  const domains = normalizeDomains(filters.domains);
  const urlContains = typeof filters.urlContains === "string" ? filters.urlContains.trim().toLowerCase() : "";
  const query = typeof filters.query === "string" ? filters.query.trim().toLowerCase() : "";
  return entries.filter((entry) => {
    if (!entry || !entry.tab || typeof entry.tab.url !== "string") {
      return false;
    }
    const url = entry.tab.url.toLowerCase();
    if (urlContains && !url.includes(urlContains)) {
      return false;
    }
    if (query) {
      const title = typeof entry.tab.title === "string" ? entry.tab.title.toLowerCase() : "";
      if (!url.includes(query) && !title.includes(query)) {
        return false;
      }
    }
    if (domains.length) {
      const host = extractHost(entry.tab.url);
      if (!domains.some((domain) => matchesDomain(host, domain))) {
        return false;
      }
    }
    return true;
  });
}

async function restoreClosedSessions(filters = {}) {
  if (!chrome?.sessions || typeof chrome.sessions.getRecentlyClosed !== "function") {
    return { opened: 0, items: [] };
  }
  const limit = clampLimit(filters.limit, RECENTLY_CLOSED_LIMIT, RECENTLY_CLOSED_LIMIT);
  let entries = [];
  try {
    entries = await chrome.sessions.getRecentlyClosed({ maxResults: limit * 5 });
  } catch (error) {
    console.warn("Spotlight: unable to fetch recently closed sessions", error);
    return { opened: 0, items: [] };
  }
  const filtered = filterSessionsByCriteria(entries, filters).slice(0, limit);
  let opened = 0;
  for (const entry of filtered) {
    if (!entry || !entry.tab) {
      continue;
    }
    try {
      await chrome.sessions.restore(entry.tab.sessionId || entry.sessionId);
      opened += 1;
    } catch (error) {
      console.warn("Spotlight: failed to restore session", error);
    }
  }
  const items = filtered.map((entry) =>
    formatHistoryItem({
      url: entry.tab?.url || "",
      title: entry.tab?.title || "",
      lastVisitTime: entry.lastModified || entry.tab?.lastAccessed || null,
      visitCount: null,
    })
  );
  return { opened, items };
}

export function createHistoryAssistantService() {
  async function ensureEnabled() {
    try {
      return await isHistoryAssistantEnabled();
    } catch (error) {
      console.warn("Spotlight: failed to resolve history assistant flag", error);
      return false;
    }
  }

  async function handleShow(command) {
    const items = await queryHistory(command.filters || {}, { fallbackLimit: DEFAULT_LIMIT });
    const message = items.length
      ? `Showing ${items.length} entr${items.length === 1 ? "y" : "ies"}.`
      : "No history matched your request.";
    return { success: true, items, message };
  }

  async function handleSummarize(command) {
    const items = await queryHistory(command.filters || {}, {
      fallbackLimit: SUMMARY_FETCH_LIMIT,
      ceiling: SUMMARY_FETCH_LIMIT,
    });
    return {
      success: true,
      items,
      message: items.length ? `Gathered ${items.length} entr${items.length === 1 ? "y" : "ies"} for summarization.` : "",
    };
  }

  async function handleDelete(command) {
    const items = await queryHistory(command.filters || {}, { fallbackLimit: MAX_LIMIT });
    const deleted = await deleteHistoryEntries(command.filters || {}, items);
    return {
      success: true,
      deleted,
      items,
      message: deleted
        ? `Deleted ${deleted} entr${deleted === 1 ? "y" : "ies"}.`
        : "No matching history entries were deleted.",
    };
  }

  async function handleOpen(command) {
    const source = typeof command?.open?.source === "string" ? command.open.source : "history";
    if (source === "sessions") {
      const { opened, items } = await restoreClosedSessions(command.filters || {});
      const message = opened
        ? `Restored ${opened} tab${opened === 1 ? "" : "s"} from recently closed.`
        : "No recently closed tabs matched your request.";
      return { success: true, opened, items, message };
    }
    const items = await queryHistory(command.filters || {}, {
      fallbackLimit: Math.min(command.filters?.limit || DEFAULT_LIMIT, MAX_OPEN_LIMIT),
      ceiling: MAX_OPEN_LIMIT,
    });
    const { opened } = await openHistoryEntries(items, command?.open?.disposition || "new_tab");
    const message = opened
      ? `Opened ${opened} histor${opened === 1 ? "y entry" : "y entries"}.`
      : "No history entries were opened.";
    return { success: true, opened, items, message };
  }

  return {
    async handleCommand(command = {}, context = {}) {
      if (!command || typeof command.action !== "string") {
        return { success: false, error: "Invalid assistant command" };
      }
      const enabled = await ensureEnabled();
      if (!enabled) {
        return { success: false, error: "History assistant is disabled" };
      }
      const action = command.action.toLowerCase();
      try {
        if (action === "show") {
          return await handleShow(command, context);
        }
        if (action === "summarize") {
          return await handleSummarize(command, context);
        }
        if (action === "delete") {
          return await handleDelete(command, context);
        }
        if (action === "open") {
          return await handleOpen(command, context);
        }
        if (action === "meta") {
          return { success: true, items: [], message: command.assistantResponse || "" };
        }
      } catch (error) {
        console.error("Spotlight: history assistant command failed", error);
        return { success: false, error: error?.message || "Assistant command failed" };
      }
      return { success: false, error: `Unsupported assistant action: ${action}` };
    },
  };
}
