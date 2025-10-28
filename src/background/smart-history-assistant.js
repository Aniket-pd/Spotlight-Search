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
  required: ["understood", "label"],
  properties: {
    understood: { type: "boolean" },
    label: {
      type: "string",
      minLength: 0,
      maxLength: 160,
    },
    from: { type: "number" },
    to: { type: "number" },
  },
};

const TIME_EXTRACTION_SYSTEM_PROMPT = `You are Spotlight's Smart History Assistant running inside a local Chrome extension. \
Extract only the time span mentioned in the user's request. \
Respond with strict JSON that matches the schema: {"understood": boolean, "label": string, "from"?: number, "to"?: number}. \
- Use epoch milliseconds for "from"/"to" when the request provides a clear range. \
- Keep "label" short and based on the user's wording. \
- When no explicit range exists, set "understood" to false, use an empty "label", and omit "from"/"to".`;

const HISTORY_REASONING_SYSTEM_PROMPT = `You are Spotlight's Smart History Assistant. \
You will receive JSON context with the user's request, resolved time bounds, and sanitized browsing history entries from that window. \
Decide how to respond using only the provided entries. \
Return strict JSON that matches the provided schema. \
Choose an intent (show, open, delete, summarize, frequent, or info). \
When listing entries, reference them by their "entryId" exactly as given. \
Only choose entries that were supplied. \
If nothing is relevant, use intent "info" with an explanatory reason.`;

const MAX_HISTORY_RESULTS = 1000;
const MAX_HISTORY_RESULTS_PER_QUERY = 200;
const MAX_HISTORY_SEARCH_ITERATIONS = Math.ceil(MAX_HISTORY_RESULTS / MAX_HISTORY_RESULTS_PER_QUERY);
const MAX_PROMPT_ENTRIES = 60;

const HISTORY_REASONING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "items"],
  properties: {
    intent: {
      type: "string",
      enum: ["show", "open", "delete", "summarize", "frequent", "info"],
    },
    reason: {
      type: "string",
      minLength: 0,
      maxLength: 400,
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_PROMPT_ENTRIES,
    },
    site: {
      type: "string",
      minLength: 0,
      maxLength: 120,
    },
    topic: {
      type: "string",
      minLength: 0,
      maxLength: 120,
    },
    items: {
      type: "array",
      maxItems: MAX_PROMPT_ENTRIES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["entryId"],
        properties: {
          entryId: {
            type: "string",
            minLength: 1,
            maxLength: 64,
          },
          note: {
            type: "string",
            minLength: 0,
            maxLength: 200,
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
      },
    },
  },
};

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
  const understood = typeof range.understood === "boolean" ? range.understood : null;
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
  if (understood !== null) {
    payload.understood = understood;
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
  const id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : null;
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
    id,
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

function assignHistoryEntryIds(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry, index) => ({
    ...entry,
    entryId: `entry-${index + 1}`,
    index: index + 1,
  }));
}

const SITE_HINT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "history",
  "last",
  "list",
  "my",
  "of",
  "open",
  "past",
  "show",
  "tab",
  "tabs",
  "the",
  "to",
  "week",
  "weeks",
  "day",
  "days",
  "month",
  "months",
  "delete",
]);

function deriveSiteHintTokens(query) {
  const normalized = sanitizeString(query).toLowerCase();
  if (!normalized) {
    return [];
  }
  const tokens = new Set();
  const domainMatches = normalized.match(/[a-z0-9.-]+\.[a-z]{2,}/g);
  if (domainMatches) {
    for (const match of domainMatches) {
      const cleaned = match.replace(/^https?:\/\//, "").replace(/^www\./, "").trim();
      if (cleaned) {
        tokens.add(cleaned);
      }
    }
  }
  const wordTokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of wordTokens) {
    if (token.length < 4) {
      continue;
    }
    if (SITE_HINT_STOP_WORDS.has(token)) {
      continue;
    }
    tokens.add(token);
  }
  return Array.from(tokens);
}

function domainMatchesHint(domain, tokens) {
  if (!domain) {
    return false;
  }
  const normalizedDomain = domain.trim().toLowerCase();
  if (!normalizedDomain) {
    return false;
  }
  for (const token of tokens) {
    const normalizedToken = sanitizeString(token).toLowerCase();
    if (!normalizedToken) {
      continue;
    }
    if (normalizedToken.includes(".")) {
      const stripped = normalizedToken.replace(/^www\./, "");
      if (normalizedDomain === stripped || normalizedDomain.endsWith(`.${stripped}`)) {
        return true;
      }
      continue;
    }
    if (normalizedDomain.includes(normalizedToken)) {
      return true;
    }
  }
  return false;
}

function filterEntriesBySiteHint(entries, query, tokensOverride = null) {
  if (!Array.isArray(entries) || !entries.length) {
    return Array.isArray(entries) ? entries : [];
  }
  const tokens = Array.isArray(tokensOverride) && tokensOverride.length
    ? tokensOverride
    : deriveSiteHintTokens(query);
  if (!tokens.length) {
    return entries;
  }
  const filtered = entries.filter((entry) => domainMatchesHint(entry?.domain, tokens));
  if (!filtered.length) {
    return entries;
  }
  return filtered;
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

function buildReasoningPrompt({ query, timeRange, entries }) {
  const safeQuery = sanitizeString(query);
  const limited = entries.slice(0, MAX_PROMPT_ENTRIES);
  const bounds = {
    label: sanitizeString(timeRange?.label) || "all time",
    raw: sanitizeString(timeRange?.raw) || "",
    from: Number.isFinite(timeRange?.from) ? Math.floor(timeRange.from) : null,
    to: Number.isFinite(timeRange?.to) ? Math.floor(timeRange.to) : null,
    understood: Boolean(timeRange?.understood),
  };
  const context = {
    userRequest: safeQuery,
    bounds,
    totalEntries: entries.length,
    entries: limited.map((entry) => {
      const hasTimestamp = Number.isFinite(entry.lastVisitTime);
      const lastVisitTime = hasTimestamp ? entry.lastVisitTime : null;
      return {
        entryId: entry.entryId,
        index: entry.index,
        title: entry.title || null,
        url: entry.url || null,
        domain: entry.domain || null,
        lastVisitTime,
        lastVisitLabel: hasTimestamp ? formatPromptDate(lastVisitTime) : null,
        visitCount: Number.isFinite(entry.visitCount) ? entry.visitCount : null,
      };
    }),
  };
  const serializedContext = JSON.stringify(context, null, 2);
  return `${HISTORY_REASONING_SYSTEM_PROMPT}\n\nContext:\n${serializedContext}`;
}

function sanitizeReasonerPlan(plan, entries) {
  const allowedIntents = new Set(["show", "open", "delete", "summarize", "frequent", "info"]);
  const intent = typeof plan?.intent === "string" && allowedIntents.has(plan.intent) ? plan.intent : "show";
  const reason = sanitizeAssistantResponse(plan?.reason);
  const limit = Number.isFinite(plan?.limit)
    ? Math.max(1, Math.min(MAX_PROMPT_ENTRIES, Math.floor(plan.limit)))
    : null;
  const site = sanitizeString(plan?.site).slice(0, 120);
  const topic = sanitizeString(plan?.topic).slice(0, 120);

  const entryMap = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry && typeof entry.entryId === "string") {
      entryMap.set(entry.entryId, entry);
    }
  }

  const itemNotes = [];
  const selectedEntries = [];
  const seen = new Set();
  if (Array.isArray(plan?.items)) {
    for (const rawItem of plan.items) {
      const entryId = sanitizeString(rawItem?.entryId);
      if (!entryId || seen.has(entryId)) {
        continue;
      }
      const entry = entryMap.get(entryId);
      if (!entry) {
        continue;
      }
      seen.add(entryId);
      selectedEntries.push(entry);
      const note = sanitizeAssistantResponse(rawItem?.note);
      if (note) {
        itemNotes.push({ entryId, note });
      }
    }
  }

  return {
    intent,
    reason,
    limit,
    site,
    topic,
    entries: selectedEntries,
    notes: itemNotes,
  };
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
  const label = sanitizeString(parsed?.label || parsed?.timeRange);
  const understood = Boolean(parsed?.understood);
  const from = Number.isFinite(parsed?.from) && parsed.from >= 0 ? Math.floor(parsed.from) : null;
  const to = Number.isFinite(parsed?.to) && parsed.to >= 0 ? Math.floor(parsed.to) : null;
  return {
    label,
    understood,
    from,
    to,
  };
}

async function fetchHistoryEntries(bounds) {
  const from = Number.isFinite(bounds?.from) ? Math.max(0, Math.floor(bounds.from)) : null;
  const initialTo = Number.isFinite(bounds?.to) ? Math.max(0, Math.floor(bounds.to)) : null;
  const aggregated = [];
  const seenKeys = new Set();

  let remaining = MAX_HISTORY_RESULTS;
  let endTime = initialTo;
  let iterations = 0;

  while (remaining > 0 && iterations < MAX_HISTORY_SEARCH_ITERATIONS) {
    iterations += 1;
    const options = {
      text: "",
      maxResults: Math.min(MAX_HISTORY_RESULTS_PER_QUERY, remaining),
    };
    if (from !== null) {
      options.startTime = from;
    }
    if (endTime !== null) {
      options.endTime = endTime;
    }

    let batch = [];
    try {
      batch = await chrome.history.search(options);
    } catch (error) {
      console.warn("Spotlight: history search failed", error);
      break;
    }

    if (!Array.isArray(batch) || !batch.length) {
      break;
    }

    let earliestTimestamp = null;
    for (const entry of batch) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const timestamp = Number.isFinite(entry.lastVisitTime)
        ? Math.floor(entry.lastVisitTime)
        : Number.isFinite(entry.timeStamp)
        ? Math.floor(entry.timeStamp)
        : null;
      if (timestamp !== null) {
        if (earliestTimestamp === null || timestamp < earliestTimestamp) {
          earliestTimestamp = timestamp;
        }
      }
      const key = typeof entry.id === "string" && entry.id.trim()
        ? `id:${entry.id.trim()}`
        : typeof entry.url === "string" && entry.url.trim()
        ? `url:${entry.url.trim()}|${timestamp !== null ? timestamp : ""}`
        : null;
      if (key && seenKeys.has(key)) {
        continue;
      }
      if (key) {
        seenKeys.add(key);
      }
      aggregated.push(entry);
      if (aggregated.length >= MAX_HISTORY_RESULTS) {
        break;
      }
    }

    if (earliestTimestamp === null) {
      break;
    }

    remaining = Math.max(0, MAX_HISTORY_RESULTS - aggregated.length);
    if (remaining <= 0) {
      break;
    }
    if (from !== null && earliestTimestamp <= from) {
      break;
    }

    const nextEndTime = earliestTimestamp - 1;
    if (endTime !== null && nextEndTime >= endTime) {
      break;
    }
    if (nextEndTime <= 0) {
      break;
    }
    endTime = nextEndTime;
  }

  return sanitizeHistoryEntries(aggregated, { from, to: initialTo });
}

async function analyzeHistory(session, { query, timeRange, entries }) {
  const prompt = buildReasoningPrompt({ query, timeRange, entries });
  const raw = await session.prompt(prompt, { responseConstraint: HISTORY_REASONING_SCHEMA });
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Assistant returned an invalid plan");
  }
  return sanitizeReasonerPlan(parsed, entries);
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
    const extractedRange = await extractTimeRange(session, text);
    const extractedLabel = sanitizeString(extractedRange?.label);
    const parsedRange = parseTimeRange(extractedLabel, now);
    const combinedRange = {
      ...parsedRange,
      label: extractedLabel || parsedRange.label,
      raw: extractedLabel || parsedRange.raw,
    };
    if (Number.isFinite(extractedRange?.from)) {
      combinedRange.from = extractedRange.from;
    }
    if (Number.isFinite(extractedRange?.to)) {
      combinedRange.to = extractedRange.to;
    }
    if (typeof extractedRange?.understood === "boolean") {
      combinedRange.understood = extractedRange.understood;
    }
    const bounds = resolveBoundsForRange(combinedRange, now);
    const rawEntries = await fetchHistoryEntries(bounds);
    const siteHintTokens = deriveSiteHintTokens(text);
    const filteredEntries = filterEntriesBySiteHint(rawEntries, text, siteHintTokens);
    const entriesWithIds = assignHistoryEntryIds(filteredEntries);
    const fallbackLabel = combinedRange.label || combinedRange.raw || "all time";
    const baseTimeRange = {
      ...combinedRange,
      from: bounds.from,
      to: bounds.to,
    };
    const timeRangePayload = buildTimeRangePayload(baseTimeRange) || {
      raw: fallbackLabel,
      label: fallbackLabel,
    };
    if (timeRangePayload && !timeRangePayload.label) {
      timeRangePayload.label = fallbackLabel;
    }
    if (timeRangePayload && !timeRangePayload.raw) {
      timeRangePayload.raw = fallbackLabel;
    }
    if (typeof combinedRange.understood === "boolean") {
      timeRangePayload.understood = combinedRange.understood;
    }

    const reasoningRange = {
      ...timeRangePayload,
      from: Number.isFinite(bounds.from) ? bounds.from : null,
      to: Number.isFinite(bounds.to) ? bounds.to : null,
      understood:
        typeof timeRangePayload.understood === "boolean"
          ? timeRangePayload.understood
          : Boolean(extractedRange?.understood),
    };

    let reasonerPlan;
    try {
      reasonerPlan = await analyzeHistory(session, {
        query: text,
        timeRange: reasoningRange,
        entries: entriesWithIds,
      });
    } catch (error) {
      const fallbackMessage = entriesWithIds.length
        ? "I couldn't interpret the browsing history for that request."
        : "I couldn't find any browsing history in that time range.";
      return {
        intent: "info",
        query: "history:",
        message: fallbackMessage,
        site: "",
        topic: "",
        timeRange: timeRangePayload || null,
        analysis: {
          extractedTimeRange: fallbackLabel,
          assistantUnderstoodRange: Boolean(extractedRange?.understood),
          analyzedEntryCount: entriesWithIds.length,
          availableEntryCount: rawEntries.length,
          selectedEntryCount: 0,
          siteHintApplied: filteredEntries.length !== rawEntries.length,
          siteHintTokens,
          error: error?.message || "reasoner_failed",
        },
      };
    }

    const planItems = reasonerPlan.entries.map((entry) => ({
      entryId: entry.entryId,
      url: entry.url,
      title: entry.title,
      domain: entry.domain,
      lastVisitTime: entry.lastVisitTime,
      visitCount: entry.visitCount,
      historyId: entry.id || null,
      index: entry.index,
    }));

    const itemCount = planItems.length;
    const defaultMessage = itemCount
      ? `Found ${itemCount} matching history ${itemCount === 1 ? "entry" : "entries"}.`
      : "No relevant browsing activity found in that time range.";
    const message = reasonerPlan.reason || defaultMessage;
    const limit = reasonerPlan.limit ?? (itemCount ? itemCount : null);

    const analysis = {
      extractedTimeRange: fallbackLabel,
      assistantUnderstoodRange: Boolean(extractedRange?.understood),
      resolvedBounds: {
        from: Number.isFinite(bounds.from) ? bounds.from : null,
        to: Number.isFinite(bounds.to) ? bounds.to : null,
      },
      analyzedEntryCount: entriesWithIds.length,
      availableEntryCount: rawEntries.length,
      siteHintApplied: filteredEntries.length !== rawEntries.length,
      siteHintTokens,
      selectedEntryCount: itemCount,
      selectedEntryIds: planItems.map((item) => item.entryId),
      notes: Array.isArray(reasonerPlan.notes) && reasonerPlan.notes.length ? reasonerPlan.notes : [],
      modelIntent: reasonerPlan.intent,
      modelLimit: reasonerPlan.limit,
    };

    return {
      intent: reasonerPlan.intent,
      query: "history:",
      message,
      site: reasonerPlan.site,
      topic: reasonerPlan.topic,
      limit,
      timeRange: timeRangePayload || null,
      items: planItems,
      reason: reasonerPlan.reason,
      analysis,
    };
  }

  return { interpret };
}
