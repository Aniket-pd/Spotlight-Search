const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    action: { type: ["string", "null"], enum: ["show", "open", "delete", null] },
    topics: {
      type: "array",
      items: { type: "string" },
      default: [],
    },
    dateRange: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            start: { type: ["string", "null"] },
            end: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
      ],
      default: null,
    },
    maxItems: { type: ["number", "null"] },
    confidence: { type: "number" },
  },
  required: ["confidence"],
  additionalProperties: false,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_GAP_MS = 30 * 60 * 1000;
const MAX_HISTORY_RESULTS = 160;
const MAX_ITEMS_PER_SESSION = 12;
const MAX_LOG_ENTRIES = 25;
const PROMPT_HISTORY_SAMPLE_LIMIT = 60;
const PROMPT_HISTORY_ENTRY_MAX_LENGTH = 160;
const PROMPT_HISTORY_HOST_LIMIT = 12;
const TOPIC_STOP_WORDS = new Set([
  "a",
  "about",
  "again",
  "all",
  "an",
  "and",
  "any",
  "back",
  "delete",
  "find",
  "for",
  "from",
  "go",
  "goes",
  "history",
  "hour",
  "hours",
  "i",
  "in",
  "last",
  "me",
  "month",
  "months",
  "my",
  "need",
  "of",
  "open",
  "past",
  "please",
  "recent",
  "remove",
  "reopen",
  "resume",
  "search",
  "show",
  "tab",
  "tabs",
  "that",
  "the",
  "these",
  "this",
  "those",
  "to",
  "today",
  "view",
  "want",
  "week",
  "weeks",
  "yesterday",
]);

function extractKeywords(topics) {
  if (!Array.isArray(topics) || topics.length === 0) {
    return [];
  }
  const keywords = [];
  for (const topic of topics) {
    if (typeof topic !== "string") {
      continue;
    }
    const trimmed = topic.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed
      .toLowerCase()
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (part.length < 3 || TOPIC_STOP_WORDS.has(part)) {
        continue;
      }
      keywords.push(part);
    }
  }
  return Array.from(new Set(keywords));
}

function clampConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeTopics(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((topic) => (typeof topic === "string" ? topic.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeAction(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "show" || normalized === "open" || normalized === "delete") {
    return normalized;
  }
  return null;
}

function normalizeMaxItems(value) {
  const numeric =
    typeof value === "string" && value.trim()
      ? Number.parseFloat(value.trim())
      : value;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const rounded = Math.max(1, Math.floor(numeric));
  return Math.min(rounded, 50);
}

function toStartOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function parseIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parseDateBoundary(value, type, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const parsed = parseIsoTimestamp(trimmed);
    if (parsed === null) {
      return null;
    }
    return parsed;
  }
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number.parseInt(yearStr, 10);
  const monthIndex = Number.parseInt(monthStr, 10) - 1;
  const day = Number.parseInt(dayStr, 10);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
    return null;
  }
  const date = new Date(year, monthIndex, day);
  if (type === "end") {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date.getTime();
}

function detectPresetFromRange(startTime, endTime, now = Date.now()) {
  const todayStart = toStartOfDay(now);
  const todayEnd = todayStart + DAY_MS - 1;
  if (startTime <= 0 && endTime >= now) {
    return "any";
  }
  if (startTime === todayStart && endTime >= todayStart && endTime <= todayEnd) {
    return "today";
  }
  const yesterdayStart = todayStart - DAY_MS;
  const yesterdayEnd = todayStart - 1;
  if (startTime === yesterdayStart && endTime >= yesterdayStart && endTime <= yesterdayEnd) {
    return "yesterday";
  }
  if (startTime === todayStart - 6 * DAY_MS && endTime >= now - DAY_MS) {
    return "last7days";
  }
  if (startTime === todayStart - 29 * DAY_MS && endTime >= now - DAY_MS) {
    return "last30days";
  }
  return "custom";
}

function normalizeTimeRange(rawRange, now = Date.now()) {
  const defaultRange = { startTime: 0, endTime: now, preset: "any" };
  if (!rawRange || typeof rawRange !== "object") {
    return defaultRange;
  }
  const startCandidate = parseDateBoundary(rawRange.start, "start", now);
  const endCandidate = parseDateBoundary(rawRange.end, "end", now);
  let startTime = Number.isFinite(startCandidate) ? startCandidate : defaultRange.startTime;
  let endTime = Number.isFinite(endCandidate) ? endCandidate : defaultRange.endTime;
  if (!Number.isFinite(startTime) || startTime < 0) {
    startTime = 0;
  }
  if (!Number.isFinite(endTime) || endTime <= 0) {
    endTime = now;
  }
  if (startTime > endTime) {
    const temp = startTime;
    startTime = endTime;
    endTime = temp;
  }
  endTime = Math.min(endTime, now);
  const preset = detectPresetFromRange(startTime, endTime, now);
  return { startTime, endTime, preset };
}

function describeTimeRange(range, now = Date.now()) {
  if (!range) {
    return "all time";
  }
  const { preset, startTime, endTime } = range;
  if (preset && preset !== "custom" && preset !== "specific" && preset !== "any") {
    switch (preset) {
      case "today":
        return "today";
      case "yesterday":
        return "yesterday";
      case "last7days":
        return "the last 7 days";
      case "last30days":
        return "the last 30 days";
      case "thisWeek":
        return "this week";
      case "lastWeek":
        return "last week";
      case "thisMonth":
        return "this month";
      case "lastMonth":
        return "last month";
      default:
        break;
    }
  }
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return "all time";
  }
  if (startTime <= 0) {
    return "all time";
  }
  const startDate = new Date(startTime);
  const endDate = new Date(Math.min(endTime, now));
  const sameDay = startDate.toDateString() === endDate.toDateString();
  if (sameDay) {
    return startDate.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
    });
  }
  return `${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`;
}

function createOperationId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `history-op-${Date.now().toString(36)}-${random}`;
}

function createUndoToken() {
  const random = Math.random().toString(36).slice(2, 10);
  return `history-undo-${Date.now().toString(36)}-${random}`;
}

function groupHistorySessions(entries) {
  const sorted = entries
    .slice()
    .filter((entry) => entry && typeof entry.lastVisitTime === "number" && entry.url)
    .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
  const sessions = [];
  let current = null;
  for (const entry of sorted) {
    const visitTime = entry.lastVisitTime || 0;
    if (!current || current.items.length >= MAX_ITEMS_PER_SESSION) {
      current = {
        id: createOperationId(),
        startTime: visitTime,
        endTime: visitTime,
        items: [],
      };
      sessions.push(current);
    }
    const lastItem = current.items[current.items.length - 1];
    if (
      current.items.length &&
      lastItem &&
      typeof lastItem.lastVisitTime === "number" &&
      lastItem.lastVisitTime - visitTime > SESSION_GAP_MS
    ) {
      current = {
        id: createOperationId(),
        startTime: visitTime,
        endTime: visitTime,
        items: [],
      };
      sessions.push(current);
    }
    current.startTime = Math.min(current.startTime, visitTime);
    current.endTime = Math.max(current.endTime, visitTime);
    current.items.push({
      id: `${entry.id || entry.url}-${visitTime}`,
      title: entry.title || entry.url,
      url: entry.url,
      lastVisitTime: visitTime,
      timeLabel: new Date(visitTime).toLocaleString(),
      visitCount: entry.visitCount || 0,
    });
  }
  return sessions.map((session) => {
    const first = session.items[0];
    const label = first?.title || "History";
    return {
      id: session.id,
      label,
      startTime: session.startTime,
      endTime: session.endTime,
      items: session.items,
      timeRangeLabel: describeTimeRange({
        preset: "specific",
        startTime: session.startTime,
        endTime: session.endTime,
      }),
    };
  });
}

function filterEntriesByTopics(entries, topics) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return entries || [];
  }
  const uniqueKeywords = extractKeywords(topics);
  if (!uniqueKeywords.length) {
    return entries;
  }
  const filtered = entries.filter((entry) => {
    const title = (entry.title || "").toLowerCase();
    const url = (entry.url || "").toLowerCase();
    return uniqueKeywords.some((keyword) => title.includes(keyword) || url.includes(keyword));
  });
  return filtered.length ? filtered : entries;
}

function buildTopicLabel(topics) {
  if (!Array.isArray(topics) || topics.length === 0) {
    return "everything";
  }
  const uniqueKeywords = extractKeywords(topics);
  if (uniqueKeywords.length) {
    return uniqueKeywords.slice(0, 4).join(", ");
  }
  const fallback = topics
    .map((topic) => (typeof topic === "string" ? topic.trim() : ""))
    .filter(Boolean);
  return fallback.length ? fallback.join(", ") : "everything";
}

function buildAckMessage(action, interpretation, resultCount, timeLabel) {
  const topicLabel = buildTopicLabel(interpretation.topics);
  const rangeLabel = timeLabel || describeTimeRange(interpretation.timeRange);
  if (action === "search" || action === "show") {
    if (!resultCount) {
      return `I couldn't find history for ${topicLabel} in ${rangeLabel}.`;
    }
    const plural = resultCount === 1 ? "entry" : "entries";
    return `I found ${resultCount} ${plural} for ${topicLabel} in ${rangeLabel}.`;
  }
  if (action === "open") {
    if (!resultCount) {
      return `I couldn't find anything to reopen for ${topicLabel}.`;
    }
    const plural = resultCount === 1 ? "tab" : "tabs";
    return `Reopening ${resultCount} ${plural} from ${rangeLabel}.`;
  }
  if (action === "delete") {
    if (!resultCount) {
      return `I didn't find history to delete for ${topicLabel} in ${rangeLabel}.`;
    }
    const plural = resultCount === 1 ? "entry" : "entries";
    return `Ready to remove ${resultCount} ${plural} from ${rangeLabel}.`;
  }
  return "Let me know what you need with your history.";
}

function logAssistantAction(log, entry) {
  log.unshift(entry);
  if (log.length > MAX_LOG_ENTRIES) {
    log.length = MAX_LOG_ENTRIES;
  }
}

async function collectHistoryEntries(topics, range, options = {}) {
  const limit = Number.isFinite(options.maxItems) ? Math.max(1, Math.floor(options.maxItems)) : null;
  const keywords = extractKeywords(topics);
  const rawQuery = keywords.length ? keywords.join(" ") : topics.join(" ");
  const queryText = typeof rawQuery === "string" ? rawQuery.trim() : "";
  const hasStart = Number.isFinite(range.startTime) && range.startTime > 0;
  const hasEnd = Number.isFinite(range.endTime) && range.endTime > 0;

  async function runSearch(text, includeTimeBounds) {
    const desired = limit ? Math.min(MAX_HISTORY_RESULTS, Math.max(limit * 3, limit)) : MAX_HISTORY_RESULTS;
    const params = {
      text: typeof text === "string" ? text : "",
      maxResults: desired,
    };
    if (includeTimeBounds && hasStart) {
      params.startTime = range.startTime;
    }
    if (includeTimeBounds && hasEnd) {
      params.endTime = range.endTime;
    }
    try {
      return await chrome.history.search(params);
    } catch (err) {
      console.warn("Spotlight: history assistant search failed", err);
      return [];
    }
  }

  const attempts = [];
  if (queryText) {
    attempts.push(() => runSearch(queryText, true));
  }
  attempts.push(() => runSearch("", true));
  if (hasStart || hasEnd) {
    attempts.push(() => runSearch("", false));
  }

  let entries = [];
  for (const attempt of attempts) {
    entries = await attempt();
    if (Array.isArray(entries) && entries.length) {
      break;
    }
  }

  const filtered = filterEntriesByTopics(entries || [], topics);
  if (limit) {
    return filtered.slice(0, limit);
  }
  return filtered;
}

function sanitizeInterpretation(parsed, now = Date.now()) {
  const confidence = clampConfidence(parsed?.confidence);
  const action = normalizeAction(parsed?.action);
  const topics = normalizeTopics(parsed?.topics);
  const maxItems = normalizeMaxItems(parsed?.maxItems);
  const timeRange = normalizeTimeRange(parsed?.dateRange, now);
  return {
    confidence,
    action,
    topics,
    maxItems,
    timeRange,
  };
}

function formatTimezoneOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function formatLocalIso(date) {
  const offset = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - offset * 60 * 1000);
  const iso = adjusted.toISOString().replace("Z", "");
  const timezoneOffset = formatTimezoneOffset(date);
  return `${iso}${timezoneOffset}`;
}

function extractHostname(url) {
  if (typeof url !== "string" || !url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (error) {
    return "";
  }
}

function formatHistorySample(entries, hostCounts) {
  const entryObjects = entries.map((entry) => ({
    index: entry.index,
    title: entry.title,
    url: entry.url,
    host: entry.host,
    lastVisitIso: entry.lastVisitIso,
    visitCount: entry.visitCount,
  }));
  const topHosts = Array.from(hostCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, PROMPT_HISTORY_HOST_LIMIT)
    .map(([host, count]) => ({ host, visits: count }));
  return (
    `History entries JSON (most recent first):\n${JSON.stringify(entryObjects)}\n\n` +
    `Top domains by visit count: ${JSON.stringify(topHosts)}`
  );
}

async function buildPromptHistorySample(limit = PROMPT_HISTORY_SAMPLE_LIMIT) {
  if (!chrome?.history?.search) {
    return "History API unavailable.";
  }
  try {
    const results = await chrome.history.search({
      text: "",
      maxResults: limit,
      startTime: 0,
    });
    if (!Array.isArray(results) || results.length === 0) {
      return "No recent history entries available.";
    }
    const entries = [];
    const hostCounts = new Map();
    for (let index = 0; index < results.length; index += 1) {
      const entry = results[index];
      if (!entry) continue;
      const timestamp =
        typeof entry.lastVisitTime === "number"
          ? new Date(entry.lastVisitTime).toISOString()
          : "unknown";
      const title =
        typeof entry.title === "string" && entry.title.trim()
          ? entry.title.trim()
          : entry.url || "(untitled)";
      const safeTitle = title.replace(/\s+/g, " ").slice(0, PROMPT_HISTORY_ENTRY_MAX_LENGTH);
      const url = typeof entry.url === "string" ? entry.url : "";
      const host = extractHostname(url);
      if (host) {
        hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
      }
      entries.push({
        index: index + 1,
        title: safeTitle,
        url,
        host,
        lastVisitIso: timestamp,
        visitCount: typeof entry.visitCount === "number" ? entry.visitCount : 0,
      });
    }
    return formatHistorySample(entries, hostCounts);
  } catch (error) {
    console.warn("Spotlight history assistant failed to collect prompt sample", error);
    return "Failed to collect history sample.";
  }
}

function buildPrompt(query, historySample, now = new Date()) {
  const trimmed = typeof query === "string" ? query.trim() : "";
  const localIso = formatLocalIso(now);
  const historySection = historySample ? historySample : "No recent history entries available.";
  const inputPayload = JSON.stringify({ query: trimmed, now: localIso });
  return [
    "You are the Smart History Search interpreter for a Chrome extension similar to macOS Spotlight.",
    "### GOAL\nTurn a user's natural-language query about their browsing history into a **structured JSON command** that the extension can execute.",
    "---",
    "### INPUT FORMAT\nThe model receives this JSON input:\n{\n  \"query\": string,              // what the user typed\n  \"now\": ISO_8601_datetime      // current date-time, used for relative time phrases\n}",
    "---",
    "### REQUIRED OUTPUT FORMAT\nReturn ONLY one JSON object, with no explanations:\n{\n  \"action\": \"show\" | \"open\" | \"delete\",\n  \"topics\": string[],\n  \"dateRange\": {\n     \"start\": \"YYYY-MM-DD\",\n     \"end\": \"YYYY-MM-DD\"\n  },\n  \"maxItems\": number,\n  \"confidence\": 0–1\n}",
    "---",
    "### EXTRACTION RULES\n1. **Action detection**\n   - Words like “show”, “list”, “find” → \"show\"\n   - Words like “open”, “reopen” → \"open\"\n   - Words like “delete”, “clear”, “remove” → \"delete\"\n\n2. **Topic extraction**\n   - Collect keywords, brand names, or phrases.\n   - Do NOT include stop words.\n\n3. **Date range parsing**\n   - “today” → start = end = current date\n   - “yesterday” → start = now-1 day, end = now-1 day\n   - “last week” → start = now-7 days, end = now\n   - “last 3 days” → start = now-3 days, end = now\n   - “September 2024” → first and last day of that month\n\n4. **Quantity handling**\n   - If the query includes a number (“top 5”, “last 20”), set maxItems accordingly.\n\n5. **Output control**\n   - If query has no history-related intent, return { \"confidence\": 0 }.",
    "---",
    "### IMPLEMENTATION TIP\nAfter receiving this JSON from the Prompt API:\n\nPass topics and dateRange into chrome.history.search().\n\nFilter and display results grouped by date.\n\nHandle action: \"open\" or \"delete\" with chrome.tabs.create() or chrome.history.deleteUrl() respectively.",
    "OUTPUT REQUIREMENTS\nRespond only with valid JSON\nDo not include any extra text or explanations\nMust always include \"confidence\" key",
    `Recent history sample (most recent first):\n${historySection}`,
    `Input JSON:\n${inputPayload}`,
    "Return just the JSON command described above."
  ].join("\n\n");
}

function isPromptInputTooLargeError(error) {
  if (!error) {
    return false;
  }
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "OperationError") {
    const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
    if (message.includes("input") && message.includes("large")) {
      return true;
    }
  }
  const text = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return (
    text.includes("input is too large") ||
    text.includes("input too large") ||
    text.includes("prompt too large") ||
    text.includes("request too large")
  );
}

export function createHistoryAssistantService() {
  let sessionInstance = null;
  let sessionPromise = null;
  let lastUndoToken = null;
  let lastUndoEntries = null;
  const actionLog = [];
  const pendingDeletionOperations = new Map();

  async function ensureSession() {
    if (sessionInstance) {
      return sessionInstance;
    }
    if (sessionPromise) {
      return sessionPromise;
    }
    if (typeof globalThis.LanguageModel !== "object" && typeof globalThis.LanguageModel !== "function") {
      throw new Error("Prompt API unavailable");
    }
    const availability = await globalThis.LanguageModel.availability();
    if (availability === "unavailable") {
      throw new Error("Prompt model unavailable");
    }
    sessionPromise = globalThis.LanguageModel.create({
      monitor(monitor) {
        if (!monitor || typeof monitor.addEventListener !== "function") {
          return;
        }
        monitor.addEventListener("downloadprogress", (event) => {
          const percent = typeof event?.loaded === "number" ? Math.round(event.loaded * 100) : null;
          if (percent !== null) {
            console.info(`Spotlight history assistant model download ${percent}%`);
          }
        });
      },
    })
      .then((instance) => {
        sessionInstance = instance;
        sessionPromise = null;
        return instance;
      })
      .catch((error) => {
        sessionPromise = null;
        throw error;
      });
    return sessionPromise;
  }

  async function runPrompt(query) {
    const session = await ensureSession();
    const candidateLimits = [
      PROMPT_HISTORY_SAMPLE_LIMIT,
      Math.floor(PROMPT_HISTORY_SAMPLE_LIMIT / 2),
      20,
      10,
      5,
      0,
    ];
    const limits = [];
    for (const value of candidateLimits) {
      const normalized = Math.max(0, Math.floor(value));
      if (limits.length === 0) {
        limits.push(normalized);
        continue;
      }
      const previous = limits[limits.length - 1];
      if (normalized === 0 && previous !== 0) {
        limits.push(0);
      } else if (normalized > 0 && normalized < previous) {
        limits.push(normalized);
      }
    }
    if (limits.length === 0 || limits[limits.length - 1] !== 0) {
      limits.push(0);
    }
    let lastError = null;
    for (const limit of limits) {
      let historySample;
      if (limit > 0) {
        historySample = await buildPromptHistorySample(limit);
      } else {
        historySample = "History sample omitted to satisfy Prompt API input limits.";
      }
      const promptText = buildPrompt(query, historySample);
      try {
        const raw = await session.prompt(promptText, { responseConstraint: RESPONSE_SCHEMA });
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          throw new Error("History assistant returned invalid JSON");
        }
        return sanitizeInterpretation(parsed);
      } catch (error) {
        lastError = error;
        if (isPromptInputTooLargeError(error) && limit !== limits[limits.length - 1]) {
          console.warn(
            "Spotlight history assistant prompt exceeded input limits; retrying with smaller history sample",
            { limit, message: error?.message }
          );
          continue;
        }
        throw error;
      }
    }
    throw lastError || new Error("Prompt failed");
  }

  function buildBaseResponse() {
    return {
      success: true,
      action: "clarify",
      ack: "",
      followUpQuestion: "",
      sessions: [],
      pendingDeletion: null,
      operationId: null,
      undoToken: null,
      log: actionLog.slice(),
      maxItems: null,
      timeRange: null,
      topics: [],
    };
  }

  async function handleShow(interpretation) {
    const limit = interpretation.maxItems || 10;
    const entries = await collectHistoryEntries(interpretation.topics, interpretation.timeRange, { maxItems: limit });
    const sessions = groupHistorySessions(entries);
    const ack = buildAckMessage("show", interpretation, entries.length);
    logAssistantAction(actionLog, {
      timestamp: Date.now(),
      action: "show",
      summary: ack,
    });
    return {
      success: true,
      action: "show",
      ack,
      followUpQuestion: "",
      sessions,
      pendingDeletion: null,
      operationId: null,
      undoToken: null,
      log: actionLog.slice(),
      maxItems: limit,
    };
  }

  async function handleOpen(interpretation) {
    const limit = interpretation.maxItems || 10;
    const entries = await collectHistoryEntries(interpretation.topics, interpretation.timeRange, { maxItems: limit });
    const sessions = groupHistorySessions(entries);
    const topSession = sessions[0];
    const urlsToOpen = topSession ? topSession.items.map((item) => item.url).slice(0, Math.min(limit, 8)) : [];
    for (const url of urlsToOpen) {
      if (!url) continue;
      try {
        await chrome.tabs.create({ url });
      } catch (err) {
        console.warn("Spotlight: failed to open history tab", err);
      }
    }
    const ack = buildAckMessage("open", interpretation, urlsToOpen.length);
    logAssistantAction(actionLog, {
      timestamp: Date.now(),
      action: "open",
      summary: ack,
    });
    return {
      success: true,
      action: "open",
      ack,
      followUpQuestion: "",
      sessions,
      pendingDeletion: null,
      operationId: null,
      undoToken: null,
      log: actionLog.slice(),
      maxItems: limit,
    };
  }

  async function openUrls(urls) {
    const unique = Array.isArray(urls)
      ? Array.from(new Set(urls.filter((url) => typeof url === "string" && url)))
      : [];
    let opened = 0;
    for (const url of unique.slice(0, 12)) {
      try {
        await chrome.tabs.create({ url });
        opened += 1;
      } catch (err) {
        console.warn("Spotlight: failed to open history tab", err);
      }
    }
    const ack = opened
      ? `Opened ${opened} ${opened === 1 ? "tab" : "tabs"} from your history.`
      : "No history tabs opened.";
    logAssistantAction(actionLog, {
      timestamp: Date.now(),
      action: "open-manual",
      summary: ack,
    });
    return { opened, ack, log: actionLog.slice() };
  }

  async function handleDelete(interpretation) {
    const limit = interpretation.maxItems || 10;
    const entries = await collectHistoryEntries(interpretation.topics, interpretation.timeRange, { maxItems: limit });
    const sessions = groupHistorySessions(entries);
    const items = sessions.flatMap((session) =>
      session.items.map((item) => ({
        id: item.id,
        url: item.url,
        title: item.title,
        lastVisitTime: item.lastVisitTime,
        timeLabel: item.timeLabel,
        sessionId: session.id,
      }))
    );
    const ack = buildAckMessage("delete", interpretation, items.length);
    if (!items.length) {
      logAssistantAction(actionLog, {
        timestamp: Date.now(),
        action: "delete",
        summary: ack,
      });
      return {
        success: true,
        action: "delete",
        ack,
        followUpQuestion: "",
        sessions,
        pendingDeletion: null,
        operationId: null,
        undoToken: null,
        log: actionLog.slice(),
        maxItems: limit,
      };
    }
    const operationId = createOperationId();
    pendingDeletionOperations.set(operationId, {
      interpretation,
      items,
    });
    logAssistantAction(actionLog, {
      timestamp: Date.now(),
      action: "delete",
      summary: `${ack} (awaiting confirmation)`,
    });
    return {
      success: true,
      action: "delete",
      ack,
      followUpQuestion: "",
      sessions,
      pendingDeletion: {
        operationId,
        items,
      },
      operationId,
      undoToken: null,
      log: actionLog.slice(),
      maxItems: limit,
    };
  }

  async function confirmDeletion(operationId, itemIds) {
    if (!operationId || !pendingDeletionOperations.has(operationId)) {
      return {
        success: false,
        error: "Delete request expired",
      };
    }
    const operation = pendingDeletionOperations.get(operationId);
    pendingDeletionOperations.delete(operationId);
    const selectedItems = operation.items.filter((item) => itemIds.includes(item.id));
    if (!selectedItems.length) {
      return {
        success: false,
        error: "No history entries selected",
      };
    }
    const undoEntries = [];
    for (const item of selectedItems) {
      const startTime = Math.max(0, (item.lastVisitTime || Date.now()) - 60 * 1000);
      const endTime = (item.lastVisitTime || Date.now()) + 60 * 1000;
      try {
        await chrome.history.deleteRange({ startTime, endTime });
        undoEntries.push({ url: item.url });
      } catch (err) {
        console.warn("Spotlight: history deletion failed", err);
      }
    }
    if (undoEntries.length) {
      lastUndoToken = createUndoToken();
      lastUndoEntries = undoEntries;
    } else {
      lastUndoToken = null;
      lastUndoEntries = null;
    }
    const plural = selectedItems.length === 1 ? "entry" : "entries";
    const ack = `Removed ${selectedItems.length} history ${plural}.`;
    logAssistantAction(actionLog, {
      timestamp: Date.now(),
      action: "delete-confirmed",
      summary: ack,
    });
    return {
      success: true,
      ack,
      undoToken: lastUndoToken,
      log: actionLog.slice(),
    };
  }

  async function undoLastDeletion(token) {
    if (!token || token !== lastUndoToken || !Array.isArray(lastUndoEntries) || !lastUndoEntries.length) {
      return {
        success: false,
        error: "Nothing to undo",
      };
    }
    for (const entry of lastUndoEntries) {
      if (!entry || !entry.url) continue;
      try {
        await chrome.history.addUrl({ url: entry.url });
      } catch (err) {
        console.warn("Spotlight: history undo failed", err);
      }
    }
    const count = lastUndoEntries.length;
    const plural = count === 1 ? "item" : "items";
    const ack = `Re-added ${count} ${plural} to history.`;
    logAssistantAction(actionLog, {
      timestamp: Date.now(),
      action: "undo",
      summary: ack,
    });
    lastUndoToken = null;
    lastUndoEntries = null;
    return {
      success: true,
      ack,
      log: actionLog.slice(),
    };
  }

  async function handleQuery(query) {
    const interpretation = await runPrompt(query);
    const response = buildBaseResponse();
    response.timeRange = interpretation.timeRange;
    response.topics = interpretation.topics;
    response.maxItems = interpretation.maxItems || null;
    if (!interpretation.action || interpretation.confidence < 0.35) {
      response.action = "clarify";
      response.followUpQuestion = "I didn't catch a history request. Could you rephrase it?";
      response.ack = response.followUpQuestion;
      return response;
    }
    switch (interpretation.action) {
      case "show":
        return handleShow(interpretation);
      case "open":
        return handleOpen(interpretation);
      case "delete":
        return handleDelete(interpretation);
      default:
        response.action = "clarify";
        response.followUpQuestion = "Could you clarify what part of your history you need?";
        response.ack = response.followUpQuestion;
        return response;
    }
  }

  function getLog() {
    return actionLog.slice();
  }

  return {
    handleQuery,
    confirmDeletion,
    undoLastDeletion,
    getLog,
    openUrls,
  };
}

