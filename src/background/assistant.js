import { isSmartHistoryAssistantEnabled } from "../shared/flags.js";
import { interpretHistoryQuery, buildHistoryFiltersFromIntent } from "../search/nlp/history-intent.js";

const CACHE_TTL = 60 * 1000;
const AVAILABILITY_TTL = 15 * 1000;
const BASE_SESSION_OPTIONS = {
  model: "gemini-nano",
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

const READY_AVAILABILITY_STATES = new Set(["ready", "available", "downloaded", "succeeded"]);
const DOWNLOAD_REQUIRED_STATES = new Set(["download_required", "downloadable"]);
const DOWNLOADING_STATES = new Set(["downloading", "download_in_progress"]);
const INTERACTION_REQUIRED_STATES = new Set([
  "user_interaction_required",
  "user_action_required",
  "user_gesture_required",
  "no_user_gesture",
  "activation_required",
]);

function getLanguageModelApi() {
  if (typeof chrome === "undefined") {
    return null;
  }
  return chrome?.ai?.languageModel || null;
}

function broadcastRuntimeMessage(message) {
  try {
    if (!message) {
      return;
    }
    if (typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      return;
    }
    chrome.runtime.sendMessage(message);
  } catch (err) {
    console.warn("Spotlight: assistant broadcast failed", err);
  }
}

function now() {
  return Date.now();
}

function buildCacheKey(payload) {
  const query = typeof payload?.query === "string" ? payload.query.trim() : "";
  const subfilter = payload?.subfilter && typeof payload.subfilter.id === "string" ? payload.subfilter.id : null;
  const domain = typeof payload?.domain === "string" ? payload.domain : null;
  return JSON.stringify({ query, subfilter, domain });
}

function normalizeAvailabilityState(raw) {
  if (!raw) {
    return { status: "unavailable" };
  }
  const details = { status: "unknown" };
  let status = null;
  if (typeof raw === "string") {
    status = raw;
  } else if (typeof raw === "object") {
    status = raw.availability || raw.status || raw.state || raw.result || null;
    if (typeof raw.reason === "string") {
      details.reason = raw.reason;
    } else if (typeof raw.message === "string") {
      details.reason = raw.message;
    }
    if (typeof raw.progress === "number") {
      details.progress = raw.progress;
    }
  }
  if (typeof status !== "string" || !status) {
    return { ...details, status: "unknown" };
  }
  const normalized = status.toLowerCase();
  details.rawStatus = normalized;
  if (READY_AVAILABILITY_STATES.has(normalized)) {
    return { ...details, status: "ready", reason: details.reason || "" };
  }
  if (DOWNLOADING_STATES.has(normalized)) {
    return {
      ...details,
      status: "downloading",
      reason: details.reason || "Downloading on-device model…",
    };
  }
  if (DOWNLOAD_REQUIRED_STATES.has(normalized)) {
    return {
      ...details,
      status: "download-required",
      reason: details.reason || "Model download required after activation",
    };
  }
  if (INTERACTION_REQUIRED_STATES.has(normalized)) {
    return {
      ...details,
      status: "interaction-required",
      reason: details.reason || "Activate with a key press or click to continue",
    };
  }
  if (normalized === "disabled") {
    return { ...details, status: "disabled" };
  }
  if (normalized === "unavailable" || normalized === "blocked") {
    return { ...details, status: normalized };
  }
  if (normalized === "error" || normalized === "failed") {
    return { ...details, status: "error" };
  }
  return { ...details, status: normalized };
}

function createCacheEntry(response) {
  return { response, timestamp: now() };
}

function isEntryValid(entry, ttl = CACHE_TTL) {
  if (!entry || typeof entry.timestamp !== "number") {
    return false;
  }
  return now() - entry.timestamp < ttl;
}

export function createAssistantService({ context, runSearch }) {
  let destroyed = false;
  const cache = new Map();
  const sessions = new Map();
  let availabilityCache = null;

  function assertEnabled() {
    if (!isSmartHistoryAssistantEnabled()) {
      throw new Error("Smart History Assistant disabled");
    }
  }

  async function checkAvailability(force = false) {
    if (!isSmartHistoryAssistantEnabled()) {
      return { status: "disabled" };
    }
    const api = getLanguageModelApi();
    if (!api || typeof api.availability !== "function") {
      return { status: "unavailable", reason: "Prompt API unavailable" };
    }
    if (!force && availabilityCache && isEntryValid(availabilityCache, AVAILABILITY_TTL)) {
      return availabilityCache.response;
    }
    try {
      const raw = await api.availability({ ...BASE_SESSION_OPTIONS });
      const normalized = normalizeAvailabilityState(raw);
      availabilityCache = createCacheEntry(normalized);
      return normalized;
    } catch (err) {
      const message = err?.message || "Prompt API check failed";
      const fallback = { status: "error", reason: message };
      availabilityCache = createCacheEntry(fallback);
      return fallback;
    }
  }

  async function ensureSession(kind) {
    if (!isSmartHistoryAssistantEnabled()) {
      return null;
    }
    const api = getLanguageModelApi();
    if (!api || typeof api.create !== "function") {
      return null;
    }
    const existing = sessions.get(kind);
    if (existing && existing.session && !existing.destroyed) {
      return existing.session;
    }
    try {
      const session = await api.create({
        ...BASE_SESSION_OPTIONS,
        initialPrompts: [
          {
            role: "system",
            content:
              "You are Spotlight's Smart History Assistant. Interpret natural language history requests and respond with structured filters, domains, and follow-up hints.",
          },
        ],
        monitor(monitor) {
          if (!monitor || typeof monitor.addEventListener !== "function") {
            return;
          }
          monitor.addEventListener("downloadprogress", (event) => {
            broadcastRuntimeMessage({
              type: "SPOTLIGHT_ASSISTANT_DOWNLOAD",
              progress: typeof event?.progress === "number" ? event.progress : 0,
            });
          });
          monitor.addEventListener("statechange", (event) => {
            const availability = normalizeAvailabilityState(event?.status || event?.state || event);
            if (availability) {
              broadcastRuntimeMessage({
                type: "SPOTLIGHT_ASSISTANT_STATUS_EVENT",
                availability,
              });
            }
          });
        },
      });
      sessions.set(kind, { session, createdAt: now(), destroyed: false });
      return session;
    } catch (err) {
      console.warn("Spotlight: unable to create Prompt API session", err);
      return null;
    }
  }

  async function destroySessions() {
    for (const [key, entry] of sessions.entries()) {
      try {
        if (entry.session && typeof entry.session.destroy === "function") {
          await entry.session.destroy();
        } else if (entry.session && typeof entry.session.close === "function") {
          await entry.session.close();
        }
      } catch (err) {
        console.warn("Spotlight: failed to close assistant session", err);
      }
      sessions.set(key, { ...entry, destroyed: true });
    }
  }

  function getCachedResponse(key) {
    const entry = cache.get(key);
    if (isEntryValid(entry)) {
      return { ...entry.response, assistant: { ...(entry.response.assistant || {}), cached: true } };
    }
    cache.delete(key);
    return null;
  }

  function storeCachedResponse(key, response) {
    cache.set(key, createCacheEntry(response));
  }

  async function interpretQuery(query) {
    const trimmed = typeof query === "string" ? query.trim() : "";
    if (!trimmed) {
      return interpretHistoryQuery("", { now: now() });
    }
    let availability = await checkAvailability();
    if (
      availability &&
      (availability.status === "interaction-required" || availability.status === "download-required")
    ) {
      availability = await checkAvailability(true);
    }
    if (
      !availability ||
      availability.status === "unavailable" ||
      availability.status === "disabled" ||
      availability.status === "blocked" ||
      availability.status === "error"
    ) {
      return interpretHistoryQuery(trimmed, { now: now() });
    }
    // Attempt to reuse a Prompt API session when available. If anything fails we fall back to heuristics.
    try {
      const session = await ensureSession("history-intent");
      if (session && typeof session.prompt === "function") {
        const schema = {
          type: "object",
          properties: {
            searchQuery: { type: "string" },
            timeRange: { type: "string" },
            domain: { type: "string" },
            actions: { type: "array", items: { type: "string" } },
            explanation: { type: "string" },
          },
          additionalProperties: false,
        };
        const promptText =
          "Convert the natural language history request into JSON with fields searchQuery, timeRange (today|yesterday|last7|last30|older|null), domain, actions (array), explanation. Query: " +
          trimmed;
        const rawResponse = await session.prompt(promptText, {
          responseConstraint: schema,
          omitResponseConstraintInput: true,
        });
        const responseObject =
          typeof rawResponse === "string"
            ? (() => {
                try {
                  return JSON.parse(rawResponse);
                } catch (parseError) {
                  console.warn("Spotlight: Prompt API returned non-JSON response", parseError);
                  return null;
                }
              })()
            : rawResponse && typeof rawResponse === "object"
            ? rawResponse
            : null;
        if (responseObject) {
          const intent = {
            searchQuery: typeof responseObject.searchQuery === "string" && responseObject.searchQuery.trim()
              ? responseObject.searchQuery.trim()
              : trimmed,
            timeRange: responseObject.timeRange
              ? { id: String(responseObject.timeRange), label: String(responseObject.timeRange) }
              : null,
            domain:
              typeof responseObject.domain === "string" && responseObject.domain.trim()
                ? responseObject.domain.trim().toLowerCase()
                : null,
            actions: Array.isArray(responseObject.actions) ? responseObject.actions.filter(Boolean) : [],
            answer:
              typeof responseObject.explanation === "string" ? responseObject.explanation : "",
            explanation:
              typeof responseObject.explanation === "string" ? responseObject.explanation : "",
            confidence: 0.6,
            originalQuery: trimmed,
            now: now(),
          };
          return intent;
        }
      }
    } catch (err) {
      console.warn("Spotlight: Prompt API interpretation failed, using heuristics", err);
    }
    return interpretHistoryQuery(trimmed, { now: now() });
  }

  async function runHistorySearch(query, intent, options = {}) {
    const data = await context.ensureIndex();
    const normalizedIntent = intent || (await interpretQuery(query));
    const filters = buildHistoryFiltersFromIntent(normalizedIntent);
    const subfilter = options.subfilter || filters?.subfilter || null;
    const assistantIntent = {
      ...normalizedIntent,
      timeRange: normalizedIntent?.timeRange || (filters?.subfilter ? { id: filters.subfilter.id } : null),
    };
    const searchQuery = normalizedIntent?.searchQuery || query || "";
    const prefixedQuery = `history:${searchQuery ? ` ${searchQuery}` : ""}`.trim();
    const payload =
      runSearch(prefixedQuery, data, {
        subfilter,
        assistantIntent,
        webSearch: options.webSearch,
      }) || {};
    const answer = normalizedIntent?.answer || normalizedIntent?.explanation || payload.answer || "";
    const availability = await checkAvailability();
    const response = {
      ...payload,
      answer,
      assistant: {
        intent: normalizedIntent,
        availability,
        cached: false,
      },
    };
    return response;
  }

  async function requestHistory(payload) {
    assertEnabled();
    const query = typeof payload?.query === "string" ? payload.query : "";
    const key = buildCacheKey({ query, subfilter: payload?.subfilter, domain: payload?.domain });
    const cached = payload?.skipCache ? null : getCachedResponse(key);
    if (cached) {
      return cached;
    }
    const intent = payload?.intent || (await interpretQuery(query));
    const response = await runHistorySearch(query, intent, { subfilter: payload?.subfilter, webSearch: payload?.webSearch });
    storeCachedResponse(key, response);
    return response;
  }

  async function requestPersona(payload) {
    assertEnabled();
    const availability = await checkAvailability();
    const answer =
      typeof payload?.query === "string" && payload.query.trim()
        ? "I'm Spotlight's Smart History Assistant, running entirely on your device. Ask me about your browsing history and I'll turn it into quick actions."
        : "Hi! I'm Spotlight's Smart History Assistant. Ask about recent visits, time ranges, or domains.";
    return {
      results: [],
      ghost: null,
      answer,
      filter: "history",
      subfilters: null,
      assistant: { availability, persona: true },
    };
  }

  async function handleRequest(request = {}) {
    const mode = typeof request.mode === "string" ? request.mode : "history";
    switch (mode) {
      case "history":
        return requestHistory(request);
      case "persona":
        return requestPersona(request);
      default:
        throw new Error(`Unsupported assistant mode: ${mode}`);
    }
  }

  async function dispose() {
    destroyed = true;
    cache.clear();
    await destroySessions();
  }

  return {
    isEnabled: () => isSmartHistoryAssistantEnabled(),
    getAvailability: () => checkAvailability(),
    requestHistory,
    handleRequest,
    dispose,
    destroyed: () => destroyed,
  };
}

