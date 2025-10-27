import { tokenize } from "../search/indexer.js";

function isHistoryAssistantEnabled() {
  const features =
    typeof globalThis !== "undefined" &&
    globalThis &&
    typeof globalThis.SpotlightFeatures === "object"
      ? globalThis.SpotlightFeatures
      : null;
  if (features && typeof features.historyAssistant === "boolean") {
    return features.historyAssistant;
  }
  return true;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["search", "show", "open", "summarize", "delete", "help", "unknown"],
    },
    queryTokens: {
      type: "array",
      items: { type: "string" },
    },
    siteFilters: {
      type: "array",
      items: { type: "string" },
    },
    topics: {
      type: "array",
      items: { type: "string" },
    },
    timeRange: {
      type: "string",
      enum: ["all", "today", "yesterday", "last7", "last30", "older", "unknown"],
    },
    answer: {
      type: "string",
    },
    openCount: {
      type: "integer",
      minimum: 0,
      maximum: 10,
    },
  },
  required: ["intent"],
};

const SYSTEM_PROMPT = `You are Spotlight's Smart History Assistant. Convert natural language
questions about the user's own Chrome browser history into structured
instructions for a local search engine.

Only respond with JSON. Do not include any extra commentary.

Intent rules:
- Use "search" when the user asks to show, list, find, browse, filter, or
  otherwise review history items.
- Use "open" when the user asks to open or resume pages. Assume they want the
  best matching results.
- Use "summarize" when the user wants a recap or summary of their browsing.
- Use "delete" when they ask to erase or remove history.
- Use "help" when they ask about the assistant itself or what you can do.
- Use "unknown" when the request is unrelated to browser history.

Output schema:
{
  "intent": "search|open|summarize|delete|help|unknown",
  "queryTokens": ["lowercase keyword", ...],
  "siteFilters": ["example.com"],
  "topics": ["optional topical keywords"],
  "timeRange": "today|yesterday|last7|last30|older|all",
  "answer": "friendly acknowledgement < 120 characters",
  "openCount": 1
}

Guidelines:
- Keep query tokens short (1-3 words each) and lowercase.
- Use bare domain names (no protocol or paths) for siteFilters.
- Default openCount to 1 if not specified.
- If the user asks for a summary, set intent to "summarize" and include
  helpful keywords in queryTokens.
- If unsure of the time period, use "all".
- The assistant must stay privacy preserving: never invent URLs outside of the
  request. Focus on interpreting intent.
`;

function computeHistoryBoundaries(now = Date.now()) {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startTodayMs = startToday.getTime();
  const startYesterday = startTodayMs - DAY_MS;
  const sevenDaysAgo = now - 7 * DAY_MS;
  const thirtyDaysAgo = now - 30 * DAY_MS;
  return {
    startToday: startTodayMs,
    startYesterday,
    sevenDaysAgo,
    thirtyDaysAgo,
  };
}

function matchesHistoryRange(timestamp, rangeId, boundaries) {
  if (!timestamp) {
    return false;
  }
  const { startToday, startYesterday, sevenDaysAgo, thirtyDaysAgo } = boundaries;
  switch (rangeId) {
    case "today":
      return timestamp >= startToday;
    case "yesterday":
      return timestamp >= startYesterday && timestamp < startToday;
    case "last7":
      return timestamp >= sevenDaysAgo;
    case "last30":
      return timestamp >= thirtyDaysAgo;
    case "older":
      return timestamp > 0 && timestamp < thirtyDaysAgo;
    default:
      return true;
  }
}

function sanitizeStringArray(value, { limit = 6, transform } = {}) {
  if (!Array.isArray(value)) {
    return [];
  }
  const results = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const transformed = transform ? transform(trimmed) : trimmed;
    if (!transformed) {
      continue;
    }
    if (!results.includes(transformed)) {
      results.push(transformed);
      if (results.length >= limit) {
        break;
      }
    }
  }
  return results;
}

function normalizeDomain(value) {
  if (typeof value !== "string") {
    return "";
  }
  let domain = value.trim().toLowerCase();
  if (!domain) {
    return "";
  }
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");
  domain = domain.split(/[\/\s?#]/)[0];
  return domain.replace(/[^a-z0-9.-]+/g, "");
}

const TIME_RANGE_MAP = {
  today: "today",
  "last 24 hours": "today",
  yesterday: "yesterday",
  "last week": "last7",
  week: "last7",
  "past week": "last7",
  "last7": "last7",
  "7days": "last7",
  "last month": "last30",
  month: "last30",
  "past month": "last30",
  "30days": "last30",
  older: "older",
  archive: "older",
  all: "all",
  any: "all",
};

function mapTimeRange(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (TIME_RANGE_MAP[normalized]) {
    return TIME_RANGE_MAP[normalized];
  }
  return null;
}

function sanitizePlan(raw) {
  const plan = {
    intent: "unknown",
    tokens: [],
    siteFilters: [],
    timeRange: null,
    answer: "",
    openCount: 1,
  };

  const intentRaw = typeof raw?.intent === "string" ? raw.intent.trim().toLowerCase() : "";
  const intentMap = {
    show: "search",
    search: "search",
    find: "search",
    list: "search",
    browse: "search",
    open: "open",
    launch: "open",
    resume: "open",
    summarize: "summarize",
    summary: "summarize",
    recap: "summarize",
    delete: "delete",
    remove: "delete",
    clear: "delete",
    help: "help",
    info: "help",
    who: "help",
    unknown: "unknown",
  };
  plan.intent = intentMap[intentRaw] || intentRaw || "unknown";

  const tokenSources = [];
  if (Array.isArray(raw?.queryTokens)) {
    tokenSources.push(...raw.queryTokens);
  }
  if (Array.isArray(raw?.topics)) {
    tokenSources.push(...raw.topics);
  }
  if (Array.isArray(raw?.keywords)) {
    tokenSources.push(...raw.keywords);
  }

  plan.tokens = sanitizeStringArray(tokenSources, {
    limit: 8,
    transform: (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  })
    .flatMap((entry) => tokenize(entry))
    .filter(Boolean);

  const siteArray = Array.isArray(raw?.siteFilters)
    ? raw.siteFilters
    : Array.isArray(raw?.sites)
    ? raw.sites
    : [];
  plan.siteFilters = sanitizeStringArray(siteArray, {
    limit: 5,
    transform: normalizeDomain,
  }).filter(Boolean);

  const timeRaw = typeof raw?.timeRange === "string" ? raw.timeRange : raw?.dateRange;
  plan.timeRange = mapTimeRange(timeRaw) || null;

  const answer = typeof raw?.answer === "string" ? raw.answer.trim() : "";
  plan.answer = answer.length > 180 ? `${answer.slice(0, 177)}…` : answer;

  const openCount = Number(raw?.openCount);
  if (Number.isFinite(openCount) && openCount > 0) {
    plan.openCount = Math.min(Math.round(openCount), 5);
  }

  return plan;
}

function buildQueryFromPlan(plan) {
  const tokens = Array.isArray(plan.tokens) ? plan.tokens.filter(Boolean) : [];
  if (!tokens.length) {
    return "history:";
  }
  return `history: ${tokens.join(" ")}`;
}

function extractHostname(url) {
  if (!url || typeof url !== "string") {
    return "";
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (err) {
    return "";
  }
}

function matchesSiteFilter(hostname, filters) {
  if (!filters || !filters.length) {
    return true;
  }
  if (!hostname) {
    return false;
  }
  const normalized = hostname.toLowerCase();
  return filters.some((filter) => {
    if (!filter) {
      return false;
    }
    const target = filter.toLowerCase();
    return normalized === target || normalized.endsWith(`.${target}`);
  });
}

function filterHistoryItems(items, plan, now = Date.now()) {
  if (!Array.isArray(items)) {
    return [];
  }
  const boundaries = computeHistoryBoundaries(now);
  const tokens = Array.isArray(plan.tokens) ? plan.tokens.filter(Boolean) : [];
  const sites = Array.isArray(plan.siteFilters) ? plan.siteFilters.filter(Boolean) : [];
  const timeRange = plan.timeRange;
  return items.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    if (timeRange && timeRange !== "all") {
      const timestamp =
        typeof item.lastVisitTime === "number" ? item.lastVisitTime : Number(item.lastVisitTime) || 0;
      if (!matchesHistoryRange(timestamp, timeRange, boundaries)) {
        return false;
      }
    }
    if (sites.length) {
      const hostname = item.origin ? extractHostname(item.origin) : extractHostname(item.url);
      if (!matchesSiteFilter(hostname, sites)) {
        return false;
      }
    }
    if (tokens.length) {
      const haystack = `${item.title || ""} ${item.url || ""}`.toLowerCase();
      for (const token of tokens) {
        if (!haystack.includes(token)) {
          return false;
        }
      }
    }
    return true;
  });
}

function summarizeDomains(items) {
  const counts = new Map();
  for (const item of items) {
    const hostname = extractHostname(item.url || "");
    if (!hostname) {
      continue;
    }
    const normalized = hostname.replace(/^www\./, "").toLowerCase();
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 3);
}

function formatRelativeTime(timestamp, now = Date.now()) {
  if (!timestamp) {
    return "";
  }
  const diff = now - timestamp;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (diff < DAY_MS) {
    const hours = Math.round(diff / (60 * 60 * 1000));
    if (hours <= 1) {
      return formatter.format(-1, "hour");
    }
    return formatter.format(-hours, "hour");
  }
  if (diff < 7 * DAY_MS) {
    const days = Math.round(diff / DAY_MS);
    return formatter.format(-days, "day");
  }
  const weeks = Math.round(diff / (7 * DAY_MS));
  if (weeks <= 4) {
    return formatter.format(-weeks, "week");
  }
  const months = Math.round(diff / (30 * DAY_MS));
  return formatter.format(-Math.max(months, 1), "month");
}

function buildSummary(items, plan, now = Date.now()) {
  if (!items.length) {
    return "I couldn't find matching visits in your history.";
  }
  const domainSummary = summarizeDomains(items);
  const total = items.length;
  const domainText = domainSummary.length
    ? `Top sites: ${domainSummary
        .map(([domain, count]) => `${domain} (${count})`)
        .join(", ")}.`
    : "";
  const recent = items
    .slice()
    .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))
    .slice(0, 3)
    .map((item) => {
      const when = formatRelativeTime(item.lastVisitTime || 0, now);
      const title = item.title || item.url || "Untitled";
      return when ? `${title} (${when})` : title;
    });
  const recentText = recent.length ? ` Recent pages: ${recent.join(" · ")}.` : "";
  const scopeText = plan.timeRange
    ? plan.timeRange === "all"
      ? "overall"
      : plan.timeRange === "last7"
      ? "last 7 days"
      : plan.timeRange === "last30"
      ? "last 30 days"
      : plan.timeRange
    : "requested";
  return `You have ${total} matching visits (${scopeText}). ${domainText}${recentText}`.trim();
}

function buildDefaultAnswer(plan, matchCount) {
  switch (plan.intent) {
    case "open":
      return matchCount > 0
        ? `Opening the top ${plan.openCount === 1 ? "result" : `${Math.min(plan.openCount, matchCount)} results`}.`
        : "I couldn't find anything to open.";
    case "summarize":
      return matchCount > 0
        ? "Here's a quick summary of your matching history."
        : "I couldn't find anything to summarize.";
    case "search":
      return matchCount > 0 ? "Showing the most relevant history results." : "No matching history found.";
    default:
      return "";
  }
}

function buildPromptMessages(requestText, items) {
  const topDomains = summarizeDomains(items.slice(0, 200));
  const domainLines = topDomains.length
    ? `Common domains include: ${topDomains.map(([domain, count]) => `${domain} (${count})`).join(", ")}.`
    : "";
  const instructions = `Supported time ranges: today, yesterday, last7, last30, older. ${domainLines}`;
  const example =
    '{"intent":"search","queryTokens":["youtube","tutorial"],"siteFilters":["youtube.com"],"timeRange":"last7","answer":"Looking for YouTube tutorials from the past week."}';
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Request: ${requestText}\n${instructions}\nRespond with JSON only. Example: ${example}`,
    },
  ];
}

export function createHistoryAssistantService() {
  if (!isHistoryAssistantEnabled()) {
    return {
      isEnabled: () => false,
      interpret: async () => {
        throw new Error("History assistant disabled");
      },
    };
  }

  let sessionInstance = null;
  let sessionPromise = null;

  async function ensureSession() {
    if (sessionInstance) {
      return sessionInstance;
    }
    if (sessionPromise) {
      return sessionPromise;
    }
    if (
      typeof globalThis.LanguageModel !== "object" &&
      typeof globalThis.LanguageModel !== "function"
    ) {
      throw new Error("Smart history assistant unavailable");
    }
    const availability = await globalThis.LanguageModel.availability();
    if (availability === "unavailable") {
      throw new Error("Smart history assistant unavailable");
    }
    sessionPromise = globalThis.LanguageModel.create({
      monitor(monitor) {
        if (!monitor || typeof monitor.addEventListener !== "function") {
          return;
        }
        monitor.addEventListener("downloadprogress", (event) => {
          const percent =
            typeof event?.loaded === "number" ? Math.round(event.loaded * 100) : null;
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

  async function interpret(requestText, { data } = {}) {
    if (!isHistoryAssistantEnabled()) {
      throw new Error("Smart history assistant disabled");
    }
    const trimmed = typeof requestText === "string" ? requestText.trim() : "";
    if (!trimmed) {
      throw new Error("Ask something about your history");
    }

    const historyItems = Array.isArray(data?.items)
      ? data.items.filter((item) => item && item.type === "history")
      : [];

    const session = await ensureSession();
    const promptMessages = buildPromptMessages(trimmed, historyItems);
    const raw = await session.prompt(promptMessages, {
      responseConstraint: RESPONSE_SCHEMA,
    });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error("History assistant returned invalid response");
    }

    const plan = sanitizePlan(parsed);
    const filteredItems = filterHistoryItems(historyItems, plan);
    const matchCount = filteredItems.length;

    if (!plan.answer) {
      plan.answer = buildDefaultAnswer(plan, matchCount);
    }

    plan.query = buildQueryFromPlan(plan);
    plan.filters = {
      tokens: plan.tokens.slice(),
      siteFilters: plan.siteFilters.slice(),
      timeRange: plan.timeRange,
      answer: plan.answer,
    };
    plan.matchCount = matchCount;
    plan.summary = plan.intent === "summarize" ? buildSummary(filteredItems, plan) : "";
    plan.canSearch = ["search", "open", "summarize"].includes(plan.intent);
    plan.unsupported = plan.intent === "delete";

    if (plan.unsupported) {
      plan.answer =
        plan.answer || "I can help find or summarize history, but deleting it isn't supported yet.";
      plan.canSearch = false;
    }

    if (plan.intent === "help") {
      plan.answer =
        plan.answer ||
        "Ask me to show, open, or summarize your browsing history — for example, 'show YouTube videos from yesterday'.";
      plan.canSearch = false;
    }

    if (!plan.canSearch) {
      plan.query = "";
      plan.filters = null;
    }

    return plan;
  }

  return {
    isEnabled: () => true,
    interpret,
  };
}

