import { isSmartHistoryAssistantEnabled } from "../shared/feature-flags.js";

const ALLOWED_INTENTS = new Set(["show", "open", "delete", "summarize", "info"]);
const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent"],
  properties: {
    intent: {
      type: "string",
      enum: Array.from(ALLOWED_INTENTS),
    },
    searchQuery: {
      type: "string",
    },
    timeRange: {
      type: "string",
      minLength: 0,
      maxLength: 160,
    },
    site: {
      type: "string",
    },
    topic: {
      type: "string",
    },
    message: {
      type: "string",
    },
    limit: {
      type: "integer",
      minimum: 1,
    },
  },
};

const SYSTEM_INSTRUCTIONS = `You are Spotlight's Smart History Assistant living inside a local Chrome extension. \
You convert natural language requests about the user's browsing history into structured instructions. \
Return compact JSON only, matching the provided schema. \
Use these intents: show (just list results), open (user wants to immediately reopen matches), delete (user wants to remove matches), summarize (user wants a quick recap), info (user is asking about you). \
timeRange can be any concise natural-language window like 'today', 'yesterday', 'last 3 days', 'past 2 hours', or 'all'. Prefer phrasing that the UI can echo back and keep it short, and use 'all' when no timeframe is mentioned. \
searchQuery should contain plain keywords (no prefixes) to match titles or URLs. Keep it short and lowercase. \
If a site is requested, populate site with the bare domain like "youtube.com". If a topic is mentioned, capture it in topic using 1-3 short keywords. \
Only include limit when the user specifies a quantity, using positive integers without inventing defaults. \
Always include a friendly message explaining what you interpreted. \
If the user asks who you are or similar, set intent to info and craft an upbeat, concise response; leave searchQuery empty. \
Never include the history: prefix in searchQuery.`;

function sanitizeString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function sanitizeIntent(value) {
  if (typeof value !== "string") {
    return "show";
  }
  const normalized = value.toLowerCase();
  return ALLOWED_INTENTS.has(normalized) ? normalized : "show";
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

const UNIT_IN_MS = new Map([
  ["second", SECOND_MS],
  ["minute", MINUTE_MS],
  ["hour", HOUR_MS],
  ["day", DAY_MS],
  ["week", WEEK_MS],
  ["month", MONTH_MS],
  ["year", YEAR_MS],
]);

const UNIT_ALIASES = new Map([
  ["sec", "second"],
  ["secs", "second"],
  ["second", "second"],
  ["seconds", "second"],
  ["s", "second"],
  ["min", "minute"],
  ["mins", "minute"],
  ["minute", "minute"],
  ["minutes", "minute"],
  ["m", "minute"],
  ["hr", "hour"],
  ["hrs", "hour"],
  ["hour", "hour"],
  ["hours", "hour"],
  ["h", "hour"],
  ["day", "day"],
  ["days", "day"],
  ["d", "day"],
  ["week", "week"],
  ["weeks", "week"],
  ["wk", "week"],
  ["wks", "week"],
  ["month", "month"],
  ["months", "month"],
  ["year", "year"],
  ["years", "year"],
  ["yr", "year"],
  ["yrs", "year"],
]);

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
  ["hundred", 100],
  ["thousand", 1000],
  ["million", 1000000],
  ["billion", 1000000000],
  ["a", 1],
  ["an", 1],
  ["single", 1],
]);

const PRESET_ALIASES = new Map([
  ["all", "all"],
  ["all time", "all"],
  ["all history", "all"],
  ["any time", "all"],
  ["anytime", "all"],
  ["entire history", "all"],
  ["everything", "all"],
  ["whole history", "all"],
  ["today", "today"],
  ["yesterday", "yesterday"],
  ["last 7 days", "last7"],
  ["past 7 days", "last7"],
  ["previous 7 days", "last7"],
  ["last seven days", "last7"],
  ["past seven days", "last7"],
  ["last week", "last7"],
  ["past week", "last7"],
  ["previous week", "last7"],
  ["last 30 days", "last30"],
  ["past 30 days", "last30"],
  ["previous 30 days", "last30"],
  ["last thirty days", "last30"],
  ["past thirty days", "last30"],
  ["last month", "last30"],
  ["past month", "last30"],
  ["previous month", "last30"],
  ["older", "older"],
]);

function toStartOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function resolvePresetBounds(presetId, now) {
  const reference = Number.isFinite(now) ? now : Date.now();
  const safeNow = reference > 0 ? reference : Date.now();
  if (presetId === "all") {
    return { from: null, to: null };
  }
  if (presetId === "today") {
    const startToday = toStartOfDay(safeNow);
    return { from: startToday, to: safeNow };
  }
  if (presetId === "yesterday") {
    const startToday = toStartOfDay(safeNow);
    const startYesterday = startToday - DAY_MS;
    return { from: startYesterday, to: startToday };
  }
  if (presetId === "last7") {
    return { from: Math.max(0, safeNow - 7 * DAY_MS), to: safeNow };
  }
  if (presetId === "last30") {
    return { from: Math.max(0, safeNow - 30 * DAY_MS), to: safeNow };
  }
  if (presetId === "older") {
    return { from: 0, to: Math.max(0, safeNow - 30 * DAY_MS) };
  }
  return { from: null, to: null };
}

function detectPresetRange(normalized, now) {
  if (!normalized) {
    return null;
  }
  const presetId = PRESET_ALIASES.get(normalized);
  if (!presetId) {
    return null;
  }
  const resolvedAt = Number.isFinite(now) && now > 0 ? now : Date.now();
  const bounds = resolvePresetBounds(presetId, resolvedAt);
  return { presetId, ...bounds, kind: "preset", resolvedAt };
}

function resolveQuantityToken(token) {
  if (typeof token !== "string" || !token.trim()) {
    return null;
  }
  const normalized = token.trim().toLowerCase();
  if (normalized === "few") {
    return 3;
  }
  if (normalized === "couple") {
    return 2;
  }
  if (normalized === "several") {
    return 4;
  }
  if (NUMBER_WORDS.has(normalized)) {
    return NUMBER_WORDS.get(normalized);
  }
  const numeric = Number.parseFloat(normalized);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return null;
}

function normalizeUnitToken(token) {
  if (typeof token !== "string") {
    return null;
  }
  let normalized = token.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  normalized = normalized.replace(/[^a-z]/g, "");
  if (!normalized) {
    return null;
  }
  if (UNIT_ALIASES.has(normalized)) {
    return UNIT_ALIASES.get(normalized);
  }
  const deduped = normalized.replace(/(.)\1+$/g, "$1");
  if (UNIT_ALIASES.has(deduped)) {
    return UNIT_ALIASES.get(deduped);
  }
  let trimmed = normalized;
  while (trimmed.endsWith("s") && !UNIT_ALIASES.has(trimmed)) {
    trimmed = trimmed.slice(0, -1);
  }
  if (UNIT_ALIASES.has(trimmed)) {
    return UNIT_ALIASES.get(trimmed);
  }
  if (UNIT_IN_MS.has(trimmed)) {
    return trimmed;
  }
  for (const key of UNIT_ALIASES.keys()) {
    if (trimmed.startsWith(key)) {
      return UNIT_ALIASES.get(key);
    }
  }
  for (const key of UNIT_IN_MS.keys()) {
    if (trimmed.startsWith(key)) {
      return key;
    }
    if (key.startsWith(trimmed)) {
      return key;
    }
  }
  return null;
}

function buildRelativeRange(quantityToken, unitToken, now) {
  const unit = normalizeUnitToken(unitToken);
  if (!unit || !UNIT_IN_MS.has(unit)) {
    return null;
  }
  const resolvedQuantity = resolveQuantityToken(quantityToken);
  const quantity = Number.isFinite(resolvedQuantity) && resolvedQuantity > 0 ? resolvedQuantity : 1;
  const unitMs = UNIT_IN_MS.get(unit);
  const duration = quantity * unitMs;
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  const safeNow = Number.isFinite(now) && now > 0 ? now : Date.now();
  const to = safeNow;
  const from = Math.max(0, Math.floor(to - duration));
  let presetId = null;
  if (unit === "day") {
    if (Math.abs(quantity - 7) < 0.001) {
      presetId = "last7";
    } else if (Math.abs(quantity - 30) < 0.001) {
      presetId = "last30";
    }
  } else if (unit === "week" && Math.abs(quantity - 1) < 0.001) {
    presetId = "last7";
  } else if (unit === "month" && Math.abs(quantity - 1) < 0.001) {
    presetId = "last30";
  }
  return {
    presetId,
    from,
    to,
    kind: "relative",
    resolvedAt: safeNow,
    unit,
    quantity,
    durationMs: duration,
  };
}

function parseRelativeTimeRange(normalized, now) {
  if (!normalized) {
    return null;
  }
  const basePattern =
    /(?:in|within|over|during)?\s*(?:the\s+)?(?:last|past|previous)\s+(?:the\s+)?(?:(few|couple|several|[0-9]+(?:\.[0-9]+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+of)?\s+)?([a-z]+)/i;
  const baseMatch = normalized.match(basePattern);
  if (baseMatch) {
    const range = buildRelativeRange(baseMatch[1] || null, baseMatch[2], now);
    if (range) {
      return range;
    }
  }
  const agoPattern =
    /(few|couple|several|[0-9]+(?:\.[0-9]+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+of)?\s+([a-z]+)\s+(?:ago|before|earlier|back)/i;
  const agoMatch = normalized.match(agoPattern);
  if (agoMatch) {
    const range = buildRelativeRange(agoMatch[1], agoMatch[2], now);
    if (range) {
      return range;
    }
  }
  const plainPattern =
    /^(few|couple|several|[0-9]+(?:\.[0-9]+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+of)?\s+([a-z]+)$/i;
  const plainMatch = normalized.match(plainPattern);
  if (plainMatch) {
    const range = buildRelativeRange(plainMatch[1], plainMatch[2], now);
    if (range) {
      return range;
    }
  }
  return null;
}

function parseTimeRange(value, now = Date.now()) {
  const raw = sanitizeString(value);
  const referenceNow = Number.isFinite(now) && now > 0 ? now : Date.now();
  const base = {
    raw,
    label: raw,
    presetId: null,
    from: null,
    to: null,
    kind: "freeform",
    resolvedAt: referenceNow,
    unit: null,
    quantity: null,
    durationMs: null,
  };
  if (!raw) {
    return base;
  }
  const normalizedBase = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedBase) {
    return base;
  }
  const tokens = normalizedBase.split(" ").filter(Boolean);
  const canonicalTokens = tokens.map((token) => {
    if (NUMBER_WORDS.has(token)) {
      const mapped = NUMBER_WORDS.get(token);
      return Number.isFinite(mapped) ? String(mapped) : token;
    }
    return token;
  });
  const canonicalNormalized = canonicalTokens.join(" ");
  const preset = detectPresetRange(canonicalNormalized, referenceNow);
  if (preset) {
    return { ...base, ...preset };
  }
  const relative = parseRelativeTimeRange(canonicalNormalized, referenceNow);
  if (relative) {
    return { ...base, ...relative };
  }
  return base;
}

function buildTimeRangePayload(range) {
  if (!range || typeof range !== "object") {
    return null;
  }
  const presetId = typeof range.presetId === "string" && range.presetId ? range.presetId : null;
  const raw = sanitizeString(range.raw);
  const label = sanitizeString(range.label || raw);
  const from = Number.isFinite(range.from) && range.from >= 0 ? Math.floor(range.from) : null;
  const to = Number.isFinite(range.to) && range.to >= 0 ? Math.floor(range.to) : null;
  const kind = typeof range.kind === "string" && range.kind ? range.kind : null;
  const resolvedAt = Number.isFinite(range.resolvedAt) && range.resolvedAt >= 0 ? Math.floor(range.resolvedAt) : null;
  const unit = typeof range.unit === "string" && range.unit ? range.unit : null;
  const quantity = Number.isFinite(range.quantity) && range.quantity > 0 ? range.quantity : null;
  const durationMs = Number.isFinite(range.durationMs) && range.durationMs > 0 ? Math.floor(range.durationMs) : null;
  if (
    !presetId &&
    !raw &&
    !label &&
    from === null &&
    to === null &&
    !kind &&
    resolvedAt === null &&
    !unit &&
    quantity === null &&
    durationMs === null
  ) {
    return null;
  }
  const payload = {
    presetId,
    raw,
    label,
  };
  if (from !== null) {
    payload.from = from;
  }
  if (to !== null) {
    payload.to = to;
  }
  if (kind) {
    payload.kind = kind;
  }
  if (resolvedAt !== null) {
    payload.resolvedAt = resolvedAt;
  }
  if (unit) {
    payload.unit = unit;
  }
  if (quantity !== null) {
    payload.quantity = quantity;
  }
  if (durationMs !== null) {
    payload.durationMs = durationMs;
  }
  return payload;
}

function sanitizeDomain(value) {
  const text = sanitizeString(value);
  if (!text) {
    return "";
  }
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    return url.hostname.toLowerCase();
  } catch (err) {
    return text.replace(/^[^a-z0-9]+/i, "").replace(/[^a-z0-9.-]+/gi, "").toLowerCase();
  }
}

function normalizeLimit(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function buildSearchTokens({ searchQuery, site, topic }) {
  const tokens = [];
  const normalizedQuery = sanitizeString(searchQuery);
  if (normalizedQuery) {
    normalizedQuery
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .forEach((token) => tokens.push(token.toLowerCase()));
  }
  const normalizedTopic = sanitizeString(topic);
  if (normalizedTopic) {
    normalizedTopic
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .forEach((token) => tokens.push(token.toLowerCase()));
  }
  const normalizedSite = sanitizeDomain(site);
  if (normalizedSite) {
    tokens.push(normalizedSite);
  }
  const unique = [];
  const seen = new Set();
  for (const token of tokens) {
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    unique.push(token);
  }
  return unique;
}

function buildSearchQuery(tokens) {
  if (!Array.isArray(tokens) || !tokens.length) {
    return "history:";
  }
  return `history: ${tokens.join(" ")}`.trim();
}

function sanitizeInterpretation(parsed, now = Date.now()) {
  const intent = sanitizeIntent(parsed?.intent);
  const timeRange = parseTimeRange(parsed?.timeRange, now);
  const message = sanitizeString(parsed?.message);
  const searchQuery = sanitizeString(parsed?.searchQuery);
  const topic = sanitizeString(parsed?.topic);
  const site = sanitizeDomain(parsed?.site);
  const limit = intent === "info" ? null : normalizeLimit(parsed?.limit);
  return {
    intent,
    timeRange,
    message,
    searchQuery,
    topic,
    site,
    limit,
  };
}

function buildPrompt(text) {
  return `${SYSTEM_INSTRUCTIONS}\n\nUser request:\n"""${text}"""`;
}

export function createSmartHistoryAssistant() {
  let sessionInstance = null;
  let sessionPromise = null;

  async function ensureSession() {
    if (sessionInstance) {
      return sessionInstance;
    }
    if (sessionPromise) {
      return sessionPromise;
    }
    if (!isSmartHistoryAssistantEnabled()) {
      throw new Error("Smart history assistant disabled");
    }
    if (typeof globalThis.LanguageModel !== "object" && typeof globalThis.LanguageModel !== "function") {
      throw new Error("Prompt API unavailable");
    }
    const availability = await globalThis.LanguageModel.availability();
    if (availability === "unavailable") {
      throw new Error("Prompt model unavailable");
    }
    sessionPromise = globalThis.LanguageModel.create({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
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

  async function interpret(options = {}) {
    if (!isSmartHistoryAssistantEnabled()) {
      throw new Error("Smart history assistant disabled");
    }
    const text = sanitizeString(options.text);
    if (!text) {
      throw new Error("Ask something about your history to get started");
    }
    const session = await ensureSession();
    const prompt = buildPrompt(text);
    const raw = await session.prompt(prompt, { responseConstraint: RESPONSE_SCHEMA });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error("Assistant returned invalid JSON");
    }
    const now = Date.now();
    const sanitized = sanitizeInterpretation(parsed, now);
    const tokens = buildSearchTokens(sanitized);
    const query = buildSearchQuery(tokens);
    const rangePayload = buildTimeRangePayload(sanitized.timeRange);
    const presetId = typeof rangePayload?.presetId === "string" ? rangePayload.presetId : null;
    const subfilterId = presetId && presetId !== "all" ? presetId : null;
    const payload = {
      intent: sanitized.intent,
      query,
      message:
        sanitized.message ||
        (sanitized.intent === "info"
          ? "I'm Spotlight's on-device history assistant, ready to help you search."
          : "Ready to help with your history."),
      site: sanitized.site || "",
      topic: sanitized.topic || "",
    };
    if (Number.isFinite(sanitized.limit) && sanitized.limit > 0) {
      payload.limit = sanitized.limit;
    }
    if (subfilterId) {
      payload.subfilterId = subfilterId;
    }
    if (rangePayload) {
      payload.timeRange = rangePayload;
    }
    return payload;
  }

  return { interpret };
}
