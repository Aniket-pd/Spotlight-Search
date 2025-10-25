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
const MAX_AUTO_OPEN_TABS = 8;
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

const ACTION_KEYWORDS = {
  show: ["show", "list", "find", "search", "display", "look", "fetch"],
  open: ["open", "reopen", "resume", "launch", "restore", "start"],
  delete: ["delete", "remove", "clear", "erase", "cleanup", "trash", "forget", "wipe", "purge"],
};

const TIME_KEYWORD_PATTERNS = [
  { pattern: /\btoday\b/i, label: "today" },
  { pattern: /\byesterday\b/i, label: "yesterday" },
  { pattern: /\bthis\s+week\b/i, label: "this week" },
  { pattern: /\blast\s+week\b/i, label: "last week" },
  { pattern: /\bthis\s+month\b/i, label: "this month" },
  { pattern: /\blast\s+month\b/i, label: "last month" },
  { pattern: /\blast\s+24\s+hours\b/i, label: "last 24 hours" },
  { pattern: /\bpast\s+24\s+hours\b/i, label: "last 24 hours" },
  { pattern: /\blast\s+7\s+days\b/i, label: "last 7 days" },
  { pattern: /\bpast\s+7\s+days\b/i, label: "last 7 days" },
  { pattern: /\blast\s+30\s+days\b/i, label: "last 30 days" },
  { pattern: /\bpast\s+30\s+days\b/i, label: "last 30 days" },
];

const HELP_QUERY_PATTERNS = [
  /\bhow\s+can\s+you\s+help\b/i,
  /\bhow\s+do\s+you\s+help\b/i,
  /\bwhat\s+can\s+you\s+do\b/i,
  /\bwhat\s+do\s+you\s+do\b/i,
  /\bwhat\s+can\s+this\s+do\b/i,
  /\bhelp\s+me\b/i,
  /^help\b/i,
  /\btell\s+me\s+what\s+you\s+do\b/i,
];

const HELP_SOFT_SIGNAL_TOKENS = new Set(["how", "can", "what", "you", "me", "this", "do", "able"]);

function normalizeKeywordList(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  const normalized = [];
  for (const value of list) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    normalized.push(trimmed.toLowerCase());
  }
  return Array.from(new Set(normalized));
}

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
      if (part.length < 2 || TOPIC_STOP_WORDS.has(part)) {
        continue;
      }
      keywords.push(part);
    }
  }
  return Array.from(new Set(keywords));
}

function extractQueryKeywords(query) {
  if (typeof query !== "string" || !query.trim()) {
    return [];
  }
  const keywords = [];
  const tokens = query
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z0-9.]+|[^A-Za-z0-9.]+$/g, ""))
    .filter(Boolean);
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (TOPIC_STOP_WORDS.has(lower)) {
      continue;
    }
    if (/[a-z0-9]+\.[a-z0-9]/i.test(token)) {
      keywords.push(lower);
      continue;
    }
    const stripped = lower.replace(/[^a-z0-9]+/g, "");
    if (stripped.length < 2) {
      continue;
    }
    keywords.push(stripped);
  }
  return Array.from(new Set(keywords));
}

function detectActionTokens(query) {
  if (typeof query !== "string" || !query.trim()) {
    return [];
  }
  const lower = query.toLowerCase();
  const detected = new Set();
  for (const [action, words] of Object.entries(ACTION_KEYWORDS)) {
    if (words.some((word) => lower.includes(word))) {
      detected.add(action);
    }
  }
  return Array.from(detected);
}

function detectTimeTokens(query) {
  if (typeof query !== "string" || !query.trim()) {
    return [];
  }
  const tokens = new Set();
  for (const { pattern, label } of TIME_KEYWORD_PATTERNS) {
    if (pattern.test(query)) {
      tokens.add(label);
    }
  }
  const durationPattern = /(last|past)\s+(\d+)\s+(day|days|week|weeks|month|months|hour|hours)/gi;
  let match;
  while ((match = durationPattern.exec(query)) !== null) {
    const [, , countStr, unitRaw] = match;
    const count = Number.parseInt(countStr, 10);
    if (!Number.isFinite(count) || count <= 0) {
      continue;
    }
    const unit = unitRaw.toLowerCase();
    let normalizedUnit = unit;
    if (!unit.endsWith("s")) {
      normalizedUnit = `${unit}s`;
    }
    tokens.add(`last ${count} ${normalizedUnit}`);
  }
  return Array.from(tokens);
}

function formatTopicToken(token) {
  if (!token) {
    return "";
  }
  if (/^[a-z]+$/.test(token)) {
    if (token.length <= 3) {
      return token.toUpperCase();
    }
    return token.replace(/^(.)/, (char) => char.toUpperCase());
  }
  if (/^[a-z0-9]+$/i.test(token)) {
    return token;
  }
  return token;
}

function buildQueryTokenData(query) {
  if (typeof query !== "string") {
    return { tokens: [], topicTokens: [], timeTokens: [], actionTokens: [] };
  }
  const rawTokens = query.match(/[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*/g) || [];
  const lowerMap = new Map();
  for (const token of rawTokens) {
    const lower = token.toLowerCase();
    if (!lowerMap.has(lower)) {
      lowerMap.set(lower, token);
    }
  }
  const keywordList = extractQueryKeywords(query);
  const topicTokens = [];
  for (const keyword of keywordList) {
    const source = lowerMap.get(keyword) || keyword;
    const formatted = formatTopicToken(source);
    if (formatted) {
      topicTokens.push(formatted);
    }
  }
  return {
    tokens: rawTokens,
    topicTokens: Array.from(new Set(topicTokens)),
    timeTokens: detectTimeTokens(query),
    actionTokens: detectActionTokens(query),
  };
}

function detectHelpRequest(query, tokenData) {
  const text = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!text) {
    return false;
  }
  for (const pattern of HELP_QUERY_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  const rawTokens = Array.isArray(tokenData?.tokens) ? tokenData.tokens : [];
  const lowerTokens = rawTokens
    .map((token) => (typeof token === "string" ? token.toLowerCase() : ""))
    .filter(Boolean);
  if (!lowerTokens.includes("help")) {
    return false;
  }
  const actionHints = Array.isArray(tokenData?.actionTokens)
    ? tokenData.actionTokens.map((token) => (typeof token === "string" ? token.toLowerCase() : ""))
    : [];
  if (actionHints.length) {
    return false;
  }
  const otherTokens = lowerTokens.filter((token) => token !== "help");
  if (!otherTokens.length) {
    return true;
  }
  return otherTokens.every((token) => HELP_SOFT_SIGNAL_TOKENS.has(token));
}

function buildHelpAcknowledgement() {
  return (
    "I can look through your browsing history, reopen recent tabs, or delete entries you choose. " +
    'Try asking for things like "show the YouTube videos I watched yesterday," ' +
    '"open my GitHub tabs from last week," or "delete Saturday\'s shopping history."'
  );
}

function buildDateRangeFromTokens(tokenData) {
  const tokens = Array.isArray(tokenData?.timeTokens) ? tokenData.timeTokens : [];
  if (!tokens.length) {
    return null;
  }
  const primary = tokens.find((token) => typeof token === "string" && token.trim());
  if (!primary) {
    return null;
  }
  const normalized = primary.trim();
  const lower = normalized.toLowerCase();
  if (lower === "today" || lower === "yesterday") {
    return { start: normalized, end: normalized };
  }
  if (lower === "now") {
    return { start: normalized, end: normalized };
  }
  if (lower === "this week" || lower === "this month") {
    return { start: normalized, end: "now" };
  }
  if (lower.startsWith("last ") || lower.startsWith("past ")) {
    return { start: normalized, end: "now" };
  }
  return { start: normalized, end: "now" };
}

function clampConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function detectRequestedItemCount(tokenData, query) {
  const rawTokens = Array.isArray(tokenData?.tokens) ? tokenData.tokens : [];
  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index];
    if (typeof token !== "string") {
      continue;
    }
    if (!/^\d+$/.test(token.trim())) {
      continue;
    }
    const previous = rawTokens[index - 1];
    if (typeof previous === "string") {
      const normalizedPrev = previous.toLowerCase();
      if (["top", "last", "recent", "open", "show", "delete"].includes(normalizedPrev)) {
        const parsed = Number.parseInt(token, 10);
        const normalized = normalizeMaxItems(parsed);
        if (normalized) {
          return normalized;
        }
      }
    }
  }
  if (typeof query === "string" && query) {
    const match = query.match(/(?:top|last|recent|open|show|delete)\s+(\d{1,3})/i);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      const normalized = normalizeMaxItems(parsed);
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
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

function resolveActionFromTokens(tokenData) {
  if (!tokenData || !Array.isArray(tokenData.actionTokens)) {
    return null;
  }
  for (const token of tokenData.actionTokens) {
    const normalized = normalizeAction(token);
    if (normalized) {
      return normalized;
    }
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

function getStartOfWeek(timestamp) {
  const date = new Date(timestamp);
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getEndOfWeek(timestamp) {
  const start = getStartOfWeek(timestamp);
  const date = new Date(start);
  date.setDate(date.getDate() + 6);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function getStartOfMonth(timestamp) {
  const date = new Date(timestamp);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getEndOfMonth(timestamp) {
  const date = new Date(timestamp);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  date.setMonth(date.getMonth() + 1);
  date.setMilliseconds(date.getMilliseconds() - 1);
  return date.getTime();
}

function interpretRelativeRange(label, now = Date.now()) {
  if (typeof label !== "string" || !label.trim()) {
    return null;
  }
  const normalized = label.trim().toLowerCase();
  const todayStart = toStartOfDay(now);
  switch (normalized) {
    case "today": {
      const startTime = todayStart;
      const endTime = startTime + DAY_MS - 1;
      return { startTime, endTime, preset: "today", description: "today" };
    }
    case "yesterday": {
      const startTime = todayStart - DAY_MS;
      const endTime = todayStart - 1;
      return { startTime, endTime, preset: "yesterday", description: "yesterday" };
    }
    case "this week": {
      const startTime = getStartOfWeek(now);
      const endTime = Math.min(now, getEndOfWeek(now));
      return { startTime, endTime, preset: "thisWeek", description: "this week" };
    }
    case "last week": {
      const endOfCurrentWeek = getStartOfWeek(now) - 1;
      const startTime = getStartOfWeek(endOfCurrentWeek);
      const endTime = getEndOfWeek(endOfCurrentWeek);
      return { startTime, endTime, preset: "lastWeek", description: "last week" };
    }
    case "this month": {
      const startTime = getStartOfMonth(now);
      const endTime = Math.min(now, getEndOfMonth(now));
      return { startTime, endTime, preset: "thisMonth", description: "this month" };
    }
    case "last month": {
      const endOfLastMonth = getStartOfMonth(now) - 1;
      const startTime = getStartOfMonth(endOfLastMonth);
      const endTime = getEndOfMonth(endOfLastMonth);
      return { startTime, endTime, preset: "lastMonth", description: "last month" };
    }
    case "last 7 days": {
      const startTime = toStartOfDay(now - 6 * DAY_MS);
      return { startTime, endTime: now, preset: "last7days", description: "last 7 days" };
    }
    case "last 30 days": {
      const startTime = toStartOfDay(now - 29 * DAY_MS);
      return { startTime, endTime: now, preset: "last30days", description: "last 30 days" };
    }
    case "last 24 hours": {
      const startTime = now - 24 * 60 * 60 * 1000;
      return { startTime, endTime: now, preset: "custom", description: "last 24 hours" };
    }
    default:
      break;
  }
  const durationMatch = normalized.match(/^(last|past)\s+(\d+)\s+(day|days|week|weeks|month|months|hour|hours)$/);
  if (durationMatch) {
    const [, , countStr, unitRaw] = durationMatch;
    const count = Number.parseInt(countStr, 10);
    if (Number.isFinite(count) && count > 0) {
      const unit = unitRaw.toLowerCase();
      let durationMs;
      if (unit.startsWith("hour")) {
        durationMs = count * 60 * 60 * 1000;
      } else if (unit.startsWith("week")) {
        durationMs = count * 7 * DAY_MS;
      } else if (unit.startsWith("month")) {
        durationMs = count * 30 * DAY_MS;
      } else {
        durationMs = count * DAY_MS;
      }
      const endTime = now;
      let startTime = now - durationMs;
      if (durationMs >= DAY_MS) {
        const days = Math.max(1, Math.ceil(durationMs / DAY_MS));
        startTime = toStartOfDay(now - (days - 1) * DAY_MS);
      }
      const normalizedUnit = unit.endsWith("s") ? unit : `${unit}s`;
      const description = `last ${count} ${normalizedUnit}`;
      return { startTime, endTime, preset: "custom", description };
    }
  }
  return null;
}

function interpretBoundary(value, type, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  const relative = interpretRelativeRange(trimmed, now);
  if (relative) {
    if (type === "start") {
      return {
        time: relative.startTime,
        preset: relative.preset,
        description: relative.description,
        rangeEnd: relative.endTime,
      };
    }
    return {
      time: relative.endTime,
      preset: relative.preset,
      description: relative.description,
      rangeStart: relative.startTime,
    };
  }
  if (trimmed.toLowerCase() === "now") {
    return { time: now, description: "now", preset: "custom" };
  }
  const parsed = parseDateBoundary(trimmed, type, now);
  if (Number.isFinite(parsed)) {
    return { time: parsed, preset: "custom" };
  }
  return null;
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

function normalizeTimeRange(rawRange, now = Date.now(), tokenData = null) {
  const defaultRange = { startTime: 0, endTime: now, preset: "any", description: "all time" };
  const fallbackTokens = Array.isArray(tokenData?.timeTokens) ? tokenData.timeTokens : [];
  const tokenRange = buildDateRangeFromTokens(tokenData);

  let startValue = tokenRange?.start;
  let endValue = tokenRange?.end;

  if (!startValue) {
    startValue =
      rawRange && typeof rawRange.start === "string" && rawRange.start.trim() ? rawRange.start : fallbackTokens[0];
  }
  if (!endValue) {
    endValue = rawRange && typeof rawRange.end === "string" && rawRange.end.trim() ? rawRange.end : undefined;
  }

  let startBoundary = interpretBoundary(startValue, "start", now);
  let endBoundary = interpretBoundary(endValue, "end", now);

  if (!startBoundary && !startValue && fallbackTokens.length > 0) {
    startBoundary = interpretBoundary(fallbackTokens[0], "start", now);
  }
  if (!endBoundary && !endValue && startBoundary?.rangeEnd !== undefined) {
    endBoundary = {
      time: startBoundary.rangeEnd,
      preset: startBoundary.preset,
      description: startBoundary.description,
    };
  }
  if (!startBoundary && !startValue && endBoundary?.rangeStart !== undefined) {
    startBoundary = {
      time: endBoundary.rangeStart,
      preset: endBoundary.preset,
      description: endBoundary.description,
    };
  }

  let startTime = startBoundary?.time ?? defaultRange.startTime;
  let endTime = endBoundary?.time ?? defaultRange.endTime;
  let preset = startBoundary?.preset || endBoundary?.preset || defaultRange.preset;
  let description =
    startBoundary?.description || endBoundary?.description || tokenRange?.start || fallbackTokens[0] || defaultRange.description;

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
  const derivedPreset = preset && preset !== "custom" ? preset : detectPresetFromRange(startTime, endTime, now);
  if (!description || !description.trim()) {
    description = describeTimeRange({ preset: derivedPreset, startTime, endTime }, now);
  }
  return { startTime, endTime, preset: derivedPreset, description };
}

function interpretTokensFirst(query, tokenData, now = Date.now()) {
  const queryText = typeof query === "string" ? query.trim() : "";
  const action = resolveActionFromTokens(tokenData) || detectActionTokens(queryText)[0] || null;
  if (!action) {
    return null;
  }
  const topics = Array.isArray(tokenData?.topicTokens) ? tokenData.topicTokens.slice(0, 8) : [];
  const maxItems = detectRequestedItemCount(tokenData, queryText) || 20;
  const timeRangeInput = buildDateRangeFromTokens(tokenData);
  const timeRange = normalizeTimeRange(timeRangeInput, now, tokenData);
  const queryKeywords = extractQueryKeywords(queryText);
  const confidenceBase = 0.6 + (topics.length ? 0.15 : 0) + (timeRangeInput ? 0.1 : 0);
  const confidence = clampConfidence(Math.min(0.95, confidenceBase));
  return {
    confidence,
    action,
    topics,
    maxItems,
    timeRange,
    rawQuery: queryText,
    queryKeywords,
  };
}

function describeTimeRange(range, now = Date.now()) {
  if (!range) {
    return "all time";
  }
  if (typeof range.description === "string" && range.description.trim()) {
    return range.description.trim();
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

function filterEntriesByTopics(entries, topics, fallbackKeywords = []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return entries || [];
  }
  const fallback = normalizeKeywordList(fallbackKeywords);
  const uniqueKeywords = Array.from(new Set([...extractKeywords(topics), ...fallback]));
  if (!uniqueKeywords.length) {
    return entries;
  }
  const filtered = entries.filter((entry) => {
    const title = (entry.title || "").toLowerCase();
    const url = (entry.url || "").toLowerCase();
    const host = (entry.url ? extractHostname(entry.url) : "").toLowerCase();
    return uniqueKeywords.some(
      (keyword) => title.includes(keyword) || url.includes(keyword) || (host && host.includes(keyword))
    );
  });
  return filtered.length ? filtered : entries;
}

function buildTopicLabel(topics, fallbackKeywords = []) {
  if (!Array.isArray(topics) || topics.length === 0) {
    if (Array.isArray(fallbackKeywords) && fallbackKeywords.length) {
      return fallbackKeywords.slice(0, 4).join(", ");
    }
    return "everything";
  }
  const uniqueKeywords = extractKeywords(topics);
  if (uniqueKeywords.length) {
    return uniqueKeywords.slice(0, 4).join(", ");
  }
  if (Array.isArray(fallbackKeywords) && fallbackKeywords.length) {
    return fallbackKeywords.slice(0, 4).join(", ");
  }
  const fallback = topics
    .map((topic) => (typeof topic === "string" ? topic.trim() : ""))
    .filter(Boolean);
  return fallback.length ? fallback.join(", ") : "everything";
}

function buildAckMessage(action, interpretation, details = {}) {
  const {
    count = 0,
    totalMatches = count,
    timeLabel,
    cap,
    limit,
  } = typeof details === "object" && details !== null ? details : {};
  const topicLabel = buildTopicLabel(interpretation.topics, interpretation.queryKeywords);
  const rangeLabel = timeLabel || describeTimeRange(interpretation.timeRange);

  if (action === "search" || action === "show") {
    if (!count) {
      return `I couldn't find history for ${topicLabel} in ${rangeLabel}.`;
    }
    const plural = count === 1 ? "entry" : "entries";
    const limitNotice =
      Number.isFinite(limit) && totalMatches > limit
        ? ` (showing up to ${limit})`
        : "";
    return `I found ${count} ${plural} for ${topicLabel} in ${rangeLabel}${limitNotice}.`;
  }

  if (action === "open") {
    if (!count) {
      if (totalMatches > 0) {
        return `I matched ${totalMatches} history entries for ${topicLabel}, but couldn't reopen any tabs.`;
      }
      return `I couldn't find anything to reopen for ${topicLabel}.`;
    }
    const plural = count === 1 ? "tab" : "tabs";
    let matchDetails = "";
    if (Number.isFinite(cap) && totalMatches > cap) {
      matchDetails = ` (matched ${totalMatches}, capped at ${cap} unique tabs)`;
    } else if (totalMatches > count) {
      matchDetails = ` (matched ${totalMatches} entries)`;
    } else if (Number.isFinite(cap) && cap < count) {
      matchDetails = ` (capped at ${cap} unique tabs)`;
    }
    return `Reopening ${count} ${plural} from ${rangeLabel}${matchDetails}.`;
  }

  if (action === "delete") {
    if (!count) {
      return `I didn't find history to delete for ${topicLabel} in ${rangeLabel}.`;
    }
    const plural = count === 1 ? "entry" : "entries";
    const limitNotice =
      Number.isFinite(limit) && totalMatches > limit
        ? ` (showing up to ${limit})`
        : "";
    return `Ready to remove ${count} ${plural} from ${rangeLabel}${limitNotice}.`;
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
  const fallbackKeywords = Array.isArray(options.fallbackKeywords) ? options.fallbackKeywords : [];
  const normalizedFallback = normalizeKeywordList(fallbackKeywords);
  const combinedKeywords = Array.from(new Set([...extractKeywords(topics), ...normalizedFallback]));
  const fallbackQueryText = typeof options.fallbackQuery === "string" ? options.fallbackQuery.trim() : "";
  const rawQuery = combinedKeywords.length ? combinedKeywords.join(" ") : fallbackQueryText;
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

  const filtered = filterEntriesByTopics(entries || [], topics, normalizedFallback);
  if (limit) {
    return filtered.slice(0, limit);
  }
  return filtered;
}

function sanitizeInterpretation(parsed, now = Date.now(), originalQuery = "", tokenData = null) {
  const confidence = clampConfidence(parsed?.confidence);
  const tokenAction = resolveActionFromTokens(tokenData);
  let action = tokenAction || normalizeAction(parsed?.action);
  if (!action) {
    const detected = detectActionTokens(originalQuery);
    action = detected.length ? detected[0] : null;
  }
  const promptTopics = normalizeTopics(parsed?.topics);
  const tokenTopics = Array.isArray(tokenData?.topicTokens) ? tokenData.topicTokens.slice(0, 8) : [];
  let topics = tokenTopics.slice();
  if (!topics.length && promptTopics.length) {
    topics = promptTopics.slice(0, 8);
  } else {
    for (const topic of promptTopics) {
      if (!topics.includes(topic)) {
        topics.push(topic);
      }
    }
    topics = topics.slice(0, 8);
  }
  let maxItems = normalizeMaxItems(parsed?.maxItems);
  if (!maxItems) {
    maxItems = 20;
  }
  const effectiveRange = buildDateRangeFromTokens(tokenData) || parsed?.dateRange || null;
  const timeRange = normalizeTimeRange(effectiveRange, now, tokenData);
  const queryText = typeof originalQuery === "string" ? originalQuery.trim() : "";
  const queryKeywords = extractQueryKeywords(queryText);
  return {
    confidence,
    action,
    topics,
    maxItems,
    timeRange,
    rawQuery: queryText,
    queryKeywords,
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

function buildPrompt(query, tokenData, historySample, now = new Date()) {
  const trimmed = typeof query === "string" ? query.trim() : "";
  const localIso = formatLocalIso(now);
  const historySection = historySample ? historySample : "No recent history entries available.";
  const tokenPayload = {
    tokens: Array.isArray(tokenData?.tokens) ? tokenData.tokens : [],
    topicTokens: Array.isArray(tokenData?.topicTokens) ? tokenData.topicTokens : [],
    timeTokens: Array.isArray(tokenData?.timeTokens) ? tokenData.timeTokens : [],
    actionTokens: Array.isArray(tokenData?.actionTokens) ? tokenData.actionTokens : [],
  };
  const inputPayload = JSON.stringify({ query: trimmed, tokens: tokenPayload, now: localIso });
  const exampleInput =
    '{"query":"show AI sites from last 7 days","tokens":{"tokens":["show","AI","sites","last","7","days"],"topicTokens":["AI"],"timeTokens":["last 7 days"],"actionTokens":["show"]},"now":"2025-10-25T18:30:00Z"}';
  const exampleOutput =
    '{"action":"show","topics":["AI"],"dateRange":{"start":"last 7 days","end":"now"},"maxItems":20,"confidence":0.95}';
  return [
    "You are the Smart History Search interpreter for a Chrome extension.",
    "Your input is a JSON object containing the user's natural query plus pre-tokenized hints: { \"query\": string, \"tokens\": { \"tokens\": string[], \"topicTokens\": string[], \"timeTokens\": string[], \"actionTokens\": string[] }, \"now\": ISO_8601_datetime }.",
    "Use the provided token data as the primary source of truth—if actionTokens, topicTokens, or timeTokens exist, rely on them directly before inferring from the raw query.",
    "Return exactly one JSON object with this schema: { \"action\": \"show\" | \"open\" | \"delete\", \"topics\": string[], \"dateRange\": { \"start\": string, \"end\": string } | null, \"maxItems\": number, \"confidence\": number }.",
    "Rules:\n1. Detect the action from actionTokens, falling back to the query only when tokens are empty.\n2. Use topicTokens for keywords such as AI, GPT, Claude, Gemini, YouTube, Reddit, or GitHub.\n3. Map timeTokens like \"today\", \"yesterday\", \"last week\", \"last 7 days\" into human-readable text (not exact dates) for dateRange.start/end.\n4. Default maxItems to 20 unless the query requests a different count (for example \"top 5\").\n5. Keep confidence between 0 and 1.\n6. If there is no history-related intent, respond with { \"confidence\": 0 }.",
    "Example input:\n" + exampleInput,
    "Example output:\n" + exampleOutput,
    `Recent history sample (most recent first):\n${historySection}`,
    `Input JSON:\n${inputPayload}`,
    "Respond with valid JSON only—no explanations or extra text."
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
    const tokenData = buildQueryTokenData(query);
    const nowTs = Date.now();
    const tokenInterpretation = interpretTokensFirst(query, tokenData, nowTs);
    if (tokenInterpretation && tokenInterpretation.confidence >= 0.7) {
      return tokenInterpretation;
    }
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
      const attemptNow = new Date();
      const promptText = buildPrompt(query, tokenData, historySample, attemptNow);
      try {
        const raw = await session.prompt(promptText, { responseConstraint: RESPONSE_SCHEMA });
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          throw new Error("History assistant returned invalid JSON");
        }
        return sanitizeInterpretation(parsed, attemptNow.getTime(), query, tokenData);
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
    if (tokenInterpretation) {
      return tokenInterpretation;
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
    const limit = interpretation.maxItems || 20;
    const entries = await collectHistoryEntries(interpretation.topics, interpretation.timeRange, {
      maxItems: limit,
      fallbackQuery: interpretation.rawQuery,
      fallbackKeywords: interpretation.queryKeywords,
    });
    const sessions = groupHistorySessions(entries);
    const ack = buildAckMessage("show", interpretation, {
      count: entries.length,
      totalMatches: entries.length,
      limit,
    });
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
    const limit = interpretation.maxItems || 20;
    const entries = await collectHistoryEntries(interpretation.topics, interpretation.timeRange, {
      maxItems: limit,
      fallbackQuery: interpretation.rawQuery,
      fallbackKeywords: interpretation.queryKeywords,
    });
    const sessions = groupHistorySessions(entries);
    const uniqueUrls = new Set();
    const openCap = Math.min(limit, MAX_AUTO_OPEN_TABS);
    const urlsToOpen = [];
    const sortedEntries = Array.isArray(entries)
      ? entries
          .slice()
          .sort((a, b) => (b?.lastVisitTime || 0) - (a?.lastVisitTime || 0))
      : [];
    for (const entry of sortedEntries) {
      if (!entry || typeof entry.url !== "string" || !entry.url) {
        continue;
      }
      if (uniqueUrls.has(entry.url)) {
        continue;
      }
      uniqueUrls.add(entry.url);
      urlsToOpen.push(entry.url);
      if (urlsToOpen.length >= openCap) {
        break;
      }
    }
    let openedCount = 0;
    for (const url of urlsToOpen) {
      try {
        await chrome.tabs.create({ url });
        openedCount += 1;
      } catch (err) {
        console.warn("Spotlight: failed to open history tab", err);
      }
    }
    const ack = buildAckMessage("open", interpretation, {
      count: openedCount,
      totalMatches: entries.length,
      cap: openCap,
      limit,
    });
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
    const limit = interpretation.maxItems || 20;
    const entries = await collectHistoryEntries(interpretation.topics, interpretation.timeRange, {
      maxItems: limit,
      fallbackQuery: interpretation.rawQuery,
      fallbackKeywords: interpretation.queryKeywords,
    });
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
    const ack = buildAckMessage("delete", interpretation, {
      count: items.length,
      totalMatches: items.length,
      limit,
    });
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
      const tokenData = buildQueryTokenData(query);
      if (detectHelpRequest(query, tokenData)) {
        const ack = buildHelpAcknowledgement();
        logAssistantAction(actionLog, {
          timestamp: Date.now(),
          action: "info",
          summary: ack,
        });
        response.action = "clarify";
        response.followUpQuestion = "";
        response.ack = ack;
        response.log = actionLog.slice();
        return response;
      }
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

