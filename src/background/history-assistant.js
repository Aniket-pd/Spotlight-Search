const DEFAULT_MAX_RESULTS = 120;
const MAX_REQUEST_CACHE = 4;
const REQUEST_TTL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["search", "open", "delete"],
    },
    confidence: { type: "number" },
    needsFollowUp: { type: "boolean" },
    followUpQuestion: { type: "string" },
    topics: {
      type: "array",
      items: { type: "string" },
    },
    quantity: { type: "number" },
    timeframe: {
      type: ["object", "null"],
      properties: {
        preset: { type: "string" },
        startDaysAgo: { type: "number" },
        endDaysAgo: { type: "number" },
        description: { type: "string" },
      },
    },
    actionTargets: {
      type: "array",
      items: { type: "string" },
    },
  },
};

const INTERPRETER_SYSTEM_PROMPT = `You are Smart History Search, a local-only assistant for a Chrome extension.
Goal: interpret natural language requests about the user's browsing history so the extension can search, reopen, or delete entries.

Guidelines:
- Never fabricate browsing history. You only infer intent from the user's words.
- Output structured JSON that matches the provided schema. Do not add extra keys.
- Choose the action that best fits the request: "search" (show matching entries), "open" (reopen requested pages), or "delete" (remove matching history).
- Extract short topic keywords (1-3 words) when relevant. Prefer nouns or domains without spaces if possible.
- Identify a reasonable timeframe. Use preset values such as "today", "yesterday", "last7", "last30", "thisWeek", "thisMonth", "weekend", or "all". When the request names an approximate period, translate to startDaysAgo / endDaysAgo offsets (0 = today, 7 = seven days ago, etc.).
- If the request is unclear, set needsFollowUp to true and provide a short followUpQuestion seeking clarification.
- When the user explicitly mentions reopening or bringing back tabs, choose the "open" action. When they mention deleting or clearing history, choose "delete".
- actionTargets may include specific sites, titles, or session descriptions mentioned by the user.
- Keep confidence between 0 and 1.`;

function clamp(value, min, max) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return min;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function toStartOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatRelativeDay(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) {
    return "Unknown";
  }
  const startOfToday = toStartOfDay(now);
  const startOfTarget = toStartOfDay(timestamp);
  const diffDays = Math.round((startOfToday - startOfTarget) / DAY_MS);
  if (diffDays === 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  const options = { month: "short", day: "numeric" };
  if (Math.abs(diffDays) > 180) {
    options.year = "numeric";
  }
  const formatter = new Intl.DateTimeFormat(undefined, options);
  return formatter.format(timestamp);
}

function formatTimeOfDay(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return formatter.format(timestamp);
}

function extractHostname(url) {
  if (typeof url !== "string" || !url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (err) {
    return "";
  }
}

function extractDisplayPath(url) {
  if (typeof url !== "string" || !url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    const query = parsed.search || "";
    return `${parsed.hostname}${path}${query}`;
  } catch (err) {
    return url;
  }
}

function normalizeTopics(topics) {
  if (!Array.isArray(topics)) {
    return [];
  }
  return topics
    .map((topic) => (typeof topic === "string" ? topic.trim().toLowerCase() : ""))
    .filter(Boolean)
    .slice(0, 6);
}

function computeTimeRange(interpretation, context = {}, now = Date.now()) {
  const subfilterId = typeof context?.subfilterId === "string" ? context.subfilterId : null;
  let startTime = 0;
  let endTime = undefined;
  let label = "All history";
  let preset = "all";

  if (subfilterId) {
    switch (subfilterId) {
      case "today":
        startTime = toStartOfDay(now);
        label = "Today";
        preset = "today";
        break;
      case "yesterday":
        startTime = toStartOfDay(now - DAY_MS);
        endTime = toStartOfDay(now);
        label = "Yesterday";
        preset = "yesterday";
        break;
      case "last7":
        startTime = now - 7 * DAY_MS;
        label = "Last 7 days";
        preset = "last7";
        break;
      case "last30":
        startTime = now - 30 * DAY_MS;
        label = "Last 30 days";
        preset = "last30";
        break;
      case "older":
        startTime = 0;
        endTime = now - 30 * DAY_MS;
        label = "Older than 30 days";
        preset = "older";
        break;
      default:
        break;
    }
  }

  const timeframe = interpretation?.timeframe || null;
  if (timeframe) {
    const presetValue = typeof timeframe.preset === "string" ? timeframe.preset.trim().toLowerCase() : "";
    const description = typeof timeframe.description === "string" ? timeframe.description : "";
    const startDaysAgo = Number.isFinite(timeframe.startDaysAgo) ? timeframe.startDaysAgo : null;
    const endDaysAgo = Number.isFinite(timeframe.endDaysAgo) ? timeframe.endDaysAgo : null;

    if (presetValue) {
      switch (presetValue) {
        case "today":
          startTime = toStartOfDay(now);
          endTime = undefined;
          label = "Today";
          preset = "today";
          break;
        case "yesterday":
          startTime = toStartOfDay(now - DAY_MS);
          endTime = toStartOfDay(now);
          label = "Yesterday";
          preset = "yesterday";
          break;
        case "last7":
        case "last7days":
        case "last_7_days":
        case "past_week":
          startTime = now - 7 * DAY_MS;
          endTime = undefined;
          label = "Last 7 days";
          preset = "last7";
          break;
        case "last30":
        case "last30days":
        case "last_30_days":
        case "past_month":
          startTime = now - 30 * DAY_MS;
          endTime = undefined;
          label = "Last 30 days";
          preset = "last30";
          break;
        case "thisweek":
        case "this_week":
          {
            const current = new Date(now);
            const day = current.getDay();
            const diff = (day + 6) % 7; // Monday as start of week
            const monday = new Date(current);
            monday.setDate(current.getDate() - diff);
            monday.setHours(0, 0, 0, 0);
            startTime = monday.getTime();
            endTime = undefined;
            label = "This week";
            preset = "thisWeek";
          }
          break;
        case "thismonth":
        case "this_month":
          {
            const current = new Date(now);
            const first = new Date(current.getFullYear(), current.getMonth(), 1);
            startTime = first.getTime();
            endTime = undefined;
            label = "This month";
            preset = "thisMonth";
          }
          break;
        case "weekend":
          startTime = now - 3 * DAY_MS;
          endTime = undefined;
          label = "Recent weekend";
          preset = "weekend";
          break;
        case "all":
          startTime = 0;
          endTime = undefined;
          label = description || "All history";
          preset = "all";
          break;
        default:
          break;
      }
    }

    if (startDaysAgo !== null) {
      const clamped = Math.max(0, Math.floor(startDaysAgo));
      const candidate = now - clamped * DAY_MS;
      if (!Number.isNaN(candidate)) {
        startTime = candidate;
        preset = "custom";
        label = description || `Since ${formatRelativeDay(candidate, now)}`;
      }
    }
    if (endDaysAgo !== null) {
      const clamped = Math.max(0, Math.floor(endDaysAgo));
      const candidate = now - clamped * DAY_MS;
      if (!Number.isNaN(candidate) && (endTime === undefined || candidate < endTime)) {
        endTime = candidate;
        if (preset === "custom" && !description) {
          label = `${formatRelativeDay(startTime || candidate, now)} to ${formatRelativeDay(candidate, now)}`;
        }
      }
    }
  }

  return { startTime, endTime, label, preset };
}

function filterByTopics(entries, topics) {
  if (!topics || !topics.length) {
    return entries;
  }
  const tokens = topics.map((topic) => topic.toLowerCase());
  return entries.filter((entry) => {
    const haystack = `${entry.title || ""} ${entry.url || ""}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

function groupHistoryEntries(entries, topics, now = Date.now()) {
  const groups = new Map();
  let groupCounter = 0;
  let entryCounter = 0;

  for (const entry of entries) {
    if (!entry || !entry.url) {
      continue;
    }
    const visitTime = Number(entry.lastVisitTime) || 0;
    const dayKey = toStartOfDay(visitTime || now);
    const host = extractHostname(entry.url) || "unknown";
    const key = `${dayKey}::${host}`;
    if (!groups.has(key)) {
      groupCounter += 1;
      groups.set(key, {
        id: `group-${groupCounter}`,
        hostname: host,
        dayKey,
        entries: [],
      });
    }
    const group = groups.get(key);
    entryCounter += 1;
    group.entries.push({
      id: `entry-${entryCounter}`,
      url: entry.url,
      title: entry.title || entry.url,
      lastVisitTime: visitTime,
      visitCount: entry.visitCount || 0,
      displayPath: extractDisplayPath(entry.url),
    });
  }

  const list = Array.from(groups.values());
  list.forEach((group) => {
    group.entries.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
    group.timeLabel = formatRelativeDay(group.entries[0]?.lastVisitTime || now, now);
    const title = topics && topics.length ? topics[0] : group.hostname;
    group.label = title ? `${title} · ${group.timeLabel}` : group.timeLabel;
  });

  list.sort((a, b) => {
    const aTime = a.entries[0]?.lastVisitTime || 0;
    const bTime = b.entries[0]?.lastVisitTime || 0;
    return bTime - aTime;
  });

  return list;
}

function sanitizeInterpretation(result) {
  if (!result || typeof result !== "object") {
    return null;
  }
  const action = typeof result.action === "string" ? result.action.trim().toLowerCase() : "";
  if (!action || !["search", "open", "delete"].includes(action)) {
    return null;
  }
  const confidence = clamp(result.confidence, 0, 1);
  const topics = normalizeTopics(result.topics);
  const needsFollowUp = Boolean(result.needsFollowUp);
  const followUpQuestion = needsFollowUp && typeof result.followUpQuestion === "string"
    ? result.followUpQuestion.trim()
    : "";
  const timeframe = result.timeframe && typeof result.timeframe === "object" ? result.timeframe : null;
  const quantity = Number.isFinite(result.quantity) && result.quantity > 0 ? Math.round(result.quantity) : null;
  const actionTargets = Array.isArray(result.actionTargets)
    ? result.actionTargets.map((target) => (typeof target === "string" ? target.trim() : "")).filter(Boolean).slice(0, 6)
    : [];

  return {
    action,
    confidence,
    topics,
    needsFollowUp,
    followUpQuestion,
    timeframe,
    quantity,
    actionTargets,
  };
}

function buildFeedback(intent, groups, rangeLabel) {
  if (!intent) {
    return "Let's try that again.";
  }
  if (intent.needsFollowUp) {
    return intent.followUpQuestion || "Could you clarify what you're looking for?";
  }
  if (!groups || !groups.length) {
    if (intent.action === "delete") {
      return "I didn't spot any history entries matching that request.";
    }
    if (intent.action === "open") {
      return "Nothing matched your reopen request.";
    }
    return "No matching history found.";
  }
  const first = groups[0];
  const count = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const base =
    intent.action === "delete"
      ? "Here are the entries you can remove."
      : intent.action === "open"
      ? "Here's what I can reopen."
      : "Here are the closest matches.";
  const summary = count === 1 ? "1 item" : `${count} items`;
  const rangePart = rangeLabel && rangeLabel !== "All history" ? ` from ${rangeLabel}` : "";
  const groupPart = first.hostname ? ` · ${first.hostname}` : "";
  return `${base} ${summary}${rangePart}${groupPart}.`.trim();
}

function summarizeGroupForResponse(group) {
  return {
    id: group.id,
    label: group.label,
    hostname: group.hostname,
    timeLabel: group.timeLabel,
    entryCount: group.entries.length,
    entries: group.entries.slice(0, DEFAULT_MAX_RESULTS).map((entry) => ({
      id: entry.id,
      title: entry.title,
      url: entry.url,
      displayPath: entry.displayPath,
      lastVisitTime: entry.lastVisitTime,
      timeOfDay: formatTimeOfDay(entry.lastVisitTime),
    })),
  };
}

function pruneRequestCache(cache, now = Date.now()) {
  const entries = Array.from(cache.entries());
  entries.sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
  while (cache.size > MAX_REQUEST_CACHE) {
    const [key] = entries.shift();
    if (key && cache.has(key)) {
      cache.delete(key);
    }
  }
  for (const [key, value] of cache.entries()) {
    if (now - (value.createdAt || now) > REQUEST_TTL_MS) {
      cache.delete(key);
    }
  }
}

export function createHistoryAssistantService() {
  let sessionInstance = null;
  let sessionPromise = null;
  let requestCounter = 0;
  const requestCache = new Map();
  let lastDeletion = null;

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
    sessionPromise = globalThis.LanguageModel.create();
    sessionInstance = await sessionPromise;
    sessionPromise = null;
    return sessionInstance;
  }

  async function interpretRequest(query, context) {
    const session = await ensureSession();
    const userPrompt = {
      role: "user",
      content: JSON.stringify({ query, context }),
    };
    const raw = await session.prompt(
      [
        { role: "system", content: INTERPRETER_SYSTEM_PROMPT },
        userPrompt,
      ],
      {
        responseConstraint: RESPONSE_SCHEMA,
      }
    );
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.warn("Spotlight history assistant returned invalid JSON", error, raw);
      return null;
    }
    return sanitizeInterpretation(parsed);
  }

  function storeRequest(groups) {
    requestCounter += 1;
    const token = `history-${Date.now()}-${requestCounter}`;
    const groupMap = new Map();
    const entryMap = new Map();
    groups.forEach((group) => {
      groupMap.set(group.id, group);
      group.entries.forEach((entry) => {
        entryMap.set(entry.id, entry);
      });
    });
    requestCache.set(token, { groups: groupMap, entries: entryMap, createdAt: Date.now() });
    pruneRequestCache(requestCache);
    return token;
  }

  function resolveRequest(token) {
    if (!token || !requestCache.has(token)) {
      return null;
    }
    const record = requestCache.get(token);
    if (!record) {
      return null;
    }
    return record;
  }

  async function analyze(options) {
    const query = typeof options?.query === "string" ? options.query.trim() : "";
    const context = options?.context || {};
    if (!query) {
      return { success: false, error: "Empty request" };
    }

    const interpretation = await interpretRequest(query, context);
    if (!interpretation) {
      return { success: false, error: "Unable to interpret request" };
    }

    const topics = interpretation.topics;
    const { startTime, endTime, label: rangeLabel } = computeTimeRange(interpretation, context);

    let historyItems = [];
    try {
      const searchOptions = { text: "", maxResults: DEFAULT_MAX_RESULTS * 4 };
      if (Number.isFinite(startTime) && startTime > 0) {
        searchOptions.startTime = startTime;
      }
      if (Number.isFinite(endTime) && endTime > 0) {
        searchOptions.endTime = endTime;
      }
      historyItems = await chrome.history.search(searchOptions);
    } catch (error) {
      console.error("Spotlight history assistant search failed", error);
      return { success: false, error: "History unavailable" };
    }

    const filtered = filterByTopics(historyItems, topics);
    const limited = interpretation.quantity
      ? filtered.slice(0, Math.min(filtered.length, interpretation.quantity))
      : filtered.slice(0, DEFAULT_MAX_RESULTS * 2);
    const groups = groupHistoryEntries(limited, topics);
    const requestToken = storeRequest(groups);
    const responseGroups = groups.map((group) => summarizeGroupForResponse(group));
    const feedback = buildFeedback(interpretation, responseGroups, rangeLabel);
    return {
      success: true,
      requestToken,
      intent: {
        action: interpretation.action,
        confidence: interpretation.confidence,
        needsFollowUp: interpretation.needsFollowUp,
        followUpQuestion: interpretation.followUpQuestion,
        topics,
        rangeLabel,
      },
      groups: responseGroups,
      feedback,
    };
  }

  async function execute(options) {
    const token = typeof options?.requestToken === "string" ? options.requestToken : "";
    const action = typeof options?.action === "string" ? options.action : "";
    const groupId = typeof options?.groupId === "string" ? options.groupId : "";
    const entryIds = Array.isArray(options?.entryIds)
      ? options.entryIds.map((id) => (typeof id === "string" ? id : "")).filter(Boolean)
      : [];
    if (!token || !action) {
      throw new Error("Missing request context");
    }
    const record = resolveRequest(token);
    if (!record) {
      throw new Error("Request expired");
    }

    if (!groupId && !entryIds.length) {
      throw new Error("No entries selected");
    }

    const selectedEntries = [];
    if (groupId) {
      const group = record.groups.get(groupId);
      if (!group) {
        throw new Error("Group not found");
      }
      if (entryIds.length) {
        entryIds.forEach((entryId) => {
          const entry = record.entries.get(entryId);
          if (entry) {
            selectedEntries.push(entry);
          }
        });
      } else {
        selectedEntries.push(...group.entries);
      }
    } else {
      entryIds.forEach((entryId) => {
        const entry = record.entries.get(entryId);
        if (entry) {
          selectedEntries.push(entry);
        }
      });
    }

    if (!selectedEntries.length) {
      throw new Error("No matching entries");
    }

    if (action === "open") {
      for (let i = 0; i < selectedEntries.length; i += 1) {
        const entry = selectedEntries[i];
        try {
          await chrome.tabs.create({ url: entry.url, active: i === 0 });
        } catch (error) {
          console.warn("Spotlight history assistant failed to open entry", error);
        }
      }
      return { success: true, opened: selectedEntries.length };
    }

    if (action === "delete") {
      const deleted = [];
      for (const entry of selectedEntries) {
        try {
          await chrome.history.deleteUrl({ url: entry.url });
          deleted.push(entry);
        } catch (error) {
          console.warn("Spotlight history assistant failed to delete entry", error);
        }
      }
      if (!deleted.length) {
        throw new Error("No entries deleted");
      }
      lastDeletion = { entries: deleted, timestamp: Date.now() };
      return { success: true, deleted: deleted.length };
    }

    throw new Error("Unsupported action");
  }

  async function undoDeletion() {
    if (!lastDeletion || !Array.isArray(lastDeletion.entries) || !lastDeletion.entries.length) {
      throw new Error("Nothing to undo");
    }
    for (const entry of lastDeletion.entries) {
      try {
        await chrome.history.addUrl({ url: entry.url });
      } catch (error) {
        console.warn("Spotlight history assistant failed to restore entry", error);
      }
    }
    const restored = lastDeletion.entries.length;
    lastDeletion = null;
    return { success: true, restored };
  }

  return {
    analyze,
    execute,
    undoDeletion,
  };
}

export default createHistoryAssistantService;
