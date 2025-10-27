import { isSmartHistoryAssistantEnabled } from "../shared/feature-flags.js";

const MAX_SUMMARY_ENTRIES = 40;
const MAX_TITLE_LENGTH = 160;
const MAX_URL_LENGTH = 200;
const SUMMARY_STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
  "you",
  "your",
]);

const SUMMARY_SYSTEM_PROMPT = `You are Spotlight's Smart History summarizer living inside a local Chrome extension. ` +
  `You receive a structured snapshot of browsing history entries and must turn it into a concise, upbeat digest. ` +
  `Use only the provided data—never invent sites, products, or activities. ` +
  `Write in English. Keep the response under 120 words. ` +
  `Follow this exact structure:\n` +
  `In <TIME_RANGE>, you mainly:\n\n` +
  `• <bullet one>\n` +
  `• <bullet two>\n` +
  `• <bullet three>\n` +
  `(Add up to two more bullets if there are distinct themes.)\n\n` +
  `👉 Overall: <friendly one-sentence takeaway>\n` +
  `Bullets must reference real domains, products, or topics found in the entries. ` +
  `The overall takeaway should blend the dominant themes or intent of the browsing.`;

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const rawTitle = typeof entry.title === "string" ? entry.title.trim() : "";
  const title = rawTitle ? rawTitle.slice(0, MAX_TITLE_LENGTH) : "";
  const rawUrl = typeof entry.url === "string" ? entry.url.trim() : "";
  const url = rawUrl ? rawUrl.slice(0, MAX_URL_LENGTH) : "";
  if (!title && !url) {
    return null;
  }
  const lastVisitTime = Number.isFinite(entry.lastVisitTime)
    ? entry.lastVisitTime
    : Number.isFinite(entry.timeStamp)
    ? entry.timeStamp
    : null;
  const visitCount = Number.isFinite(entry.visitCount) && entry.visitCount > 0 ? entry.visitCount : null;
  let domain = "";
  if (typeof entry.domain === "string" && entry.domain.trim()) {
    domain = entry.domain.trim().toLowerCase();
  } else if (url) {
    try {
      const parsed = new URL(url);
      domain = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    } catch (error) {
      const sanitized = url.replace(/^https?:\/\//i, "");
      domain = sanitized.split("/")[0].toLowerCase();
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

function formatDateLabel(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Unknown";
  }
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function extractKeywords(text) {
  if (!text) {
    return [];
  }
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && token.length > 2 && !SUMMARY_STOP_WORDS.has(token));
}

function computeAggregates(entries) {
  const domainCounts = new Map();
  const keywordCounts = new Map();
  const dayCounts = new Map();

  entries.forEach((entry) => {
    if (entry.domain) {
      domainCounts.set(entry.domain, (domainCounts.get(entry.domain) || 0) + 1);
    }
    const tokens = new Set([
      ...extractKeywords(entry.title),
      ...extractKeywords(entry.domain.replace(/\./g, " ")),
    ]);
    tokens.forEach((token) => {
      keywordCounts.set(token, (keywordCounts.get(token) || 0) + 1);
    });
    if (Number.isFinite(entry.lastVisitTime) && entry.lastVisitTime > 0) {
      const dayLabel = new Date(entry.lastVisitTime).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      dayCounts.set(dayLabel, (dayCounts.get(dayLabel) || 0) + 1);
    }
  });

  const sortedDomains = Array.from(domainCounts.entries()).sort((a, b) => b[1] - a[1]);
  const sortedKeywords = Array.from(keywordCounts.entries()).sort((a, b) => b[1] - a[1]);
  const sortedDays = Array.from(dayCounts.entries()).sort((a, b) => b[1] - a[1]);

  return {
    domains: sortedDomains.slice(0, 6),
    keywords: sortedKeywords.slice(0, 10),
    days: sortedDays.slice(0, 5),
  };
}

function buildEntryLines(entries) {
  return entries.map((entry, index) => {
    const parts = [];
    const position = `${index + 1}.`;
    parts.push(position);
    if (entry.domain) {
      parts.push(entry.domain);
    }
    if (entry.visitCount) {
      parts.push(`visits:${entry.visitCount}`);
    }
    if (entry.lastVisitTime) {
      parts.push(formatDateLabel(entry.lastVisitTime));
    }
    const headline = entry.title || entry.url;
    return `${parts.join(" | ")} — ${headline}`;
  });
}

function buildSummaryPrompt({
  timeRangeLabel,
  totalCount,
  query,
  topic,
  site,
  planMessage,
  entries,
  aggregates,
}) {
  const safeRange = timeRangeLabel || "recent activity";
  const headerLines = [SUMMARY_SYSTEM_PROMPT];
  headerLines.push(`Time range label: ${safeRange}`);
  if (Number.isFinite(totalCount)) {
    headerLines.push(`Total matching entries: ${totalCount}`);
  }
  if (query) {
    headerLines.push(`Search terms: ${query}`);
  }
  if (topic) {
    headerLines.push(`Focus topic: ${topic}`);
  }
  if (site) {
    headerLines.push(`Requested site: ${site}`);
  }
  if (planMessage) {
    headerLines.push(`Assistant intent: ${planMessage}`);
  }
  if (aggregates.domains.length) {
    headerLines.push(
      `Top domains: ${aggregates.domains
        .map(([domain, count]) => `${domain} (${count})`)
        .join(", ")}`
    );
  }
  if (aggregates.keywords.length) {
    headerLines.push(
      `Top recurring keywords: ${aggregates.keywords
        .slice(0, 6)
        .map(([word, count]) => `${word} (${count})`)
        .join(", ")}`
    );
  }
  if (aggregates.days.length) {
    headerLines.push(
      `Peak activity days: ${aggregates.days
        .map(([day, count]) => `${day} (${count})`)
        .join(", ")}`
    );
  }
  headerLines.push("\nHistory entries:");
  const entryLines = buildEntryLines(entries);
  headerLines.push(...entryLines);
  headerLines.push("\nWrite the summary now.");
  return headerLines.join("\n");
}

function sanitizeTimeRangeLabel(label) {
  if (typeof label !== "string") {
    return "";
  }
  return label.trim().slice(0, 120);
}

export function createHistorySummaryService() {
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

  async function summarize(options = {}) {
    if (!isSmartHistoryAssistantEnabled()) {
      throw new Error("Smart history assistant disabled");
    }
    const rawEntries = Array.isArray(options.entries) ? options.entries : [];
    const sanitizedEntries = rawEntries
      .map((entry) => sanitizeEntry(entry))
      .filter(Boolean)
      .slice(0, MAX_SUMMARY_ENTRIES);
    if (!sanitizedEntries.length) {
      throw new Error("No history entries to summarize");
    }

    const aggregates = computeAggregates(sanitizedEntries);
    const timeRangeLabel = sanitizeTimeRangeLabel(options.timeRangeLabel || options.timeRange?.label || options.timeRange?.raw);
    const totalCount = Number.isFinite(options.totalCount) ? options.totalCount : sanitizedEntries.length;
    const query = typeof options.query === "string" ? options.query.trim().slice(0, 120) : "";
    const topic = typeof options.topic === "string" ? options.topic.trim().slice(0, 120) : "";
    const site = typeof options.site === "string" ? options.site.trim().slice(0, 120) : "";
    const planMessage = typeof options.planMessage === "string" ? options.planMessage.trim().slice(0, 160) : "";

    const prompt = buildSummaryPrompt({
      timeRangeLabel,
      totalCount,
      query,
      topic,
      site,
      planMessage,
      entries: sanitizedEntries,
      aggregates,
    });

    const session = await ensureSession();
    const result = await session.prompt(prompt);
    const summary = typeof result === "string" ? result.trim() : "";
    if (!summary) {
      throw new Error("History summary unavailable");
    }
    return summary;
  }

  return {
    async summarize(options) {
      return summarize(options);
    },
  };
}

