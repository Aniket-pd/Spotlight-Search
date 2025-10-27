import { isSmartHistoryAssistantEnabled } from "../shared/feature-flags.js";
import {
  NUMBER_WORD_DEFINITIONS,
  QUANTITY_KEYWORD_DEFINITIONS,
  TIME_PRESET_DEFINITIONS,
  TIME_UNIT_DEFINITIONS,
} from "../shared/time-range-definitions.js";

const ALLOWED_INTENTS = new Set(["show", "open", "delete", "summarize", "frequent", "info"]);
const ALLOWED_TONES = new Set(["formal", "casual", "action"]);
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
    comparisonRange: {
      type: "string",
      maxLength: 160,
    },
    tone: {
      type: "string",
      enum: Array.from(ALLOWED_TONES),
    },
  },
};

const SYSTEM_INSTRUCTIONS = `You are Spotlight's Smart History Assistant living inside a local Chrome extension. \
You convert natural language requests about the user's browsing history into structured instructions. \
Return compact JSON only, matching the provided schema. \
Use these intents: show (just list results), open (user wants to immediately reopen matches), delete (user wants to remove matches), summarize (user wants a quick recap), frequent (user wants the most visited tabs/sites with visit counts), info (user is asking about you). \
timeRange can be any concise natural-language window like 'today', 'yesterday', 'last 3 days', 'past 2 hours', or 'all'. Prefer phrasing that the UI can echo back and keep it short, and use 'all' when no timeframe is mentioned. \
If the user explicitly wants two windows compared (e.g., "this week vs last week"), keep intent as summarize and populate comparisonRange with the second timeframe while keeping timeRange focused on the primary window. \
searchQuery should contain plain keywords (no prefixes) to match titles or URLs. Keep it short and lowercase. \
If a site is requested, populate site with the bare domain like "youtube.com". If a topic is mentioned, capture it in topic using 1-3 short keywords. \
Only include limit when the user specifies a quantity, using positive integers without inventing defaults. \
When using the frequent intent, mention that you'll rank the user's matches by visit count and, if they asked for a quantity, clarify how many entries you'll surface. \
Always include a friendly message explaining what you interpreted. \
If the request hints at a tone (academic, casual, action-oriented), set tone to "formal", "casual", or "action" respectively; otherwise omit tone. \
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

function sanitizeTone(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (ALLOWED_TONES.has(normalized)) {
    return normalized;
  }
  return null;
}

const TONE_KEYWORD_WEIGHTS = [
  { tone: "action", keywords: ["productivity", "progress", "plan", "organize", "optimize", "deliverable", "ship", "output", "results", "accomplish", "task", "workflow", "focus", "review", "status"] },
  { tone: "formal", keywords: ["study", "research", "paper", "assignment", "university", "academic", "analysis", "notes", "documentation", "docs", "lecture", "course", "learn", "report"] },
  { tone: "casual", keywords: ["watch", "youtube", "video", "movie", "music", "entertainment", "reddit", "gaming", "fun", "leisure", "blog", "shopping", "stream", "series"] },
];

function inferToneFromText(text, parsed) {
  const haystacks = [];
  if (typeof text === "string" && text.trim()) {
    haystacks.push(text.toLowerCase());
  }
  if (typeof parsed?.message === "string" && parsed.message.trim()) {
    haystacks.push(parsed.message.toLowerCase());
  }
  if (typeof parsed?.topic === "string" && parsed.topic.trim()) {
    haystacks.push(parsed.topic.toLowerCase());
  }
  if (typeof parsed?.searchQuery === "string" && parsed.searchQuery.trim()) {
    haystacks.push(parsed.searchQuery.toLowerCase());
  }
  if (!haystacks.length) {
    return null;
  }
  const combined = haystacks.join(" ");
  for (const descriptor of TONE_KEYWORD_WEIGHTS) {
    if (descriptor.keywords.some((keyword) => combined.includes(keyword))) {
      return descriptor.tone;
    }
  }
  return null;
}

const UNIT_IN_MS = new Map(TIME_UNIT_DEFINITIONS.map((definition) => [definition.id, definition.ms]));

const UNIT_ALIASES = new Map();
for (const definition of TIME_UNIT_DEFINITIONS) {
  for (const label of definition.labels) {
    const normalized = typeof label === "string" ? label.trim().toLowerCase() : "";
    if (normalized) {
      UNIT_ALIASES.set(normalized, definition.id);
    }
  }
  UNIT_ALIASES.set(definition.id, definition.id);
}

const NUMBER_WORDS = new Map();
for (const definition of NUMBER_WORD_DEFINITIONS) {
  for (const label of definition.labels) {
    const normalized = typeof label === "string" ? label.trim().toLowerCase() : "";
    if (normalized) {
      NUMBER_WORDS.set(normalized, definition.value);
    }
  }
}

const QUANTITY_KEYWORDS = new Map();
for (const definition of QUANTITY_KEYWORD_DEFINITIONS) {
  for (const label of definition.labels) {
    const normalized = typeof label === "string" ? label.trim().toLowerCase() : "";
    if (normalized) {
      QUANTITY_KEYWORDS.set(normalized, definition.value);
    }
  }
}

const PRESET_ALIASES = new Map();
const PRESET_RESOLVERS = new Map();
for (const definition of TIME_PRESET_DEFINITIONS) {
  PRESET_RESOLVERS.set(definition.id, definition.resolveBounds);
  for (const label of definition.labels) {
    const normalized = typeof label === "string" ? label.trim().toLowerCase() : "";
    if (normalized) {
      PRESET_ALIASES.set(normalized, definition.id);
    }
  }
  PRESET_ALIASES.set(definition.id, definition.id);
}

function resolvePresetBounds(presetId, now) {
  const reference = Number.isFinite(now) ? now : Date.now();
  const safeNow = reference > 0 ? reference : Date.now();
  const resolver = PRESET_RESOLVERS.get(presetId);
  if (typeof resolver !== "function") {
    return { from: null, to: null };
  }
  const bounds = resolver(safeNow) || {};
  const from = Number.isFinite(bounds.from) && bounds.from >= 0 ? bounds.from : null;
  const to = Number.isFinite(bounds.to) && bounds.to >= 0 ? bounds.to : null;
  return { from, to };
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
  if (QUANTITY_KEYWORDS.has(normalized)) {
    return QUANTITY_KEYWORDS.get(normalized);
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

function sanitizeInterpretation(parsed, now = Date.now(), text = "") {
  const intent = sanitizeIntent(parsed?.intent);
  const timeRange = parseTimeRange(parsed?.timeRange, now);
  const message = sanitizeString(parsed?.message);
  const searchQuery = sanitizeString(parsed?.searchQuery);
  const topic = sanitizeString(parsed?.topic);
  const site = sanitizeDomain(parsed?.site);
  const limit = intent === "info" ? null : normalizeLimit(parsed?.limit);
  const comparisonRange = parseTimeRange(parsed?.comparisonRange, now);
  const reportedTone = sanitizeTone(parsed?.tone);
  const inferredTone = inferToneFromText(text, parsed);
  const tone = reportedTone || inferredTone;
  return {
    intent,
    timeRange,
    message,
    searchQuery,
    topic,
    site,
    limit,
    comparisonRange,
    tone,
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
    const sanitized = sanitizeInterpretation(parsed, now, text);
    const tokens = buildSearchTokens(sanitized);
    const query = buildSearchQuery(tokens);
    const rangePayload = buildTimeRangePayload(sanitized.timeRange);
    const comparisonPayload = buildTimeRangePayload(sanitized.comparisonRange);
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
    if (comparisonPayload) {
      payload.comparisonRange = comparisonPayload;
    }
    if (sanitized.tone) {
      payload.tone = sanitized.tone;
    }
    return payload;
  }

  return { interpret };
}
