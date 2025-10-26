import { isSmartHistoryAssistantEnabled } from "../shared/feature-flags.js";

const ALLOWED_INTENTS = new Set(["show", "open", "delete", "summarize", "info"]);
const ALLOWED_TIME_RANGES = new Set(["all", "today", "yesterday", "last7", "last30", "older"]);
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
      enum: Array.from(ALLOWED_TIME_RANGES),
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
      maximum: 50,
    },
  },
};

const SYSTEM_INSTRUCTIONS = `You are Spotlight's Smart History Assistant living inside a local Chrome extension. \
You convert natural language requests about the user's browsing history into structured instructions. \
Return compact JSON only, matching the provided schema. \
Use these intents: show (just list results), open (user wants to immediately reopen matches), delete (user wants to remove matches), summarize (user wants a quick recap), info (user is asking about you). \
Allowed time ranges: all, today, yesterday, last7, last30, older. Map relative requests to the closest range (e.g. last week -> last7, past month -> last30, past few days -> last7). \
searchQuery should contain plain keywords (no prefixes) to match titles or URLs. Keep it short and lowercase. \
If a site is requested, populate site with the bare domain like "youtube.com". If a topic is mentioned, capture it in topic using 1-3 short keywords. \
Limit defaults: show -> 10, summarize -> 20, open -> 3, delete -> 5 unless the user states otherwise. Clamp the limit between 1 and 50 for show/summarize, 1 and 10 for open, and 1 and 25 for delete. \
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

function sanitizeTimeRange(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.toLowerCase();
  if (!ALLOWED_TIME_RANGES.has(normalized)) {
    return null;
  }
  return normalized;
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

function clampLimit(intent, value) {
  const defaults = {
    show: 10,
    summarize: 20,
    open: 3,
    delete: 5,
    info: 0,
  };
  const maxByIntentMap = {
    show: 50,
    summarize: 50,
    open: 10,
    delete: 25,
    info: 0,
  };
  const maxByIntent = maxByIntentMap[intent] ?? 50;
  if (!Number.isFinite(value)) {
    return defaults[intent] ?? 10;
  }
  const clamped = Math.max(1, Math.min(value, maxByIntent));
  return clamped;
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

function sanitizeInterpretation(parsed) {
  const intent = sanitizeIntent(parsed?.intent);
  const timeRange = sanitizeTimeRange(parsed?.timeRange);
  const message = sanitizeString(parsed?.message);
  const searchQuery = sanitizeString(parsed?.searchQuery);
  const topic = sanitizeString(parsed?.topic);
  const site = sanitizeDomain(parsed?.site);
  const limit = intent === "info" ? 0 : clampLimit(intent, parsed?.limit);
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
    const sanitized = sanitizeInterpretation(parsed);
    const tokens = buildSearchTokens(sanitized);
    const query = buildSearchQuery(tokens);
    const payload = {
      intent: sanitized.intent,
      query,
      subfilterId: sanitized.timeRange && sanitized.timeRange !== "all" ? sanitized.timeRange : null,
      message:
        sanitized.message ||
        (sanitized.intent === "info"
          ? "I'm Spotlight's on-device history assistant, ready to help you search."
          : "Ready to help with your history."),
      limit: sanitized.limit,
      site: sanitized.site || "",
      topic: sanitized.topic || "",
    };
    return payload;
  }

  return { interpret };
}
