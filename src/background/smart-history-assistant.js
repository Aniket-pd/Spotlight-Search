import { isSmartHistoryAssistantEnabled } from "../shared/feature-flags.js";
import {
  NUMBER_WORD_DEFINITIONS,
  QUANTITY_KEYWORD_DEFINITIONS,
  TIME_PRESET_DEFINITIONS,
  TIME_UNIT_DEFINITIONS,
} from "../shared/time-range-definitions.js";

function sanitizeString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

const TIME_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["timeRange"],
  properties: {
    timeRange: {
      type: "string",
      minLength: 0,
      maxLength: 160,
    },
  },
};

const TIME_EXTRACTION_SYSTEM_PROMPT = `You are Spotlight's Smart History Assistant living inside a local Chrome extension. \
Your only job is to identify the time range mentioned in the user's request. \
Return concise JSON that matches the provided schema. \
Use the user's own words when possible. \
When the request does not include a time range, respond with the string "all time".`;

const HISTORY_ANALYSIS_SYSTEM_PROMPT = `You are Spotlight's Smart History Assistant. \
You receive the user's request plus sanitized browsing history entries that fall inside the requested window. \
Use only those entries to answer the request directly. \
If nothing in the history helps, clearly say that no relevant activity was found. \
Keep the response under 120 words and write in English.`;

const MAX_HISTORY_RESULTS = 200;
const MAX_PROMPT_ENTRIES = 60;

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

function resolveBoundsForRange(range, now = Date.now()) {
  if (!range || typeof range !== "object") {
    return { from: null, to: null };
  }
  const referenceNow = Number.isFinite(now) && now > 0 ? now : Date.now();
  let from = Number.isFinite(range.from) && range.from >= 0 ? Math.floor(range.from) : null;
  let to = Number.isFinite(range.to) && range.to >= 0 ? Math.floor(range.to) : null;
  if (from !== null && to === null) {
    to = referenceNow;
  }
  if (from !== null && to !== null && to < from) {
    return { from: to, to: from };
  }
  return { from, to };
}

function sanitizeAssistantResponse(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function sanitizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const rawTitle = typeof entry.title === "string" ? entry.title.trim() : "";
  const title = rawTitle.slice(0, 160);
  const rawUrl = typeof entry.url === "string" ? entry.url.trim() : "";
  const url = rawUrl.slice(0, 200);
  if (!title && !url) {
    return null;
  }
  const lastVisitTime = Number.isFinite(entry.lastVisitTime)
    ? Math.floor(entry.lastVisitTime)
    : Number.isFinite(entry.timeStamp)
    ? Math.floor(entry.timeStamp)
    : null;
  const visitCount = Number.isFinite(entry.visitCount) && entry.visitCount > 0 ? Math.floor(entry.visitCount) : null;
  let domain = "";
  if (typeof entry.domain === "string" && entry.domain.trim()) {
    domain = entry.domain.trim().toLowerCase();
  } else if (url) {
    try {
      const parsed = new URL(url.includes("://") ? url : `https://${url}`);
      domain = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    } catch (error) {
      const sanitized = url.replace(/^https?:\/\//i, "");
      domain = sanitized.split("/")[0].replace(/^www\./i, "").toLowerCase();
    }
  }
  return {
    title,
    url,
    domain,
    lastVisitTime,
    visitCount,
  };
}

function sanitizeHistoryEntries(entries, bounds) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const from = Number.isFinite(bounds?.from) ? bounds.from : null;
  const to = Number.isFinite(bounds?.to) ? bounds.to : null;
  const sanitized = [];
  for (const entry of entries) {
    const clean = sanitizeHistoryEntry(entry);
    if (!clean) {
      continue;
    }
    const timestamp = Number.isFinite(clean.lastVisitTime) ? clean.lastVisitTime : null;
    if (from !== null && (timestamp === null || timestamp < from)) {
      continue;
    }
    if (to !== null && (timestamp === null || timestamp > to)) {
      continue;
    }
    sanitized.push(clean);
  }
  sanitized.sort((a, b) => {
    const aTime = Number.isFinite(a.lastVisitTime) ? a.lastVisitTime : 0;
    const bTime = Number.isFinite(b.lastVisitTime) ? b.lastVisitTime : 0;
    return bTime - aTime;
  });
  return sanitized;
}

function formatPromptDate(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "unknown";
  }
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch (error) {
    return "unknown";
  }
}

function buildTimeExtractionPrompt(text) {
  return `${TIME_EXTRACTION_SYSTEM_PROMPT}\n\nUser request:\n"""${text}"""`;
}

function buildAnalysisPrompt({ query, timeRangeLabel, entries }) {
  const safeLabel = timeRangeLabel || "all time";
  const lines = [HISTORY_ANALYSIS_SYSTEM_PROMPT, `User request:\n"""${query}"""`, `Time range: ${safeLabel}`];
  if (!entries.length) {
    lines.push("History entries: none found in this range.");
    return lines.join("\n\n");
  }
  lines.push("History entries (most recent first):");
  const limited = entries.slice(0, MAX_PROMPT_ENTRIES);
  limited.forEach((entry, index) => {
    const parts = [];
    parts.push(`${index + 1}.`);
    if (entry.domain) {
      parts.push(entry.domain);
    }
    if (Number.isFinite(entry.visitCount) && entry.visitCount > 0) {
      parts.push(`visits:${entry.visitCount}`);
    }
    if (Number.isFinite(entry.lastVisitTime)) {
      parts.push(formatPromptDate(entry.lastVisitTime));
    }
    const headline = entry.title || entry.url;
    parts.push(`— ${headline}`);
    if (entry.url) {
      parts.push(`(${entry.url})`);
    }
    lines.push(parts.join(" "));
  });
  if (entries.length > limited.length) {
    lines.push(`…and ${entries.length - limited.length} more entries within the range.`);
  }
  return lines.join("\n");
}

async function extractTimeRange(session, text) {
  const prompt = buildTimeExtractionPrompt(text);
  const raw = await session.prompt(prompt, { responseConstraint: TIME_EXTRACTION_SCHEMA });
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Assistant returned an invalid time range");
  }
  const extracted = sanitizeString(parsed?.timeRange);
  return extracted || "all time";
}

async function fetchHistoryEntries(bounds) {
  const options = { text: "", maxResults: MAX_HISTORY_RESULTS };
  if (Number.isFinite(bounds?.from)) {
    options.startTime = bounds.from;
  }
  if (Number.isFinite(bounds?.to)) {
    options.endTime = bounds.to;
  }
  let results = [];
  try {
    results = await chrome.history.search(options);
  } catch (error) {
    console.warn("Spotlight: history search failed", error);
    return [];
  }
  return sanitizeHistoryEntries(results, bounds);
}

async function analyzeHistory(session, { query, timeRangeLabel, entries }) {
  const prompt = buildAnalysisPrompt({ query, timeRangeLabel, entries });
  const response = await session.prompt(prompt);
  const answer = sanitizeAssistantResponse(response);
  if (answer) {
    return answer;
  }
  if (!entries.length) {
    return "I couldn't find any browsing history in that time range.";
  }
  return "I couldn't interpret the browsing history for that request.";
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
    const now = Date.now();
    const extractedRangeText = await extractTimeRange(session, text);
    const parsedRange = parseTimeRange(extractedRangeText, now);
    const bounds = resolveBoundsForRange(parsedRange, now);
    const entries = await fetchHistoryEntries(bounds);
    const fallbackLabel = extractedRangeText || "all time";
    const timeRangePayload = buildTimeRangePayload(parsedRange) || {
      raw: fallbackLabel,
      label: fallbackLabel,
    };
    if (timeRangePayload && !timeRangePayload.label) {
      timeRangePayload.label = fallbackLabel;
    }
    if (timeRangePayload && !timeRangePayload.raw) {
      timeRangePayload.raw = fallbackLabel;
    }
    const answer = await analyzeHistory(session, {
      query: text,
      timeRangeLabel: timeRangePayload?.label || fallbackLabel,
      entries,
    });
    return {
      intent: "show",
      query: "history:",
      message: answer,
      site: "",
      topic: "",
      timeRange: timeRangePayload || null,
      analysis: {
        extractedTimeRange: fallbackLabel,
        analyzedEntryCount: entries.length,
      },
    };
  }

  return { interpret };
}
