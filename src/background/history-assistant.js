import { browser } from "../shared/browser-shim.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 7 * DAY_MS;
const MAX_DATASET_ENTRIES = 240;
const MAX_RESULT_IDS = 48;
const MAX_ACTION_TABS = 8;
const LOCAL_RESULT_LIMIT = 60;
const MAX_CONVERSATION_TURNS = 6;
const MAX_CONVERSATION_CHARS = 2400;
const MAX_CONVERSATION_AGE_MS = 20 * 60 * 1000;
const SUMMARY_TOP_HOSTS_LIMIT = 8;
const SUMMARY_TOP_KEYWORDS_LIMIT = 12;
const SUMMARY_HIGHLIGHT_LIMIT = 40;
const SUMMARY_META_PATTERNS = [
  /respond\s+with\s+json/i,
  /return\s+json/i,
  /json\s+schema/i,
  /schema\s+exactly/i,
  /instructions?\s+(?:say|state|require|specify)/i,
  /this\s+requires/i,
  /i\s+interpreted/i,
  /as\s+an\s+ai/i,
  /i\s+am\s+an\s+ai/i,
  /the\s+dataset\s+(?:below|provided|above)/i,
  /the\s+prompt\s+(?:says|states|provided)/i,
  /the\s+model\s+(?:decided|will|should)/i,
  /analysis:/i,
  /meta-response/i,
  /here'?s\s+how\s+(?:i|we)\s+(?:would|will)\s+(?:approach|handle)/i,
];

const DEV_MODE =
  typeof process !== "undefined" &&
  process &&
  process.env &&
  process.env.NODE_ENV !== "production";

const FILTER_STOP_KEYWORDS = new Set([
  "visit",
  "visits",
  "visited",
  "view",
  "views",
  "open",
  "opened",
  "opening",
  "watch",
  "watched",
  "watching",
  "history",
  "tab",
  "tabs",
  "page",
  "pages",
]);

const FOLLOWUP_HINT_REGEX = [
  /^(?:and|also|then|now|so)\b/,
  /\bwhat about\b/,
  /\b(?:also|too|else|besides|add|include|including|excluding|except|remove)\b/,
  /\b(?:those|them|that(?: list| set| one| ones)?|these|the rest|same ones?)\b/,
  /\b(?:another|others?|more of|keep going)\b/,
  /\bagain\b/,
];

const NUMBER_WORDS = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
]);

const STOP_WORDS = new Set([
  "a",
  "about",
  "all",
  "an",
  "and",
  "any",
  "ask",
  "assistant",
  "at",
  "be",
  "browser",
  "browsing",
  "can",
  "did",
  "do",
  "entries",
  "entry",
  "for",
  "from",
  "have",
  "history",
  "i",
  "in",
  "just",
  "list",
  "me",
  "my",
  "of",
  "on",
  "please",
  "records",
  "show",
  "site",
  "sites",
  "tab",
  "tabs",
  "the",
  "these",
  "those",
  "visit",
  "visited",
  "was",
  "were",
  "what",
  "which",
]);

const TIME_WORDS = new Set([
  "ago",
  "earlier",
  "day",
  "days",
  "hour",
  "hours",
  "minute",
  "minutes",
  "month",
  "months",
  "past",
  "previous",
  "recent",
  "recently",
  "this",
  "today",
  "week",
  "weeks",
  "yesterday",
  "last",
  "tonight",
  "morning",
  "afternoon",
  "evening",
  "night",
]);

const HISTORY_ACTION_HINTS = [
  "list",
  "show",
  "find",
  "search",
  "open",
  "delete",
  "remove",
  "clear",
  "erase",
  "locate",
  "look",
  "summarize",
  "summarise",
  "recap",
];

const HISTORY_OBJECT_HINTS = [
  "tab",
  "tabs",
  "history",
  "site",
  "sites",
  "page",
  "pages",
  "visit",
  "visits",
  "activity",
  "records",
  "entries",
  "browsing",
];

const GENERAL_INQUIRY_REGEX = [
  /\bwho\s+are\s+(you|u)\b/,
  /\bwhat\s+(are|is)\s+(you|this|spotlight)\b/,
  /\bwhat\s+can\s+(you|this)\s+do\b/,
  /\bwhat\s+do\s+(you|this)\s+do\b/,
  /\bhow\s+(can|do|are)\s+(you|this)\s+(help|assist|support)\b/,
  /\bhow\s+(can|do|are)\s+(you|this)\s+usef(?:ul|ull)\b/,
  /\bwhat\s+can\s+you\s+help\s+with\b/,
  /\bwhat\s+are\s+your\s+capabilities\b/,
  /\bwhat\s+can\s+i\s+ask\b/,
  /\btell\s+me\s+about\s+(yourself|you)\b/,
  /\bintroduce\s+yourself\b/,
  /\bhow\s+do\s+i\s+use\s+(you|this|spotlight)\b/,
];

const GENERAL_RESPONSE_SUGGESTIONS = [
  "List all YouTube tabs from yesterday.",
  "Summarize what I did this morning.",
  "Delete Google results from the last hour.",
  "Open the sites I visited 20 minutes ago.",
];

const GENERAL_GREETING_SCHEMA = {
  type: "object",
  properties: {
    message: { type: "string" },
    suggestions: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
  },
  required: ["message"],
  additionalProperties: false,
};

const SUMMARY_MESSAGE_SCHEMA = {
  type: "object",
  properties: {
    message: { type: "string" },
    notes: { type: "string" },
  },
  required: ["message"],
  additionalProperties: false,
};

const TIME_RANGE_SCHEMA = {
  type: "object",
  properties: {
    timeRange: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            start: { type: "string" },
            end: { type: "string" },
          },
          required: ["start", "end"],
          additionalProperties: false,
        },
      ],
    },
    confidence: { type: "number" },
  },
  required: ["timeRange"],
  additionalProperties: false,
};

const INTERPRETATION_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["show", "open", "delete", "summarize", "unknown"],
    },
    outputMessage: { type: "string" },
    filteredResultIds: {
      type: "array",
      items: {
        anyOf: [
          { type: "number" },
          { type: "string" },
        ],
      },
    },
    notes: { type: "string" },
  },
  required: ["action", "outputMessage", "filteredResultIds"],
  additionalProperties: false,
};

const SEARCH_PLAN_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["show", "open", "delete", "summarize", "unknown"],
    },
    mustInclude: {
      type: "array",
      items: { type: "string" },
    },
    shouldInclude: {
      type: "array",
      items: { type: "string" },
    },
    exclude: {
      type: "array",
      items: { type: "string" },
    },
    domainHints: {
      type: "array",
      items: { type: "string" },
    },
    searchPhrases: {
      type: "array",
      items: { type: "string" },
    },
    timeRange: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            start: { type: "string" },
            end: { type: "string" },
          },
          required: ["start", "end"],
          additionalProperties: false,
        },
      ],
    },
    maxResults: { type: "number" },
    requireModel: { type: "boolean" },
    reasoning: { type: "string" },
  },
  required: ["intent"],
  additionalProperties: false,
};

function startOfLocalDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfLocalDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function parseQuantityToken(token, fallback = 1) {
  if (!token) {
    return fallback;
  }
  const numeric = Number(token);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const normalized = token.toLowerCase();
  if (NUMBER_WORDS.has(normalized)) {
    return NUMBER_WORDS.get(normalized);
  }
  if (normalized === "a" || normalized === "an") {
    return 1;
  }
  if (normalized === "couple") {
    return 2;
  }
  if (normalized === "few" || normalized === "several") {
    return 3;
  }
  return fallback;
}

function deriveTimeRangeFromPrompt(prompt, now = Date.now()) {
  if (!prompt || typeof prompt !== "string") {
    return null;
  }
  const normalized = prompt.toLowerCase();

  if (normalized.includes("yesterday")) {
    const end = startOfLocalDay(now);
    const start = Math.max(0, end - DAY_MS);
    if (end > start) {
      return { range: { start, end }, confidence: 0.9 };
    }
  }

  if (normalized.includes("today")) {
    const start = startOfLocalDay(now);
    const end = Math.max(start + 60 * 1000, Math.min(now, endOfLocalDay(now)));
    if (end > start) {
      return { range: { start, end }, confidence: 0.75 };
    }
  }

  const relativeMatch = normalized.match(
    /\b(?:past|last)\s+(?:the\s+)?(?:(\d+|[a-z]+)\s+)?(minute|hour|day|week|month)s?\b/
  );
  if (relativeMatch) {
    const [, quantityToken, unit] = relativeMatch;
    const count = parseQuantityToken(quantityToken, 1);
    const unitLower = unit.toLowerCase();
    const unitToMs = {
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: DAY_MS,
      week: 7 * DAY_MS,
      month: 30 * DAY_MS,
    };
    const duration = unitToMs[unitLower];
    if (duration) {
      const total = duration * Math.max(1, count);
      if (unitLower === "day") {
        const alignedStart = startOfLocalDay(now - (count - 1) * DAY_MS);
        const end = Math.min(now, endOfLocalDay(now));
        if (end > alignedStart) {
          return { range: { start: Math.max(0, alignedStart), end }, confidence: 0.8 };
        }
      }
      const start = Math.max(0, now - total);
      if (now > start) {
        return { range: { start, end: now }, confidence: 0.8 };
      }
    }
  }

  const lastWeekMatch = normalized.match(/\b(last|previous)\s+week\b/);
  if (lastWeekMatch) {
    const end = startOfLocalDay(now);
    const start = Math.max(0, end - 7 * DAY_MS);
    if (end > start) {
      return { range: { start, end }, confidence: 0.7 };
    }
  }

  return null;
}

function formatIso(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  try {
    return new Date(timestamp).toISOString();
  } catch (err) {
    return null;
  }
}

function formatFriendlyRange(range) {
  if (!range || typeof range !== "object") {
    return null;
  }
  const startValue = Date.parse(range.start);
  const endValue = Date.parse(range.end);
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || endValue <= startValue) {
    return null;
  }
  try {
    const startDate = new Date(startValue);
    const endDate = new Date(endValue);
    const locale = undefined;
    const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
    const dayFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" });
    const yearFormatter = new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" });
    const startMonth = monthFormatter.format(startDate);
    const endMonth = monthFormatter.format(endDate);
    const startDay = dayFormatter.format(startDate);
    const endDay = dayFormatter.format(endDate);
    const startYear = yearFormatter.format(startDate);
    const endYear = yearFormatter.format(endDate);
    if (startYear === endYear) {
      if (startMonth === endMonth) {
        return `${startMonth} ${startDay}–${endDay}, ${startYear}`;
      }
      return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${startYear}`;
    }
    return `${startMonth} ${startDay}, ${startYear} – ${endMonth} ${endDay}, ${endYear}`;
  } catch (err) {
    return null;
  }
}

function clampTimeRange(range, now = Date.now()) {
  if (!range || typeof range !== "object") {
    return null;
  }
  const startValue = Date.parse(range.start);
  const endValue = Date.parse(range.end);
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
    return null;
  }
  if (endValue <= startValue) {
    return null;
  }
  const clampedEnd = Math.min(endValue, now);
  const clampedStart = Math.min(startValue, clampedEnd - 60 * 1000);
  return { start: clampedStart, end: clampedEnd };
}

function fallbackTimeRange(now = Date.now(), lookback = DEFAULT_LOOKBACK_MS) {
  const end = now;
  const start = Math.max(0, end - lookback);
  return { start, end };
}

function normalizeAction(action) {
  if (!action || typeof action !== "string") {
    return "show";
  }
  const normalized = action.toLowerCase().trim();
  if (["show", "open", "delete", "summarize"].includes(normalized)) {
    return normalized;
  }
  return "show";
}

function detectPromptAction(prompt) {
  const normalized = typeof prompt === "string" ? prompt.toLowerCase() : "";
  if (/\b(delete|remove|clear|erase|forget)\b/.test(normalized)) {
    return "delete";
  }
  if (/\b(open|reopen|launch|restore)\b/.test(normalized)) {
    return "open";
  }
  if (
    /\b(summarize|summary|recap|overview|explain)\b/.test(normalized) ||
    /\bwhat\s+(did|have)\s+i\s+(do|done)\b/.test(normalized)
  ) {
    return "summarize";
  }
  return "show";
}

function extractMeaningfulKeywords(prompt) {
  if (!prompt || typeof prompt !== "string") {
    return [];
  }
  const tokens = prompt.toLowerCase().match(/[a-z0-9]+/g);
  if (!tokens) {
    return [];
  }
  const keywords = [];
  const seen = new Set();
  for (const token of tokens) {
    if (STOP_WORDS.has(token) || TIME_WORDS.has(token) || NUMBER_WORDS.has(token)) {
      continue;
    }
    if (/^\d+$/.test(token)) {
      continue;
    }
    if (token.length < 2) {
      continue;
    }
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    keywords.push(token);
  }
  return keywords;
}

function isLikelyFollowupPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") {
    return false;
  }
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  for (const regex of FOLLOWUP_HINT_REGEX) {
    if (regex.test(normalized)) {
      return true;
    }
  }
  if (normalized.split(" ").length <= 4 && /\b(it|that|them|those|ones?)\b/.test(normalized)) {
    return true;
  }
  return false;
}

function dedupeStrings(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function truncateForContext(text, maxLength = 240) {
  if (typeof text !== "string") {
    return "";
  }
  const trimmed = text.trim();
  if (!trimmed || trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function summarizeStringsForContext(values, limit = 4) {
  const list = dedupeStrings(values);
  if (!list.length) {
    return "";
  }
  const limited = list.slice(0, limit);
  const suffix = list.length > limit ? ", …" : "";
  return `${limited.join(", ")}${suffix}`;
}

function normalizeRangeMs(range) {
  if (!range || typeof range !== "object") {
    return null;
  }
  const start = Number(range.start);
  const end = Number(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  if (end <= start) {
    return null;
  }
  return { start, end };
}

function normalizeIsoRange(range) {
  if (!range || typeof range !== "object") {
    return null;
  }
  const start = typeof range.start === "string" && range.start ? range.start : null;
  const end = typeof range.end === "string" && range.end ? range.end : null;
  if (!start && !end) {
    return null;
  }
  return { start, end };
}

function convertRangeToIso(range) {
  const normalized = normalizeRangeMs(range);
  if (!normalized) {
    return null;
  }
  const start = formatIso(normalized.start);
  const end = formatIso(normalized.end);
  if (!start && !end) {
    return null;
  }
  return { start, end };
}

function serializePlanForConversation(plan) {
  if (!plan || typeof plan !== "object") {
    return null;
  }
  const toValues = (entries) =>
    Array.isArray(entries) ? entries.map((entry) => (entry && entry.value) || "").filter(Boolean) : [];
  const serialized = {
    intent: plan.intent || "show",
    must: toValues(plan.must),
    should: toValues(plan.should),
    exclude: toValues(plan.exclude),
    domainHints: toValues(plan.domainHints),
    phrases: toValues(plan.phrases),
    reasoning: typeof plan.reasoning === "string" ? plan.reasoning : "",
    requireModel: Boolean(plan.requireModel),
  };
  if (plan.maxResults && Number.isFinite(plan.maxResults)) {
    serialized.maxResults = plan.maxResults;
  }
  const rawRange = convertRangeToIso(plan.rawTimeRange);
  if (rawRange) {
    serialized.timeRange = rawRange;
  }
  return serialized;
}

function formatConversationRange(range) {
  if (!range || typeof range !== "object") {
    return "";
  }
  const start = typeof range.start === "string" && range.start ? range.start : "";
  const end = typeof range.end === "string" && range.end ? range.end : "";
  if (start && end) {
    return `${start} → ${end}`;
  }
  return start || end || "";
}

function formatConversationTurn(turn) {
  if (!turn || typeof turn !== "object") {
    return "";
  }
  const lines = [];
  lines.push(turn.type === "general" ? "General inquiry:" : "History request:");
  if (turn.prompt) {
    lines.push(`User: ${truncateForContext(turn.prompt, 260)}`);
  }
  if (turn.followup) {
    lines.push("Follow-up: yes");
  }
  if (turn.plan && turn.plan.intent) {
    lines.push(`Intent: ${turn.plan.intent}`);
  }
  if (turn.timeRangeIso) {
    const rangeText = formatConversationRange(turn.timeRangeIso);
    if (rangeText) {
      lines.push(`Time range: ${rangeText}`);
    }
  }
  if (turn.plan && Array.isArray(turn.plan.domainHints) && turn.plan.domainHints.length) {
    const domains = summarizeStringsForContext(turn.plan.domainHints, 3);
    if (domains) {
      lines.push(`Domain hints: ${domains}`);
    }
  }
  if (Array.isArray(turn.keywords) && turn.keywords.length) {
    const keywords = summarizeStringsForContext(turn.keywords, 5);
    if (keywords) {
      lines.push(`Keywords: ${keywords}`);
    }
  }
  if (Number.isFinite(turn.datasetSize)) {
    lines.push(`Matches considered: ${turn.datasetSize}`);
  }
  if (Number.isFinite(turn.resultsCount)) {
    lines.push(`Results shared: ${turn.resultsCount}`);
  }
  if (typeof turn.responseMessage === "string" && turn.responseMessage) {
    lines.push(`Assistant: ${truncateForContext(turn.responseMessage, 280)}`);
  }
  if (typeof turn.responseNotes === "string" && turn.responseNotes) {
    lines.push(`Notes: ${truncateForContext(turn.responseNotes, 200)}`);
  }
  if (turn.plan && typeof turn.plan.reasoning === "string" && turn.plan.reasoning) {
    lines.push(`Reasoning: ${truncateForContext(turn.plan.reasoning, 200)}`);
  }
  if (typeof turn.confidence === "number") {
    lines.push(`Confidence: ${turn.confidence.toFixed(2)}`);
  }
  if (typeof turn.source === "string" && turn.source) {
    lines.push(`Response source: ${turn.source}`);
  }
  if (Array.isArray(turn.suggestions) && turn.suggestions.length) {
    const suggestions = summarizeStringsForContext(turn.suggestions, 3);
    if (suggestions) {
      lines.push(`Suggestions: ${suggestions}`);
    }
  }
  return lines.join("\n");
}

function buildConversationContext(turns) {
  if (!Array.isArray(turns) || !turns.length) {
    return "";
  }
  const recent = turns.slice(-MAX_CONVERSATION_TURNS);
  const formatted = recent.map((turn) => formatConversationTurn(turn)).filter(Boolean);
  if (!formatted.length) {
    return "";
  }
  const segments = formatted.slice();
  let context = segments.join("\n---\n");
  while (context.length > MAX_CONVERSATION_CHARS && segments.length > 1) {
    segments.shift();
    context = segments.join("\n---\n");
  }
  if (context.length > MAX_CONVERSATION_CHARS) {
    context = context.slice(context.length - MAX_CONVERSATION_CHARS);
  }
  return context.trim();
}

function getLastHistoryTurn(state) {
  if (!state || !Array.isArray(state.conversation)) {
    return null;
  }
  for (let index = state.conversation.length - 1; index >= 0; index -= 1) {
    const entry = state.conversation[index];
    if (entry && entry.type === "history") {
      return entry;
    }
  }
  return null;
}

function gatherPlanKeywords(plan, promptKeywords = []) {
  const add = (list, value) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (list.seen.has(key)) {
      return;
    }
    list.seen.add(key);
    list.values.push(trimmed);
  };
  const data = { seen: new Set(), values: [] };
  if (plan && typeof plan === "object") {
    for (const entry of [].concat(plan.must || [], plan.should || [], plan.phrases || [])) {
      if (entry && typeof entry.value === "string") {
        add(data, entry.value);
      }
    }
  }
  if (Array.isArray(promptKeywords)) {
    for (const keyword of promptKeywords) {
      add(data, keyword);
    }
  }
  return data.values;
}

function recordConversationTurn(state, entry) {
  if (!state) {
    return;
  }
  if (!Array.isArray(state.conversation)) {
    state.conversation = [];
  }
  const now = Date.now();
  state.conversation = state.conversation.filter((turn) => {
    if (!turn || typeof turn.timestamp !== "number") {
      return true;
    }
    return now - turn.timestamp <= MAX_CONVERSATION_AGE_MS;
  });

  const response = entry && typeof entry === "object" ? entry.response || {} : {};
  const normalizedRangeMs = normalizeRangeMs(entry?.rangeMs) || null;
  const normalizedIsoRange =
    normalizeIsoRange(entry?.timeRangeIso) ||
    normalizeIsoRange(response?.timeRange) ||
    convertRangeToIso(normalizedRangeMs);

  const datasetSize = Number.isFinite(entry?.datasetSize)
    ? Math.max(0, Math.floor(entry.datasetSize))
    : Number.isFinite(response?.datasetSize)
    ? Math.max(0, Math.floor(response.datasetSize))
    : null;
  const responseResults = Array.isArray(response?.results) ? response.results.length : null;
  const resultsCount = Number.isFinite(entry?.resultsCount)
    ? Math.max(0, Math.floor(entry.resultsCount))
    : responseResults;

  const normalizedEntry = {
    type: entry?.type === "general" ? "general" : "history",
    prompt: typeof entry?.prompt === "string" ? entry.prompt.trim() : "",
    responseMessage: typeof response?.message === "string" ? response.message.trim() : "",
    responseNotes: typeof response?.notes === "string" ? response.notes.trim() : "",
    action: typeof response?.action === "string" ? response.action : "show",
    timeRangeIso: normalizedIsoRange,
    rangeMs: normalizedRangeMs,
    datasetSize,
    resultsCount,
    totalAvailable: Number.isFinite(entry?.totalAvailable)
      ? Math.max(0, Math.floor(entry.totalAvailable))
      : null,
    planSummary: typeof entry?.planSummary === "string" ? entry.planSummary : "",
    plan: serializePlanForConversation(entry?.plan),
    keywords: dedupeStrings(entry?.keywords || []),
    domains: dedupeStrings(entry?.domains || []),
    suggestions: dedupeStrings(entry?.suggestions || []),
    followup: Boolean(entry?.followup),
    confidence: typeof entry?.confidence === "number" ? Math.max(0, Math.min(1, entry.confidence)) : null,
    source: typeof entry?.source === "string" ? entry.source : null,
    timestamp: now,
  };

  state.conversation.push(normalizedEntry);
  if (state.conversation.length > MAX_CONVERSATION_TURNS) {
    state.conversation = state.conversation.slice(-MAX_CONVERSATION_TURNS);
  }
}

function isGeneralInquiryPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") {
    return false;
  }
  const collapsed = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return false;
  }
  const cleaned = collapsed.replace(/[^a-z0-9\s?]/g, " ");
  const padded = ` ${cleaned} `;

  const actionHint = HISTORY_ACTION_HINTS.some((keyword) => padded.includes(` ${keyword} `));
  const objectHint = HISTORY_OBJECT_HINTS.some((keyword) => padded.includes(` ${keyword} `));
  const hasHistoryIntent = actionHint && objectHint;

  if (hasHistoryIntent) {
    return false;
  }

  const matchesGeneralRegex = GENERAL_INQUIRY_REGEX.some((regex) => regex.test(padded));
  const containsGeneralKeyword = /\b(usef(?:ul|ull)|capab(?:le|ilities?|ility)|capabilities|abilities)\b/.test(
    padded
  );
  const helpOnly =
    /\bhelp\b/.test(padded) &&
    !/\bhelp\s+me\s+(find|show|locate|search|open|delete|clear|remove|summarize|summarise|list|look)\b/.test(
      padded
    );

  return matchesGeneralRegex || containsGeneralKeyword || helpOnly;
}

function buildGeneralInquiryPrompt(prompt, conversation) {
  const contextText = conversation
    ? `Here is the recent conversation context between you and the user:\n${conversation}\n\n`
    : "";
  return `You are the Smart History Search Assistant living inside the Spotlight interface of a web browser. ${contextText}A user who has the history filter enabled asked: """${prompt}""".\n\nRespond with JSON that matches this schema exactly:\n{\n  "message": string (a single friendly sentence that explains how you can help with browsing history),\n  "suggestions": string[] (up to four short example requests they can try next, each under 80 characters)\n}\n\nGuidelines:\n- Keep the message in the second person (e.g., "I can help you...").\n- Highlight that you understand natural language history questions and can search, open, delete, or summarize entries.\n- Tailor the wording so it feels responsive to the user's question.\n- Keep the tone professional yet approachable, similar to ChatGPT.\n- Provide diverse suggestions that demonstrate useful history-related prompts.`;
}

async function buildGeneralInquiryResponse(state, prompt, conversation) {
  const defaultMessage =
    "I'm the Spotlight history assistant. I can search, open, delete, and summarize your browsing history with natural language.";
  let message = defaultMessage;
  let suggestionList = [...GENERAL_RESPONSE_SUGGESTIONS];
  let usedModel = false;

  try {
    const session = await ensureSessionInstance(state);
    const result = await runPrompt(
      session,
      buildGeneralInquiryPrompt(prompt, conversation),
      GENERAL_GREETING_SCHEMA
    );
    const parsedMessage = typeof result?.message === "string" ? result.message.trim() : "";
    if (parsedMessage) {
      message = parsedMessage;
      usedModel = true;
    }
    if (Array.isArray(result?.suggestions)) {
      const filtered = result.suggestions
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
        .slice(0, 4);
      if (filtered.length) {
        suggestionList = filtered;
      }
    }
  } catch (error) {
    console.warn("Spotlight: general inquiry prompt failed", error);
  }

  const suggestionText = suggestionList.length
    ? `Here are a few ideas: ${suggestionList.map((example) => `"${example}"`).join(" ")}`
    : "";

  return {
    response: {
      action: "show",
      message,
      notes: suggestionText,
      results: [],
      timeRange: null,
      datasetSize: 0,
      confidence: 1,
    },
    usedModel,
    suggestions: suggestionList,
  };
}

function itemMatchesKeyword(item, keyword) {
  if (!item || !keyword) {
    return false;
  }
  const normalized = keyword.toLowerCase();
  if (!normalized) {
    return false;
  }
  const title = typeof item.title === "string" ? item.title.toLowerCase() : "";
  const url = typeof item.url === "string" ? item.url.toLowerCase() : "";
  const origin = typeof item.origin === "string" ? item.origin.toLowerCase() : "";
  return title.includes(normalized) || url.includes(normalized) || origin.includes(normalized);
}

function normalizePlanArray(value) {
  if (!value) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  const result = [];
  const seen = new Set();
  for (const entry of values) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push({ value: trimmed, normalized });
  }
  return result;
}

function normalizeDomainHint(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    if (url.hostname) {
      return url.hostname.toLowerCase();
    }
  } catch (err) {
    // fall through to fallback parsing
  }
  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
}

function removeStopKeywordEntries(entries, removedCollector) {
  if (!Array.isArray(entries) || !entries.length) {
    return [];
  }
  const result = [];
  for (const entry of entries) {
    if (!entry || typeof entry.normalized !== "string") {
      continue;
    }
    const normalized = entry.normalized;
    if (FILTER_STOP_KEYWORDS.has(normalized)) {
      if (removedCollector && typeof removedCollector.add === "function") {
        const label = typeof entry.value === "string" && entry.value.trim() ? entry.value.trim() : normalized;
        removedCollector.add(label);
      }
      continue;
    }
    result.push(entry);
  }
  return result;
}

function extractHostname(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }
  return normalizeDomainHint(value);
}

function hostMatchesDomain(host, domain) {
  if (!host || !domain) {
    return false;
  }
  if (host === domain) {
    return true;
  }
  return host.endsWith(`.${domain}`);
}

function normalizePromptKeywords(keywords) {
  if (!Array.isArray(keywords) || !keywords.length) {
    return [];
  }
  return normalizePlanArray(
    keywords
      .map((keyword) => (typeof keyword === "string" ? keyword : ""))
      .filter(Boolean)
  );
}

function mergeEntrySets(primary, fallback) {
  const result = [];
  const seen = new Set();
  for (const entry of [].concat(primary || [], fallback || [])) {
    if (!entry || !entry.normalized) {
      continue;
    }
    if (seen.has(entry.normalized)) {
      continue;
    }
    seen.add(entry.normalized);
    result.push(entry);
  }
  return result;
}

function parseSearchPlan(rawPlan, fallbackIntent = "show") {
  const planObject = rawPlan && typeof rawPlan === "object" ? rawPlan : {};
  const intent = normalizeAction(planObject.intent || fallbackIntent);
  const must = normalizePlanArray(planObject.mustInclude);
  const should = normalizePlanArray(planObject.shouldInclude);
  const exclude = normalizePlanArray(planObject.exclude);
  const domainValues = Array.isArray(planObject.domainHints)
    ? planObject.domainHints.map((value) => normalizeDomainHint(value)).filter(Boolean)
    : [];
  const domainHints = normalizePlanArray(domainValues);
  const phrases = normalizePlanArray(planObject.searchPhrases);
  const maxResults = Number.isFinite(planObject.maxResults) ? Math.max(1, Math.floor(planObject.maxResults)) : null;
  const requireModel = Boolean(planObject.requireModel);
  const reasoning = typeof planObject.reasoning === "string" ? planObject.reasoning.trim() : "";
  const rawTimeRange = planObject.timeRange && typeof planObject.timeRange === "object" ? planObject.timeRange : null;
  return {
    intent,
    must,
    should,
    exclude,
    domainHints,
    phrases,
    maxResults,
    requireModel,
    reasoning,
    rawTimeRange,
  };
}

function applySearchPlanToItems(items, plan, promptKeywords = []) {
  const emptyMeta = {
    domains: [],
    required: [],
    optional: [],
    phrases: [],
    removedStopwords: [],
  };

  if (!Array.isArray(items)) {
    return { items: [], meta: emptyMeta };
  }

  const removedStopwordSet = new Set();
  const fallbackOptional = removeStopKeywordEntries(normalizePromptKeywords(promptKeywords), removedStopwordSet);
  const mustEntries = removeStopKeywordEntries(Array.isArray(plan?.must) ? plan.must : [], removedStopwordSet);
  const shouldEntries = removeStopKeywordEntries(Array.isArray(plan?.should) ? plan.should : [], removedStopwordSet);
  const optionalEntries = shouldEntries.length ? mergeEntrySets(shouldEntries, fallbackOptional) : fallbackOptional;
  const excludeEntries = Array.isArray(plan?.exclude) ? plan.exclude : [];
  const domainEntries = Array.isArray(plan?.domainHints) ? plan.domainHints : [];
  const phraseEntries = Array.isArray(plan?.phrases) ? plan.phrases : [];

  const annotated = [];

  for (const item of items) {
    if (!item) {
      continue;
    }

    if (excludeEntries.length && excludeEntries.some((entry) => itemMatchesKeyword(item, entry.normalized))) {
      continue;
    }

    const host = typeof item.host === "string" && item.host ? item.host.toLowerCase() : "";
    const originHost = extractHostname(item.origin);
    const urlHost = extractHostname(item.url);

    const domainMatches = domainEntries.filter((entry) => {
      const normalized = entry.normalized;
      return (
        (host && hostMatchesDomain(host, normalized)) ||
        (originHost && hostMatchesDomain(originHost, normalized)) ||
        (urlHost && hostMatchesDomain(urlHost, normalized))
      );
    });
    if (domainEntries.length && !domainMatches.length) {
      continue;
    }

    const mustMatches = mustEntries.filter((entry) => itemMatchesKeyword(item, entry.normalized));
    if (mustEntries.length && mustMatches.length !== mustEntries.length) {
      continue;
    }

    const optionalMatches = optionalEntries.filter((entry) => itemMatchesKeyword(item, entry.normalized));
    const phraseMatches = phraseEntries.filter((entry) => itemMatchesKeyword(item, entry.normalized));

    let score = Number(item.lastVisitTime) || 0;
    if (!Number.isFinite(score)) {
      score = 0;
    }

    score += mustMatches.length * 6 * 60 * 60 * 1000;
    score += optionalMatches.length * 4 * 60 * 60 * 1000;
    score += phraseMatches.length * 3 * 60 * 60 * 1000;
    score += domainMatches.length * 5 * 60 * 60 * 1000;

    if (plan?.intent === "summarize" && typeof item.visitCount === "number") {
      score += Math.min(48, item.visitCount) * 30 * 60 * 1000;
    }

    annotated.push({
      item,
      score,
      matches: {
        required: mustMatches.map((entry) => entry.value),
        optional: optionalMatches.map((entry) => entry.value),
        phrases: phraseMatches.map((entry) => entry.value),
        domains: domainMatches.map((entry) => entry.value),
      },
    });
  }

  annotated.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aVisits = typeof a.item.visitCount === "number" ? a.item.visitCount : 0;
    const bVisits = typeof b.item.visitCount === "number" ? b.item.visitCount : 0;
    if (bVisits !== aVisits) {
      return bVisits - aVisits;
    }
    const aTime = Number(a.item.lastVisitTime) || 0;
    const bTime = Number(b.item.lastVisitTime) || 0;
    return bTime - aTime;
  });

  if (plan?.maxResults && Number.isFinite(plan.maxResults)) {
    const limit = Math.max(1, Math.min(MAX_DATASET_ENTRIES, Math.floor(plan.maxResults)));
    annotated.splice(limit);
  }

  const meta = {
    domains: domainEntries.map((entry) => entry.value),
    required: mustEntries.map((entry) => entry.value),
    optional: optionalEntries.map((entry) => entry.value),
    phrases: phraseEntries.map((entry) => entry.value),
    removedStopwords: Array.from(removedStopwordSet),
  };

  if (DEV_MODE && (meta.domains.length || meta.optional.length || meta.required.length || meta.removedStopwords.length)) {
    console.debug("Spotlight history assistant filters", {
      domains: meta.domains,
      keywords: {
        required: meta.required,
        optional: meta.optional,
        phrases: meta.phrases,
      },
      removedStopwords: meta.removedStopwords,
    });
  }

  return { items: annotated, meta };
}

function summarizePlan(plan) {
  if (!plan) {
    return "Intent: show\nNo additional filters were derived.";
  }
  const parts = [`Intent: ${plan.intent}`];
  if (plan.must && plan.must.length) {
    parts.push(`Must include: ${plan.must.map((entry) => entry.value).join(", ")}`);
  }
  if (plan.should && plan.should.length) {
    parts.push(`Should include: ${plan.should.map((entry) => entry.value).join(", ")}`);
  }
  if (plan.domainHints && plan.domainHints.length) {
    parts.push(`Domain hints: ${plan.domainHints.map((entry) => entry.value).join(", ")}`);
  }
  if (plan.exclude && plan.exclude.length) {
    parts.push(`Exclude: ${plan.exclude.map((entry) => entry.value).join(", ")}`);
  }
  if (plan.phrases && plan.phrases.length) {
    parts.push(`Search phrases: ${plan.phrases.map((entry) => entry.value).join(", ")}`);
  }
  if (plan.maxResults) {
    parts.push(`Max results requested: ${plan.maxResults}`);
  }
  if (plan.requireModel) {
    parts.push("Model reasoning required: true");
  }
  if (plan.reasoning) {
    parts.push(`Reasoning: ${plan.reasoning}`);
  }
  return parts.join("\n");
}

function dedupeByUrl(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item || typeof item.url !== "string") {
      continue;
    }
    const key = item.url.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function toDatasetEntry(item, annotations = {}) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const lastVisitIso = formatIso(item.lastVisitTime);
  const hostname = (() => {
    try {
      const parsed = new URL(item.url);
      return parsed.hostname || "";
    } catch (err) {
      return "";
    }
  })();
  const entry = {
    id: item.id,
    title: item.title || item.url || "Untitled",
    url: item.url,
    host: hostname,
    lastVisitTime: lastVisitIso,
    visitCount: typeof item.visitCount === "number" ? item.visitCount : 0,
  };
  if (annotations && typeof annotations === "object") {
    for (const [key, value] of Object.entries(annotations)) {
      if (value === undefined) {
        continue;
      }
      entry[key] = value;
    }
  }
  return entry;
}

function buildSummaryAnalytics(dataset, planKeywords = [], planDomains = []) {
  const entries = Array.isArray(dataset) ? dataset.filter((entry) => entry && typeof entry === "object") : [];
  const hostMap = new Map();
  const dayMap = new Map();
  const keywordMap = new Map();
  let highlights = [];
  let totalVisitCount = 0;

  const planDomainList = Array.isArray(planDomains)
    ? planDomains
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];
  const normalizedPlanDomains = planDomainList.map((domain) => normalizeDomainHint(domain)).filter(Boolean);

  for (const entry of entries) {
    const visitCount = Number(entry.visitCount) || 0;
    totalVisitCount += visitCount;

    const host = typeof entry.host === "string" ? entry.host.toLowerCase() : "";
    if (host) {
      if (!hostMap.has(host)) {
        hostMap.set(host, { host, count: 0, visitCount: 0 });
      }
      const hostStat = hostMap.get(host);
      hostStat.count += 1;
      hostStat.visitCount += visitCount;
    }

    if (typeof entry.lastVisitTime === "string" && entry.lastVisitTime) {
      const dayKey = entry.lastVisitTime.slice(0, 10);
      if (dayKey) {
        if (!dayMap.has(dayKey)) {
          dayMap.set(dayKey, { day: dayKey, count: 0 });
        }
        const dayStat = dayMap.get(dayKey);
        dayStat.count += 1;
      }
    }

    if (typeof entry.title === "string" && entry.title) {
      const tokens = entry.title.toLowerCase().match(/[a-z0-9]+/g);
      if (tokens) {
        const seen = new Set();
        for (const token of tokens) {
          if (STOP_WORDS.has(token) || TIME_WORDS.has(token) || NUMBER_WORDS.has(token)) {
            continue;
          }
          if (/^\d+$/.test(token)) {
            continue;
          }
          if (token.length < 3) {
            continue;
          }
          if (seen.has(token)) {
            continue;
          }
          seen.add(token);
          keywordMap.set(token, (keywordMap.get(token) || 0) + 1);
        }
      }
    }

    if (highlights.length < SUMMARY_HIGHLIGHT_LIMIT) {
      highlights.push({
        title: entry.title || "Untitled",
        host: entry.host || "",
        lastVisitTime: entry.lastVisitTime || null,
        visitCount,
        url: entry.url || "",
      });
    }
  }

  const topHosts = Array.from(hostMap.values())
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return b.visitCount - a.visitCount;
    })
    .slice(0, SUMMARY_TOP_HOSTS_LIMIT);

  let focusHosts = topHosts;
  if (normalizedPlanDomains.length) {
    const filteredHosts = topHosts.filter((hostEntry) =>
      normalizedPlanDomains.some((domain) => hostMatchesDomain(hostEntry.host, domain))
    );
    if (filteredHosts.length) {
      focusHosts = filteredHosts;
    }
  }

  const topKeywords = Array.from(keywordMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, SUMMARY_TOP_KEYWORDS_LIMIT)
    .map(([keyword, count]) => ({ keyword, count }));

  const dayBuckets = Array.from(dayMap.values()).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  if (normalizedPlanDomains.length) {
    const filteredHighlights = highlights.filter((entry) => {
      const host = typeof entry.host === "string" ? entry.host.toLowerCase() : "";
      return normalizedPlanDomains.some((domain) => hostMatchesDomain(host, domain));
    });
    if (filteredHighlights.length) {
      highlights = filteredHighlights;
    }
  }

  const planKeywordList = Array.isArray(planKeywords)
    ? planKeywords.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())
    : [];

  return {
    entries,
    totalEntries: entries.length,
    uniqueHosts: hostMap.size,
    totalVisitCount,
    topHosts: focusHosts,
    topKeywords,
    dayBuckets,
    highlights,
    planKeywords: planKeywordList,
    planDomains: planDomainList,
  };
}

function buildSummaryNarrativePrompt({
  prompt,
  nowIso,
  timeRange,
  rangeLabel,
  analytics,
  followup,
  conversation,
}) {
  const rangeText = rangeLabel ? `${rangeLabel}` : "Unknown";
  const hostJson = JSON.stringify(analytics.topHosts, null, 2);
  const keywordJson = JSON.stringify(analytics.topKeywords, null, 2);
  const dayJson = JSON.stringify(analytics.dayBuckets, null, 2);
  const highlightJson = JSON.stringify(analytics.highlights, null, 2);
  const conversationText = conversation ? `\nConversation context:\n${conversation}` : "";
  const planKeywordText = analytics.planKeywords.length ? analytics.planKeywords.join(", ") : "(none)";
  const planDomainText = analytics.planDomains.length ? analytics.planDomains.join(", ") : "(none)";
  const followupText = followup ? "yes" : "no";
  const totalVisitsText = Number.isFinite(analytics.totalVisitCount)
    ? analytics.totalVisitCount
    : 0;
  const sufficiency =
    analytics.totalEntries >= 6
      ? "ample"
      : analytics.totalEntries >= 3
      ? "moderate"
      : analytics.totalEntries > 0
      ? "sparse"
      : "empty";
  return `You are the Smart History Search Assistant. Craft a professional, friendly summary similar to ChatGPT.${conversationText}

Current UTC time: ${nowIso}
Follow-up request: ${followupText}
User request: """${prompt}"""
Time range: ${rangeText}
Detected ISO range: ${
    timeRange && timeRange.start && timeRange.end
      ? `${timeRange.start} to ${timeRange.end}`
      : "unknown"
  }
Entries analyzed: ${analytics.totalEntries}
Unique sites: ${analytics.uniqueHosts}
Aggregate visit count (approximate time investment): ${totalVisitsText}
Plan keywords: ${planKeywordText}
Plan domain hints (treat as strict focus): ${planDomainText}
Data sufficiency classification: ${sufficiency}

Top sites by activity:
${hostJson}

Top recurring keywords:
${keywordJson}

Daily activity counts (ISO date, matches per day):
${dayJson}

Recent highlights (most recent first):
${highlightJson}

Instructions:
- Open with a short line that frames the summary and repeats the natural-language time window, similar to "Here’s a short summary of what you’ve done...".
- Include at least two titled sections with emoji headers (for example, "🧠 Main Focus Areas" and "💻 Tech & Product Browsing").
- Highlight the main topics, frequently visited domains, and any notable patterns in how time was spent.
- Reference hosts, titles, or keywords from the data to make the summary feel specific and useful.
- Close with an overall takeaway sentence.
- Use Markdown bullet lists inside the sections. Keep the whole message under 1,200 characters.
- Stay focused on the requested scope. If domain hints are provided, ignore unrelated sites and highlight only matching activity.
- Do not mention JSON, schemas, instructions, or how you interpreted the request. Never reference the Prompt API or internal reasoning.
- Do not describe what you are going to do. Provide the user-facing summary directly.
- If the data is classified as "sparse" or "empty", acknowledge the limited history and keep the summary brief (you may mention that there is not enough data).

Respond with JSON only:
{
  "message": string,
  "notes": string (optional)
}`;
}


function buildSummaryFallbackMessage(analytics, rangeLabel) {
  const headerRange = rangeLabel ? `${rangeLabel}` : "your recent history";
  const lines = [];
  lines.push(`Here’s a quick summary of ${headerRange}:`);
  lines.push("");
  if (analytics.totalEntries > 0 && analytics.totalEntries < 3) {
    lines.push("🧠 Main Focus Areas");
    lines.push("- Not enough browsing history to surface strong themes yet.");
    lines.push("");
    lines.push("🕒 Activity Snapshot");
    lines.push(`- Reviewed ${analytics.totalEntries === 1 ? "1 entry" : `${analytics.totalEntries} entries`} across ${
      analytics.uniqueHosts === 1 ? "1 site" : `${analytics.uniqueHosts} sites`
    }.`);
    lines.push("");
    lines.push("🧩 Overall Summary");
    lines.push("- Try broadening the time range or exploring more sites for richer insights.");
    return lines.join("\n");
  }
  lines.push("🧠 Main Focus Areas");
  if (analytics.topHosts.length) {
    for (const host of analytics.topHosts.slice(0, 3)) {
      lines.push(`- ${host.host} — ${host.count} visits${host.visitCount ? ` (approx. ${host.visitCount} total hits)` : ""}`);
    }
  } else {
    lines.push("- Activity was spread across a variety of sites.");
  }
  lines.push("");
  lines.push("🔍 Frequent Topics");
  if (analytics.topKeywords.length) {
    const keywordBullets = analytics.topKeywords.slice(0, 5).map((entry) => entry.keyword);
    lines.push(`- ${keywordBullets.join(", ")}`);
  } else {
    lines.push("- No clear recurring topics surfaced.");
  }
  lines.push("");
  lines.push("🧩 Overall Summary");
  const totalEntriesText = analytics.totalEntries === 1 ? "1 history entry" : `${analytics.totalEntries} history entries`;
  const uniqueHostsText = analytics.uniqueHosts === 1 ? "1 site" : `${analytics.uniqueHosts} sites`;
  lines.push(`- Reviewed ${totalEntriesText} across ${uniqueHostsText}.`);
  return lines.join("\n");
}

function gatherPlanDomains(plan) {
  const domains = [];
  const seen = new Set();
  if (plan && Array.isArray(plan.domainHints)) {
    for (const entry of plan.domainHints) {
      if (!entry || typeof entry.value !== "string") {
        continue;
      }
      const trimmed = entry.value.trim();
      if (!trimmed) {
        continue;
      }
      const lower = trimmed.toLowerCase();
      if (seen.has(lower)) {
        continue;
      }
      seen.add(lower);
      domains.push(trimmed);
    }
  }
  return domains;
}

function isSummaryMetaMessage(message) {
  if (typeof message !== "string") {
    return true;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.length > 1800) {
    return true;
  }
  for (const pattern of SUMMARY_META_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  return false;
}

async function generateSummaryNarrative(session, options) {
  if (!options || !options.analytics || !options.analytics.entries.length) {
    return null;
  }
  const rangeLabel = formatFriendlyRange(options.timeRange);
  const prompt = buildSummaryNarrativePrompt({
    prompt: options.prompt,
    nowIso: options.nowIso,
    timeRange: options.timeRange,
    rangeLabel,
    analytics: options.analytics,
    followup: options.followup,
    conversation: options.conversation,
  });

  if (!session) {
    return {
      message: buildSummaryFallbackMessage(options.analytics, rangeLabel),
      notes: "Summary generated locally (Prompt API unavailable).",
      usedModel: false,
    };
  }

  let fallbackNote = "Summary generated locally (Prompt API fallback).";

  try {
    const response = await runPrompt(session, prompt, SUMMARY_MESSAGE_SCHEMA);
    const parsedMessage = response && typeof response.message === "string" ? response.message.trim() : "";
    const parsedNotes = response && typeof response.notes === "string" ? response.notes.trim() : "";
    if (parsedMessage && !isSummaryMetaMessage(parsedMessage)) {
      return {
        message: parsedMessage,
        notes: parsedNotes,
        usedModel: true,
      };
    }
    if (parsedMessage) {
      console.warn("Spotlight: summary narrative flagged as meta", { preview: parsedMessage.slice(0, 160) });
      fallbackNote = "Summary generated locally (model output filtered).";
    }
  } catch (error) {
    console.warn("Spotlight: summary narrative generation failed", error);
    fallbackNote = "Summary generated locally (Prompt API error).";
  }

  return {
    message: buildSummaryFallbackMessage(options.analytics, rangeLabel),
    notes: fallbackNote,
    usedModel: false,
  };
}

function buildInterpretationPrompt({
  prompt,
  dataset,
  nowIso,
  range,
  confidence,
  planSummary,
  datasetSize,
  totalAvailable,
  maxReturn,
  conversation,
  followup,
}) {
  const datasetJson = JSON.stringify(dataset, null, 2);
  const rangeText = range ? `\nDetected range: ${range.start} to ${range.end}` : "";
  const confidenceText = Number.isFinite(confidence) ? `\nTime range confidence: ${confidence.toFixed(2)}` : "";
  const summaryText = planSummary ? `\nSearch plan:\n${planSummary}` : "";
  const datasetInfo = `\nProvided dataset entries: ${dataset.length} (focused from ${datasetSize} plan matches, ${totalAvailable} total in range)`;
  const returnLimit = Math.max(1, Math.min(MAX_RESULT_IDS, maxReturn || MAX_RESULT_IDS));
  const conversationText = conversation ? `\nConversation context:\n${conversation}` : "";
  const followupText = followup
    ? "\nFollow-up request: yes. Use the conversation context to interpret references back to previous answers."
    : "\nFollow-up request: no.";
  return `You are the Smart History Search Assistant. Interpret the user's request using the provided browser history entries.${followupText}${conversationText}\n\nCurrent UTC time: ${nowIso}${rangeText}${confidenceText}${summaryText}${datasetInfo}\nUser request: """${prompt}"""\n\nThe dataset below contains browser history entries in reverse chronological order. Only use these entries when selecting results. Return JSON that matches this schema exactly:\n{\n  "action": "show" | "open" | "delete" | "summarize" | "unknown",\n  "outputMessage": string,\n  "filteredResultIds": number[],\n  "notes": string (optional explanatory text)\n}\n\nRules:\n- Choose result ids only from the dataset.\n- Limit filteredResultIds to at most ${returnLimit} entries, ordered by relevance.\n- Prefer entries that match the user's intent, domains, or topics.\n- When the user asks for "all" or a broad result, include as many entries as allowed by the limit.\n- If nothing matches, return an empty filteredResultIds array and craft a helpful outputMessage explaining that no history was found.\n- Use the "delete" action only if the user clearly wants to remove history entries.\n- Use the "open" action only if the user wants tabs reopened. Otherwise default to "show".\n- Summaries should still list relevant result ids.\n- Write the outputMessage in a professional yet friendly tone, similar to ChatGPT.\n- Respond with JSON only.\n\nHistory dataset:\n${datasetJson}`;
}

function buildTimeRangePrompt(prompt, nowIso, conversation, followup) {
  const followupText = followup
    ? "\nThe user is following up on an earlier request. Use the conversation context to resolve implicit references."
    : "";
  const conversationText = conversation ? `\nConversation context:\n${conversation}` : "";
  return `You analyze natural language history queries and extract an explicit UTC time range.${followupText}${conversationText}\n\nCurrent UTC time: ${nowIso}\nUser request: """${prompt}"""\n\nRespond with JSON only:\n{\n  "timeRange": { "start": "<ISO8601 UTC>", "end": "<ISO8601 UTC>" } | null,\n  "confidence": number between 0 and 1 (optional)\n}\n\nGuidance:\n- Interpret relative phrases like "past 3 hours" or "23 minutes ago".\n- When the request mentions a single instant (for example "around 9 PM"), create a narrow window that includes that instant.\n- Clamp the end time so it is not in the future.\n- If you cannot determine a range, return null.`;
}

function buildSearchPlanPrompt({ prompt, nowIso, range, confidence, keywords, conversation, followup }) {
  const keywordText = keywords?.length ? keywords.join(", ") : "(none)";
  const rangeText = range ? `start=${range.start}, end=${range.end}` : "(none)";
  const confidenceText = Number.isFinite(confidence) ? confidence.toFixed(2) : "unknown";
  const conversationText = conversation ? `Conversation context:\n${conversation}\n\n` : "";
  const followupText = followup ? "yes" : "no";
  return `You are a planning agent that translates natural language history questions into structured search filters.\nFollow-up request: ${followupText}.\n${conversationText}Current UTC time: ${nowIso}\nUser request: """${prompt}"""\nHeuristic time range: ${rangeText}\nHeuristic confidence: ${confidenceText}\nCandidate keywords from prompt: ${keywordText}\n\nRespond with JSON only:\n{\n  "intent": "show" | "open" | "delete" | "summarize" | "unknown",\n  "mustInclude": string[] (terms that must appear),\n  "shouldInclude": string[] (terms to boost),\n  "exclude": string[] (terms to remove),\n  "domainHints": string[] (hostnames or domains),\n  "searchPhrases": string[] (longer phrases to match),\n  "timeRange": { "start": "<ISO8601 UTC>", "end": "<ISO8601 UTC>" } | null,\n  "maxResults": number (desired result cap),\n  "requireModel": boolean (true if model reasoning is essential),\n  "reasoning": string (brief explanation)\n}\n\nGuidance:\n- Reuse the heuristic range if it fits the request; otherwise tighten or broaden it as needed.\n- Include hostnames (like "youtube.com") in domainHints when the request targets a site.\n- Increase maxResults when the user asks for "all" or a broad list, up to ${MAX_RESULT_IDS}.\n- Set requireModel to true when semantic understanding beyond keyword filtering is necessary.\n- When the request is a follow-up, reuse relevant domains, keywords, or time windows from the conversation context.\n- Leave arrays empty when they are not needed.`;
}

async function ensureSessionInstance(state) {
  if (state.sessionInstance) {
    return state.sessionInstance;
  }
  if (state.sessionPromise) {
    return state.sessionPromise;
  }
  if (typeof globalThis.LanguageModel !== "object" && typeof globalThis.LanguageModel !== "function") {
    throw new Error("Prompt API unavailable");
  }
  state.sessionPromise = globalThis.LanguageModel.create({
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
    .then((session) => {
      state.sessionInstance = session;
      state.sessionPromise = null;
      return session;
    })
    .catch((error) => {
      state.sessionPromise = null;
      throw error;
    });
  return state.sessionPromise;
}

async function runPrompt(session, text, schema) {
  const raw = await session.prompt(text, schema ? { responseConstraint: schema } : undefined);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("History assistant returned invalid JSON");
  }
}

function selectHistoryItems(items, range) {
  if (!Array.isArray(items)) {
    return [];
  }
  const { start, end } = range || {};
  return items
    .filter((item) => {
      if (!item || item.type !== "history") {
        return false;
      }
      const timestamp = Number(item.lastVisitTime) || 0;
      if (!Number.isFinite(timestamp)) {
        return false;
      }
      if (Number.isFinite(start) && timestamp < start) {
        return false;
      }
      if (Number.isFinite(end) && timestamp > end) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aTime = Number(a.lastVisitTime) || 0;
      const bTime = Number(b.lastVisitTime) || 0;
      return bTime - aTime;
    });
}

function createResultPayload(item) {
  if (!item) {
    return null;
  }
  const payload = {
    id: item.id,
    type: item.type,
    title: item.title || item.url || "Untitled",
    url: item.url,
    description: item.url || "",
    lastVisitTime: item.lastVisitTime || null,
    visitCount: item.visitCount,
    origin: item.origin,
    historyAssistant: true,
  };
  if (item.faviconUrl) {
    payload.faviconUrl = item.faviconUrl;
  } else if (item.favIconUrl) {
    payload.faviconUrl = item.favIconUrl;
  }
  return payload;
}

function maybeHandleLocally({
  prompt,
  annotatedItems,
  limit = LOCAL_RESULT_LIMIT,
  range,
  confidence,
  plan,
  followup = false,
}) {
  const intent = plan?.intent || detectPromptAction(prompt);
  if (intent !== "show") {
    return null;
  }
  if (plan?.requireModel) {
    return null;
  }
  if (!Array.isArray(annotatedItems) || !annotatedItems.length) {
    return null;
  }

  const maxPlanLimit = plan?.maxResults && Number.isFinite(plan.maxResults) ? plan.maxResults : null;
  const limitCandidates = [Math.max(1, limit), LOCAL_RESULT_LIMIT, MAX_RESULT_IDS];
  if (maxPlanLimit) {
    limitCandidates.push(Math.max(1, Math.floor(maxPlanLimit)));
  }
  const effectiveLimit = Math.max(1, Math.min(...limitCandidates));
  const limitedItems = annotatedItems.slice(0, effectiveLimit);
  const results = limitedItems.map((entry) => createResultPayload(entry.item)).filter(Boolean);
  if (!results.length) {
    return null;
  }

  const planKeywords = [];
  if (Array.isArray(plan?.must) && plan.must.length) {
    planKeywords.push(...plan.must.map((entry) => entry.value));
  }
  if (Array.isArray(plan?.should) && plan.should.length) {
    planKeywords.push(...plan.should.map((entry) => entry.value));
  }
  if (!planKeywords.length) {
    planKeywords.push(...extractMeaningfulKeywords(prompt));
  }
  const uniqueKeywords = Array.from(new Set(planKeywords.filter(Boolean)));

  let message;
  if (uniqueKeywords.length) {
    const keywordText = uniqueKeywords.map((keyword) => `"${keyword}"`).join(", ");
    message = followup
      ? `Here's an updated set of history entries matching ${keywordText}.`
      : `I found history entries that match ${keywordText}.`;
  } else {
    message = followup
      ? "Here's an updated view of your recent history."
      : "Here's what I found in your history for that time frame.";
  }

  const totalCount = annotatedItems.length;
  const notesParts = [];
  notesParts.push(totalCount === 1 ? "Found 1 matching entry." : `Found ${totalCount} matching entries.`);
  if (results.length < totalCount) {
    notesParts.push(
      `Showing the first ${results.length}. Ask me to narrow it down for more precise results.`
    );
  }
  if (plan?.reasoning) {
    notesParts.push(plan.reasoning);
  }
  notesParts.push(
    followup
      ? "Tell me if you'd like to adjust the filters further."
      : "Feel free to ask follow-up questions to refine the list."
  );

  return {
    action: "show",
    message,
    notes: notesParts.join(" ").trim(),
    results,
    timeRange: range,
    datasetSize: totalCount,
    confidence: typeof confidence === "number" ? confidence : null,
  };
}

function buildFallbackMessage(range) {
  if (!range) {
    return "Here are the history results I found.";
  }
  try {
    const start = new Date(range.start).toLocaleString();
    const end = new Date(range.end).toLocaleString();
    return `Here are the history results between ${start} and ${end}.`;
  } catch (err) {
    return "Here are the history results I found.";
  }
}

async function performDelete(items, scheduleRebuild) {
  if (!Array.isArray(items) || !items.length) {
    return { deleted: 0 };
  }
  const uniqueUrls = new Set();
  const targets = [];
  for (const item of items) {
    if (!item || typeof item.url !== "string") {
      continue;
    }
    const key = item.url;
    if (uniqueUrls.has(key)) {
      continue;
    }
    uniqueUrls.add(key);
    targets.push(item.url);
  }
  let deleted = 0;
  for (const url of targets) {
    try {
      await browser.history.deleteUrl({ url });
      deleted += 1;
    } catch (err) {
      console.warn("Spotlight: failed to delete history entry", err);
    }
  }
  if (typeof scheduleRebuild === "function" && deleted > 0) {
    scheduleRebuild(400);
  }
  return { deleted };
}

async function performOpen(items) {
  if (!Array.isArray(items) || !items.length) {
    return { opened: 0 };
  }
  const uniqueUrls = new Set();
  let opened = 0;
  for (const item of items.slice(0, MAX_ACTION_TABS)) {
    if (!item || typeof item.url !== "string" || !item.url) {
      continue;
    }
    if (uniqueUrls.has(item.url)) {
      continue;
    }
    uniqueUrls.add(item.url);
    try {
      await browser.tabs.create({ url: item.url });
      opened += 1;
    } catch (err) {
      console.warn("Spotlight: failed to open history entry", err);
    }
  }
  return { opened };
}

export function createHistoryAssistantService(options = {}) {
  const state = {
    sessionInstance: null,
    sessionPromise: null,
    conversation: [],
  };
  const { scheduleRebuild } = options;

  async function analyzeHistoryRequest({ prompt, items, now = Date.now(), progress }) {
    const progressCallback = typeof progress === "function" ? progress : null;
    let progressFailed = false;
    const reportProgress = (stage, info = {}) => {
      if (!progressCallback || progressFailed) {
        return;
      }
      if (typeof stage !== "string" || !stage) {
        return;
      }
      const payload = { stage };
      if (typeof info.message === "string" && info.message) {
        payload.message = info.message;
      }
      if (info.details && typeof info.details === "object") {
        payload.details = info.details;
      }
      try {
        progressCallback(payload);
      } catch (err) {
        progressFailed = true;
        console.warn("Spotlight: history assistant progress callback failed", err);
      }
    };

    reportProgress("understanding-request", { message: "Understanding your request…" });
    const trimmed = typeof prompt === "string" ? prompt.trim() : "";
    if (!trimmed) {
      throw new Error("Enter a history request to analyze");
    }
    const conversationContext = buildConversationContext(state.conversation);
    const lastHistoryTurn = getLastHistoryTurn(state);
    const followupCandidate = isLikelyFollowupPrompt(trimmed);
    const isFollowup = followupCandidate && Boolean(lastHistoryTurn);

    if (isGeneralInquiryPrompt(trimmed)) {
      reportProgress("general-inquiry", { message: "Gathering browsing insights…" });
      const generalInquiry = await buildGeneralInquiryResponse(state, trimmed, conversationContext);
      recordConversationTurn(state, {
        type: "general",
        prompt: trimmed,
        response: generalInquiry.response,
        suggestions: generalInquiry.suggestions,
        source: generalInquiry.usedModel ? "promptApi" : "fallback",
      });
      console.info("Spotlight history assistant general inquiry", {
        prompt: trimmed,
        handled: "general",
        responseSource: generalInquiry.usedModel ? "promptApi" : "fallback",
        suggestionCount: Array.isArray(generalInquiry.suggestions)
          ? generalInquiry.suggestions.length
          : 0,
        contextTurns: Array.isArray(state.conversation) ? state.conversation.length : 0,
      });
      reportProgress("preparing-response", { message: "Preparing response…" });
      return generalInquiry.response;
    }
    const nowIso = new Date(now).toISOString();
    let promptKeywords = extractMeaningfulKeywords(trimmed);
    const keywordSet = new Set(promptKeywords);
    if (isFollowup && lastHistoryTurn && Array.isArray(lastHistoryTurn.keywords)) {
      for (const keyword of lastHistoryTurn.keywords) {
        if (typeof keyword !== "string") {
          continue;
        }
        const normalizedKeyword = keyword.toLowerCase();
        if (normalizedKeyword && !keywordSet.has(normalizedKeyword)) {
          promptKeywords.push(normalizedKeyword);
          keywordSet.add(normalizedKeyword);
        }
      }
    }
    const heuristicIntent = detectPromptAction(trimmed);
    let session = null;
    let detectedRangeInfo = deriveTimeRangeFromPrompt(trimmed, now);
    let detectedRange = detectedRangeInfo?.range || null;
    let confidence = typeof detectedRangeInfo?.confidence === "number" ? detectedRangeInfo.confidence : null;

    reportProgress("detecting-range", { message: "Determining relevant time range…" });

    if (!detectedRange && isFollowup && lastHistoryTurn?.rangeMs) {
      detectedRange = { ...lastHistoryTurn.rangeMs };
      confidence = typeof confidence === "number" ? Math.max(confidence, 0.6) : 0.6;
    }

    if (!detectedRange) {
      session = await ensureSessionInstance(state);
      try {
        const timeResponse = await runPrompt(
          session,
          buildTimeRangePrompt(trimmed, nowIso, conversationContext, isFollowup),
          TIME_RANGE_SCHEMA
        );
        const clamped = clampTimeRange(timeResponse?.timeRange, now);
        if (clamped) {
          detectedRange = clamped;
        }
        if (typeof timeResponse?.confidence === "number") {
          confidence = Math.max(0, Math.min(1, timeResponse.confidence));
        }
      } catch (err) {
        console.warn("Spotlight: time range detection failed", err);
      }
    }

    if (!detectedRange) {
      detectedRange = fallbackTimeRange(now);
    }

    const heuristicRangeIso = {
      start: formatIso(detectedRange.start),
      end: formatIso(detectedRange.end),
    };

    if (detectedRange) {
      reportProgress("range-determined", {
        message: "Identified the most relevant time range.",
        details: { start: heuristicRangeIso.start, end: heuristicRangeIso.end },
      });
    }

    let planResponse = null;
    let plan = null;
    try {
      reportProgress("planning-search", { message: "Planning how to explore your history…" });
      if (!session) {
        session = await ensureSessionInstance(state);
      }
      let plannerSession = session;
      if (plannerSession && typeof plannerSession.clone === "function") {
        try {
          plannerSession = await plannerSession.clone();
        } catch (err) {
          plannerSession = session;
        }
      }
        planResponse = await runPrompt(
          plannerSession,
          buildSearchPlanPrompt({
            prompt: trimmed,
            nowIso,
            range: heuristicRangeIso,
            confidence,
            keywords: promptKeywords,
            conversation: conversationContext,
            followup: isFollowup,
          }),
          SEARCH_PLAN_SCHEMA
        );
    } catch (err) {
      console.warn("Spotlight: search plan generation failed", err);
    }

    plan = parseSearchPlan(planResponse, heuristicIntent);
    const planSummary = summarizePlan(plan);
    const planKeywordsForRecord = gatherPlanKeywords(plan, promptKeywords);
    const planDomainsForRecord = gatherPlanDomains(plan);

    if (plan?.rawTimeRange) {
      const planRange = clampTimeRange(plan.rawTimeRange, now);
      if (planRange) {
        if (detectedRange) {
          const intersectStart = Math.max(detectedRange.start, planRange.start);
          const intersectEnd = Math.min(detectedRange.end, planRange.end);
          if (intersectEnd > intersectStart) {
            detectedRange = { start: intersectStart, end: intersectEnd };
          } else {
            detectedRange = planRange;
          }
        } else {
          detectedRange = planRange;
        }
        confidence = typeof confidence === "number" ? Math.max(confidence, 0.75) : 0.75;
      }
    }

    const finalRangeMs = detectedRange ? { start: detectedRange.start, end: detectedRange.end } : null;
    const timeRangeIso = finalRangeMs
      ? {
          start: formatIso(finalRangeMs.start),
          end: formatIso(finalRangeMs.end),
        }
      : { start: null, end: null };

    const rangeItems = dedupeByUrl(selectHistoryItems(items, detectedRange));
    const totalRangeCount = rangeItems.length;
    reportProgress("gathering-data", {
      message:
        totalRangeCount === 0
          ? "Scanning your history for matching entries…"
          : totalRangeCount === 1
          ? "Gathered 1 history entry in the selected range."
          : `Gathered ${totalRangeCount} history entries in the selected range.`,
      details: { totalRangeCount },
    });
    if (!totalRangeCount) {
      reportProgress("no-results", { message: "No history entries were found in that time range." });
      const responsePayload = {
        action: "show",
        message: "No history entries were found in that time range.",
        results: [],
        timeRange: timeRangeIso,
        datasetSize: 0,
        confidence,
      };
      recordConversationTurn(state, {
        type: "history",
        prompt: trimmed,
        response: responsePayload,
        plan,
        planSummary,
        rangeMs: finalRangeMs,
        timeRangeIso,
        datasetSize: 0,
        totalAvailable: 0,
        keywords: planKeywordsForRecord,
        domains: planDomainsForRecord,
        followup: isFollowup,
        confidence,
        source: "local",
      });
      return responsePayload;
    }

    const planApplication = applySearchPlanToItems(rangeItems, plan, promptKeywords);
    let annotatedItems = planApplication.items;
    const filterMeta = planApplication.meta ? { ...planApplication.meta, fallbackApplied: false } : null;
    if (!annotatedItems.length) {
      if (filterMeta) {
        filterMeta.fallbackApplied = true;
      }
      annotatedItems = rangeItems.map((item) => ({
        item,
        score: Number(item.lastVisitTime) || 0,
        matches: { required: [], optional: [], phrases: [], domains: [] },
      }));
    }
    const planMatchCount = annotatedItems.length;
    reportProgress("filtering-data", {
      message:
        planMatchCount === 1
          ? "Found 1 entry that matches your request."
          : `Found ${planMatchCount} entries that match your request.`,
      details: { matchCount: planMatchCount },
    });

    const datasetAnnotated = annotatedItems.slice(0, MAX_DATASET_ENTRIES);
    const dataset = datasetAnnotated
      .map(({ item, score, matches }) => {
        const sanitizedMatches = {};
        if (Array.isArray(matches?.required) && matches.required.length) {
          sanitizedMatches.required = matches.required;
        }
        if (Array.isArray(matches?.optional) && matches.optional.length) {
          sanitizedMatches.optional = matches.optional;
        }
        if (Array.isArray(matches?.phrases) && matches.phrases.length) {
          sanitizedMatches.phrases = matches.phrases;
        }
        if (Array.isArray(matches?.domains) && matches.domains.length) {
          sanitizedMatches.domains = matches.domains;
        }
        const annotations = { score: Math.round(score) };
        if (Object.keys(sanitizedMatches).length) {
          annotations.matches = sanitizedMatches;
        }
        return toDatasetEntry(item, annotations);
      })
      .filter(Boolean);

    const summaryAnalytics = buildSummaryAnalytics(dataset, planKeywordsForRecord, planDomainsForRecord);

    if (!dataset.length) {
      reportProgress("no-results", { message: "No matching history entries were found for that request." });
      const responsePayload = {
        action: "show",
        message: "No matching history entries were found for that request.",
        results: [],
        timeRange: timeRangeIso,
        datasetSize: 0,
        confidence,
      };
      recordConversationTurn(state, {
        type: "history",
        prompt: trimmed,
        response: responsePayload,
        plan,
        planSummary,
        rangeMs: finalRangeMs,
        timeRangeIso,
        datasetSize: 0,
        totalAvailable: totalRangeCount,
        keywords: planKeywordsForRecord,
        domains: planDomainsForRecord,
        followup: isFollowup,
        confidence,
        source: "local",
      });
      return responsePayload;
    }

    const maxReturn = plan?.maxResults ? Math.min(MAX_RESULT_IDS, Math.max(1, plan.maxResults)) : MAX_RESULT_IDS;

    const localResponse = maybeHandleLocally({
      prompt: trimmed,
      annotatedItems,
      limit: LOCAL_RESULT_LIMIT,
      range: timeRangeIso,
      confidence,
      plan,
      followup: isFollowup,
    });

    console.info("Spotlight history assistant dataset", {
      prompt: trimmed,
      timeRange: timeRangeIso,
      count: dataset.length,
      planMatches: planMatchCount,
      total: totalRangeCount,
      truncated: planMatchCount > dataset.length,
      handledLocally: Boolean(localResponse),
      followup: isFollowup,
      filters: filterMeta,
      plan: {
        intent: plan?.intent || null,
        must: Array.isArray(plan?.must) ? plan.must.map((entry) => entry.value) : [],
        should: Array.isArray(plan?.should) ? plan.should.map((entry) => entry.value) : [],
        exclude: Array.isArray(plan?.exclude) ? plan.exclude.map((entry) => entry.value) : [],
        domainHints: Array.isArray(plan?.domainHints) ? plan.domainHints.map((entry) => entry.value) : [],
        phrases: Array.isArray(plan?.phrases) ? plan.phrases.map((entry) => entry.value) : [],
        maxResults: plan?.maxResults || null,
        requireModel: Boolean(plan?.requireModel),
      },
      tabs: dataset,
      contextTurns: Array.isArray(state.conversation) ? state.conversation.length : 0,
    });

    if (localResponse) {
      reportProgress("drafting-response", { message: "Drafting a response from locally matched entries…" });
      const responseConfidence =
        typeof localResponse.confidence === "number" ? localResponse.confidence : confidence;
      const responsePayload = {
        ...localResponse,
        timeRange: timeRangeIso,
        datasetSize: planMatchCount,
        confidence: responseConfidence,
      };
      recordConversationTurn(state, {
        type: "history",
        prompt: trimmed,
        response: responsePayload,
        plan,
        planSummary,
        rangeMs: finalRangeMs,
        timeRangeIso,
        datasetSize: planMatchCount,
        totalAvailable: totalRangeCount,
        keywords: planKeywordsForRecord,
        followup: isFollowup,
        confidence: responseConfidence,
        source: "local",
      });
      reportProgress("preparing-response", { message: "Preparing final response…" });
      return responsePayload;
    }

    if (!session) {
      session = await ensureSessionInstance(state);
    }

    let stage2Session = session;
    if (session && typeof session.clone === "function") {
      try {
        stage2Session = await session.clone();
      } catch (err) {
        stage2Session = session;
      }
    }

    reportProgress("analyzing-results", { message: "Analyzing matched history entries…" });
    const interpretation = await runPrompt(
      stage2Session,
      buildInterpretationPrompt({
        prompt: trimmed,
        dataset,
        nowIso,
        range: timeRangeIso,
        confidence,
        planSummary,
        datasetSize: planMatchCount,
        totalAvailable: totalRangeCount,
        maxReturn,
        conversation: conversationContext,
        followup: isFollowup,
      }),
      INTERPRETATION_SCHEMA
    );

    const normalizedAction = normalizeAction(interpretation?.action);
    const requestedIds = Array.isArray(interpretation?.filteredResultIds)
      ? interpretation.filteredResultIds
      : [];
    const idToAnnotated = new Map(datasetAnnotated.map((entry) => [entry.item.id, entry]));
    const idSet = new Set();
    const results = [];
    for (const idValue of requestedIds) {
      const numericId = Number(idValue);
      if (!Number.isFinite(numericId)) {
        continue;
      }
      if (idSet.has(numericId)) {
        continue;
      }
      idSet.add(numericId);
      const annotated = idToAnnotated.get(numericId);
      if (!annotated) {
        continue;
      }
      const payload = createResultPayload(annotated.item);
      if (payload) {
        results.push(payload);
      }
      if (results.length >= maxReturn) {
        break;
      }
    }

    reportProgress("building-response", {
      message:
        results.length === 0
          ? "Summarizing what we found…"
          : results.length === 1
          ? "Preparing 1 highlighted history entry…"
          : `Preparing ${results.length} highlighted history entries…`,
      details: { resultCount: results.length, requestedCount: requestedIds.length },
    });

    let message = typeof interpretation?.outputMessage === "string" && interpretation.outputMessage
      ? interpretation.outputMessage.trim()
      : buildFallbackMessage(detectedRange);

    const interpretationNotes = typeof interpretation?.notes === "string" ? interpretation.notes.trim() : "";
    const notesParts = [];
    if (interpretationNotes) {
      notesParts.push(interpretationNotes);
    }
    if (plan?.reasoning && (!interpretationNotes || !interpretationNotes.includes(plan.reasoning))) {
      notesParts.push(plan.reasoning);
    }

    let summarySource = null;
    if (
      summaryAnalytics.entries.length &&
      (normalizedAction === "summarize" || (normalizedAction === "unknown" && plan?.intent === "summarize"))
    ) {
      let summarySession = stage2Session;
      if (summarySession && typeof summarySession.clone === "function") {
        try {
          summarySession = await summarySession.clone();
        } catch (error) {
          summarySession = stage2Session;
        }
      }
      reportProgress("summarizing-history", { message: "Summarizing insights from your history…" });
      const summaryResult = await generateSummaryNarrative(summarySession, {
        prompt: trimmed,
        nowIso,
        timeRange: timeRangeIso,
        analytics: summaryAnalytics,
        followup: isFollowup,
        conversation: conversationContext,
      });
      if (summaryResult && summaryResult.message) {
        message = summaryResult.message;
      }
      if (summaryResult && summaryResult.notes) {
        notesParts.push(summaryResult.notes);
      }
      summarySource = summaryResult ? (summaryResult.usedModel ? "promptApi" : "fallback") : null;
      console.info("Spotlight history assistant summary", {
        prompt: trimmed,
        timeRange: timeRangeIso,
        summarySource,
        entriesAnalyzed: summaryAnalytics.totalEntries,
        uniqueHosts: summaryAnalytics.uniqueHosts,
        topHosts: summaryAnalytics.topHosts,
        focusDomains: planDomainsForRecord,
      });
    }

    const responsePayload = {
      action: normalizedAction === "unknown" ? plan.intent : normalizedAction,
      message,
      notes: notesParts.join(" ").trim(),
      results,
      timeRange: timeRangeIso,
      datasetSize: planMatchCount,
      confidence,
    };

    recordConversationTurn(state, {
      type: "history",
      prompt: trimmed,
      response: responsePayload,
      plan,
      planSummary,
      rangeMs: finalRangeMs,
      timeRangeIso,
      datasetSize: planMatchCount,
      totalAvailable: totalRangeCount,
      keywords: planKeywordsForRecord,
      domains: planDomainsForRecord,
      followup: isFollowup,
      confidence,
      source: "promptApi",
      summarySource,
    });

    reportProgress("preparing-response", { message: "Preparing final response…" });
    return responsePayload;
  }

  async function executeAction(action, itemIds, items) {
    const normalizedAction = normalizeAction(action);
    const uniqueIds = Array.isArray(itemIds)
      ? Array.from(new Set(itemIds.map((id) => Number(id)).filter((value) => Number.isFinite(value))))
      : [];
    if (!uniqueIds.length) {
      throw new Error("No history entries available for the requested action");
    }
    const matches = uniqueIds
      .map((id) => (Array.isArray(items) ? items.find((entry) => entry && entry.id === id) : null))
      .filter(Boolean);

    if (!matches.length) {
      throw new Error("History entries are no longer available");
    }

    if (normalizedAction === "delete") {
      return performDelete(matches, scheduleRebuild);
    }
    if (normalizedAction === "open") {
      return performOpen(matches);
    }
    throw new Error("Unsupported action");
  }

  return {
    analyzeHistoryRequest,
    executeAction,
  };
}

