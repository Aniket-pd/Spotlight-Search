const SMART_HISTORY_ASSISTANT_FLAG_KEY = "spotlight.smartHistoryAssistantEnabled";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const OPEN_LIMIT = 8;
const DELETE_LIMIT = 20;
const SUMMARY_LIMIT = 20;
const HISTORY_SEARCH_MAX_RESULTS = 200;

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["action"],
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["show", "open", "delete", "summarize", "meta"],
    },
    filters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1 },
        keywords: {
          type: "array",
          maxItems: 8,
          items: { type: "string", minLength: 1 },
        },
        domains: {
          type: "array",
          maxItems: 6,
          items: { type: "string", minLength: 2 },
        },
      },
    },
    timeframe: {
      type: "object",
      additionalProperties: false,
      properties: {
        preset: {
          type: "string",
          enum: [
            "today",
            "yesterday",
            "last_24_hours",
            "last_hour",
            "last_3_days",
            "last_7_days",
            "last_30_days",
            "last_week",
          ],
        },
        from: { type: "string", minLength: 4 },
        to: { type: "string", minLength: 4 },
        relativeDays: { type: "integer", minimum: 1, maximum: 31 },
        relativeHours: { type: "integer", minimum: 1, maximum: 168 },
      },
    },
    limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    summaryFocus: { type: "string", minLength: 3 },
    metaResponse: { type: "string", minLength: 1 },
  },
};

function safeNotify(callback, payload) {
  if (typeof callback !== "function") {
    return;
  }
  try {
    callback(payload);
  } catch (error) {
    console.warn("Spotlight: history assistant notification failed", error);
  }
}

function coalesceQuery(filters = {}) {
  const parts = [];
  if (filters.query && typeof filters.query === "string") {
    parts.push(filters.query.trim());
  }
  if (Array.isArray(filters.keywords)) {
    for (const keyword of filters.keywords) {
      if (typeof keyword === "string" && keyword.trim()) {
        parts.push(keyword.trim());
      }
    }
  }
  const text = parts.join(" ").trim();
  return text || "";
}

function normalizeDomain(domain = "") {
  try {
    return new URL(`https://${domain}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch (error) {
    return String(domain || "").replace(/^www\./, "").toLowerCase();
  }
}

function filterByDomain(items, domains) {
  if (!Array.isArray(domains) || !domains.length) {
    return items;
  }
  const normalized = domains
    .map((domain) => normalizeDomain(domain))
    .filter(Boolean);
  if (!normalized.length) {
    return items;
  }
  return items.filter((item) => {
    if (!item || typeof item.url !== "string") {
      return false;
    }
    let hostname = "";
    try {
      hostname = new URL(item.url).hostname.replace(/^www\./, "").toLowerCase();
    } catch (error) {
      hostname = "";
    }
    if (!hostname) {
      return false;
    }
    return normalized.some((domain) => hostname.endsWith(domain));
  });
}

function computeTimeWindow(timeframe, now = Date.now()) {
  if (!timeframe || typeof timeframe !== "object") {
    return { startTime: null, endTime: null };
  }
  const window = { startTime: null, endTime: null };
  const { preset, from, to, relativeDays, relativeHours } = timeframe;
  const current = Number.isFinite(now) ? now : Date.now();

  if (typeof from === "string") {
    const parsed = Date.parse(from);
    if (!Number.isNaN(parsed)) {
      window.startTime = parsed;
    }
  }
  if (typeof to === "string") {
    const parsed = Date.parse(to);
    if (!Number.isNaN(parsed)) {
      window.endTime = parsed;
    }
  }

  if (!window.startTime && Number.isInteger(relativeDays)) {
    window.startTime = current - relativeDays * 24 * 60 * 60 * 1000;
  }
  if (!window.startTime && Number.isInteger(relativeHours)) {
    window.startTime = current - relativeHours * 60 * 60 * 1000;
  }

  if (!window.startTime && typeof preset === "string") {
    const end = new Date(current);
    const start = new Date(current);
    switch (preset) {
      case "today": {
        start.setHours(0, 0, 0, 0);
        window.startTime = start.getTime();
        window.endTime = current;
        break;
      }
      case "yesterday": {
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - 1);
        end.setHours(0, 0, 0, 0);
        window.startTime = start.getTime();
        window.endTime = end.getTime();
        break;
      }
      case "last_hour": {
        window.startTime = current - 60 * 60 * 1000;
        break;
      }
      case "last_24_hours": {
        window.startTime = current - 24 * 60 * 60 * 1000;
        break;
      }
      case "last_3_days": {
        window.startTime = current - 3 * 24 * 60 * 60 * 1000;
        break;
      }
      case "last_week":
      case "last_7_days": {
        window.startTime = current - 7 * 24 * 60 * 60 * 1000;
        break;
      }
      case "last_30_days": {
        window.startTime = current - 30 * 24 * 60 * 60 * 1000;
        break;
      }
      default:
        break;
    }
  }

  if (!window.endTime) {
    window.endTime = current;
  }
  if (window.startTime && window.endTime && window.startTime > window.endTime) {
    const temp = window.startTime;
    window.startTime = window.endTime;
    window.endTime = temp;
  }
  return window;
}

function mapHistoryItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item, index) => {
    const url = typeof item.url === "string" ? item.url : "";
    const title = typeof item.title === "string" && item.title ? item.title : url;
    const lastVisitTime = Number.isFinite(item.lastVisitTime) ? item.lastVisitTime : null;
    return {
      id: `${index}:${lastVisitTime || 0}:${url}`,
      url,
      title,
      lastVisitTime,
      visitCount: Number.isFinite(item.visitCount) ? item.visitCount : null,
    };
  });
}

function describeHistoryItems(items, now = Date.now()) {
  if (!Array.isArray(items) || !items.length) {
    return "";
  }
  const formatter = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return items
    .map((item, index) => {
      const lastVisit = Number.isFinite(item.lastVisitTime) ? new Date(item.lastVisitTime) : new Date(now);
      const formatted = formatter.format(lastVisit);
      const hostname = (() => {
        try {
          return new URL(item.url).hostname;
        } catch (error) {
          return item.url;
        }
      })();
      const base = `${index + 1}. ${item.title || item.url}`;
      const details = `${formatted} · ${hostname}`;
      return `${base}\n${details}\n${item.url}`;
    })
    .join("\n\n");
}

function safeJsonParse(payload) {
  if (typeof payload !== "string" || !payload.trim()) {
    return null;
  }
  try {
    return JSON.parse(payload);
  } catch (error) {
    return null;
  }
}

function isHttpUrl(url = "") {
  return /^https?:/i.test(url);
}

export function createHistoryAssistantService() {
  let enabled = false;
  let session = null;
  let sessionPromise = null;
  let summarizer = null;
  let summarizerPromise = null;

  async function refreshFlag() {
    try {
      const values = await chrome.storage.local.get(SMART_HISTORY_ASSISTANT_FLAG_KEY);
      enabled = Boolean(values?.[SMART_HISTORY_ASSISTANT_FLAG_KEY]);
    } catch (error) {
      enabled = false;
    }
  }

  refreshFlag().catch(() => {
    enabled = false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(changes, SMART_HISTORY_ASSISTANT_FLAG_KEY)) {
      enabled = Boolean(changes[SMART_HISTORY_ASSISTANT_FLAG_KEY]?.newValue);
    }
  });

  function assertEnabled() {
    if (!enabled) {
      const error = new Error("Smart History Assistant disabled");
      error.code = "DISABLED";
      throw error;
    }
  }

  async function ensureSession() {
    if (session) {
      return session;
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
    const systemPrompt = `You are Spotlight's Smart History Assistant. Convert user requests about browsing history into JSON commands. ` +
      `Always obey this JSON schema: ${JSON.stringify(RESPONSE_SCHEMA)}. ` +
      `Explain the action with fields described by the schema. Use domains array for hostnames only. ` +
      `Support actions: show (return matching entries), open (open results in new tabs), delete (remove entries), summarize (produce TLDR), meta (respond conversationally). ` +
      `Prefer preset timeframe values when the user references relative dates (today, yesterday, last_3_days, last_7_days, last_30_days, last_24_hours, last_hour, last_week). ` +
      `When unsure, fall back to action "meta" with metaResponse.`;
    sessionPromise = globalThis.LanguageModel.create({
      initialPrompts: [
        { role: "system", content: systemPrompt },
      ],
    })
      .then((instance) => {
        session = instance;
        sessionPromise = null;
        return instance;
      })
      .catch((error) => {
        sessionPromise = null;
        throw error;
      });
    return sessionPromise;
  }

  async function ensureSummarizer() {
    if (summarizer) {
      return summarizer;
    }
    if (summarizerPromise) {
      return summarizerPromise;
    }
    if (typeof globalThis.Summarizer !== "object" && typeof globalThis.Summarizer !== "function") {
      throw new Error("Summarizer API unavailable");
    }
    const availability = await globalThis.Summarizer.availability();
    if (availability === "unavailable") {
      throw new Error("Summarizer model unavailable");
    }
    summarizerPromise = globalThis.Summarizer.create({
      type: "tldr",
      format: "markdown",
      length: "short",
      sharedContext: "Summaries of Chrome browsing history activity to help the user review recent work.",
      monitor(monitor) {
        if (!monitor || typeof monitor.addEventListener !== "function") {
          return;
        }
        monitor.addEventListener("downloadprogress", (event) => {
          const percent = typeof event?.loaded === "number" ? Math.round(event.loaded * 100) : null;
          if (percent !== null) {
            console.info(`Spotlight history summarizer download ${percent}%`);
          }
        });
      },
    })
      .then((instance) => {
        summarizer = instance;
        summarizerPromise = null;
        return instance;
      })
      .catch((error) => {
        summarizerPromise = null;
        throw error;
      });
    return summarizerPromise;
  }

  async function interpretRequest({ query, prompt, now }) {
    const sessionInstance = await ensureSession();
    const trimmedQuery = typeof query === "string" ? query.trim() : "";
    if (!trimmedQuery) {
      throw new Error("Enter a request for the assistant");
    }
    const extraPrompt = typeof prompt === "string" ? prompt.trim() : "";
    const isoNow = new Date(now || Date.now()).toISOString();
    const payloadLines = [
      `Current time: ${isoNow}`,
      `User request: ${trimmedQuery}`,
    ];
    if (extraPrompt) {
      payloadLines.push(`Assistant context: ${extraPrompt}`);
    }
    payloadLines.push("Return a single JSON object only.");
    const payload = payloadLines.join("\n");
    const raw = await sessionInstance.prompt(payload, {
      responseConstraint: RESPONSE_SCHEMA,
      omitResponseConstraintInput: true,
    });
    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Assistant returned an invalid response");
    }
    return parsed;
  }

  async function queryHistory(command, options = {}) {
    const { onProgress } = options;
    const { filters = {}, timeframe = null } = command || {};
    const searchText = coalesceQuery(filters);
    const { startTime, endTime } = computeTimeWindow(timeframe);
    const limit = Math.min(Math.max(Number(command?.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const searchOptions = {
      text: searchText,
      maxResults: HISTORY_SEARCH_MAX_RESULTS,
    };
    if (Number.isFinite(startTime)) {
      searchOptions.startTime = startTime;
    }
    if (Number.isFinite(endTime)) {
      searchOptions.endTime = endTime;
    }
    safeNotify(onProgress, { stage: "history-query", text: searchText, startTime, endTime });
    const items = await chrome.history.search(searchOptions);
    let filtered = items;
    if (filters && Array.isArray(filters.domains) && filters.domains.length) {
      filtered = filterByDomain(filtered, filters.domains);
    }
    filtered.sort((a, b) => {
      const aTime = Number.isFinite(a.lastVisitTime) ? a.lastVisitTime : 0;
      const bTime = Number.isFinite(b.lastVisitTime) ? b.lastVisitTime : 0;
      return bTime - aTime;
    });
    return filtered.slice(0, limit);
  }

  async function performOpen(command, results, options = {}) {
    const { onProgress } = options;
    const limit = Math.min(results.length, OPEN_LIMIT);
    const targets = results.slice(0, limit).filter((item) => isHttpUrl(item.url));
    if (!targets.length) {
      return { opened: 0 };
    }
    safeNotify(onProgress, { stage: "opening", count: targets.length });
    await Promise.all(
      targets.map((item) =>
        chrome.tabs
          .create({ url: item.url })
          .catch((error) => {
            console.warn("Spotlight: failed to open history url", error);
          })
      )
    );
    return { opened: targets.length };
  }

  async function performDelete(results, options = {}) {
    const { onProgress } = options;
    const limit = Math.min(results.length, DELETE_LIMIT);
    const targets = results.slice(0, limit).filter((item) => isHttpUrl(item.url));
    if (!targets.length) {
      return { deleted: 0 };
    }
    safeNotify(onProgress, { stage: "deleting", count: targets.length });
    for (const item of targets) {
      try {
        await chrome.history.deleteUrl({ url: item.url });
      } catch (error) {
        console.warn("Spotlight: failed to delete history url", error);
      }
    }
    return { deleted: targets.length };
  }

  async function performSummarize(command, results, options = {}) {
    const { onProgress } = options;
    if (!results.length) {
      return { summary: "No matching history entries to summarize." };
    }
    const summarizerInstance = await ensureSummarizer();
    const focus = typeof command?.summaryFocus === "string" ? command.summaryFocus : "";
    const context = focus ? `Focus: ${focus}` : undefined;
    const text = describeHistoryItems(results);
    safeNotify(onProgress, { stage: "summarizing", count: results.length });
    const summary = await summarizerInstance.summarize(text, context ? { context } : undefined);
    return { summary };
  }

  function buildAcknowledgement(command, results) {
    const action = command?.action;
    const filters = command?.filters || {};
    const timeframe = command?.timeframe || {};
    const parts = [];
    if (filters.query) {
      parts.push(`matching "${filters.query}"`);
    }
    if (Array.isArray(filters.domains) && filters.domains.length) {
      parts.push(`within ${filters.domains.join(", ")}`);
    }
    if (timeframe?.preset) {
      parts.push(timeframe.preset.replace(/_/g, " "));
    }
    if (!parts.length) {
      parts.push("recent history");
    }
    const base = parts.join(" ");
    switch (action) {
      case "show":
        return `Found ${results.length} entries ${base}.`;
      case "open":
        return `Opened ${Math.min(results.length, OPEN_LIMIT)} entries ${base}.`;
      case "delete":
        return `Removed ${Math.min(results.length, DELETE_LIMIT)} entries ${base}.`;
      case "summarize":
        return `Summarized ${Math.min(results.length, SUMMARY_LIMIT)} entries ${base}.`;
      default:
        return "";
    }
  }

  async function handleRequest({ query, prompt, onProgress }) {
    assertEnabled();
    safeNotify(onProgress, { stage: "interpreting" });
    const command = await interpretRequest({ query, prompt });
    safeNotify(onProgress, { stage: "command", command });

    if (command.action === "meta") {
      const message =
        typeof command.metaResponse === "string" && command.metaResponse
          ? command.metaResponse
          : "I'm Spotlight's Smart History Assistant. Ask me about your browsing history.";
      return { action: "meta", message, command };
    }

    const results = await queryHistory(command, { onProgress });
    const mapped = mapHistoryItems(results);
    switch (command.action) {
      case "show": {
        const acknowledgement = buildAcknowledgement(command, results);
        return { action: "show", items: mapped, message: acknowledgement, command };
      }
      case "open": {
        const outcome = await performOpen(command, results, { onProgress });
        const acknowledgement = buildAcknowledgement(command, results);
        return { action: "open", items: mapped, opened: outcome.opened, message: acknowledgement, command };
      }
      case "delete": {
        const outcome = await performDelete(results, { onProgress });
        const acknowledgement = buildAcknowledgement(command, results);
        return { action: "delete", items: mapped, deleted: outcome.deleted, message: acknowledgement, command };
      }
      case "summarize": {
        const limited = results.slice(0, SUMMARY_LIMIT);
        try {
          const summaryResult = await performSummarize(command, limited, { onProgress });
          const acknowledgement = buildAcknowledgement(command, limited);
          return {
            action: "summarize",
            items: mapHistoryItems(limited),
            summary: summaryResult.summary,
            message: acknowledgement,
            command,
          };
        } catch (error) {
          const acknowledgement = buildAcknowledgement(command, limited);
          return {
            action: "summarize",
            items: mapHistoryItems(limited),
            summary: "",
            message: `${acknowledgement} ${error?.message || "Summary unavailable."}`.trim(),
            command,
            error: error?.message || "Summary unavailable",
          };
        }
      }
      default:
        return {
          action: "meta",
          message: "I'm not sure how to help with that. Try asking about your browsing history.",
          command,
        };
    }
  }

  async function openUrl(url) {
    assertEnabled();
    if (typeof url !== "string" || !url) {
      throw new Error("Missing URL");
    }
    if (!isHttpUrl(url)) {
      throw new Error("Only http(s) URLs can be opened");
    }
    await chrome.tabs.create({ url });
    return { success: true };
  }

  return {
    handleRequest,
    openUrl,
    refreshFlag,
    isEnabled() {
      return enabled;
    },
  };
}
