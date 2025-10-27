import { isSmartHistoryAssistantEnabled } from "../shared/feature-flags.js";

const MAX_SUMMARY_ENTRIES = 40;
const SUMMARY_PROMPT_TIMEOUT_MS = 10000;
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

const SUMMARY_SYSTEM_PROMPT =
  `You are Spotlight's Smart History summarizer living inside a local Chrome extension. ` +
  `You receive structured snapshots of browsing history and turn them into concise, upbeat digests. ` +
  `Use only the provided data—never invent sites, products, or activities. ` +
  `Respond in English with a friendly, confident tone unless directed otherwise. ` +
  `Default structure: intro line beginning with "In <TIME_RANGE>, you mainly:", followed by bullet insights and an "👉 Overall:" takeaway. ` +
  `Additional guidance will follow for each request.`;

const TWO_HOUR_BUCKET_COUNT = 12;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

const SUMMARY_TONES = new Set(["formal", "casual", "action"]);

function normalizeToneDirective(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return SUMMARY_TONES.has(normalized) ? normalized : null;
}

function sanitizeSummaryContext(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const context = {};
  if (Number.isFinite(raw.entryCount) && raw.entryCount > 0) {
    context.entryCount = Math.floor(raw.entryCount);
  }
  if (Number.isFinite(raw.totalVisits) && raw.totalVisits > 0) {
    context.totalVisits = Math.floor(raw.totalVisits);
  }
  if (Number.isFinite(raw.uniqueDomains) && raw.uniqueDomains > 0) {
    context.uniqueDomains = Math.floor(raw.uniqueDomains);
  }
  if (Array.isArray(raw.domainShares)) {
    context.domainShares = raw.domainShares
      .map((item) => {
        if (!item || typeof item.domain !== "string") {
          return null;
        }
        const shareValue = normalizeShareValue(item.share);
        if (shareValue === null) {
          return null;
        }
        const countValue = Number.isFinite(item.count) && item.count > 0 ? Math.floor(item.count) : null;
        return { domain: item.domain.trim().toLowerCase(), share: shareValue, count: countValue };
      })
      .filter(Boolean)
      .slice(0, 8);
  }
  if (Array.isArray(raw.topKeywords)) {
    context.topKeywords = raw.topKeywords
      .map((item) => {
        if (!item || typeof item.keyword !== "string") {
          return null;
        }
        const shareValue = normalizeShareValue(item.share);
        if (shareValue === null) {
          return null;
        }
        const countValue = Number.isFinite(item.count) && item.count > 0 ? Math.floor(item.count) : null;
        return { keyword: item.keyword.trim().toLowerCase(), share: shareValue, count: countValue };
      })
      .filter(Boolean)
      .slice(0, 8);
  }
  if (raw.timeOfDayPeak && typeof raw.timeOfDayPeak === "object") {
    const label = typeof raw.timeOfDayPeak.label === "string" ? raw.timeOfDayPeak.label.trim() : "";
    const share = normalizeShareValue(raw.timeOfDayPeak.share);
    if (label) {
      context.timeOfDayPeak = { label, share };
    }
  }
  return context;
}

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

function sanitizeEntries(rawEntries, maxEntries = MAX_SUMMARY_ENTRIES) {
  if (!Array.isArray(rawEntries) || !rawEntries.length) {
    return [];
  }
  const sanitized = [];
  for (let index = 0; index < rawEntries.length && sanitized.length < maxEntries; index += 1) {
    const entry = sanitizeEntry(rawEntries[index]);
    if (entry) {
      sanitized.push(entry);
    }
  }
  return sanitized;
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

function formatTimeBucketLabel(bucketIndex) {
  const normalized = ((bucketIndex % TWO_HOUR_BUCKET_COUNT) + TWO_HOUR_BUCKET_COUNT) % TWO_HOUR_BUCKET_COUNT;
  const startHour = (normalized * 2) % 24;
  const endHour = (startHour + 2) % 24;
  const formatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const baseDate = new Date();
  baseDate.setHours(startHour, 0, 0, 0);
  const startLabel = formatter.format(baseDate);
  baseDate.setHours(endHour, 0, 0, 0);
  const endLabel = formatter.format(baseDate);
  return `${startLabel}–${endLabel}`;
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
  const domainWeights = new Map();
  const domainCounts = new Map();
  const keywordWeights = new Map();
  const dayCounts = new Map();
  const timeBuckets = new Array(TWO_HOUR_BUCKET_COUNT).fill(0);
  let totalWeight = 0;

  entries.forEach((entry) => {
    const weight = Number.isFinite(entry.visitCount) && entry.visitCount > 0 ? entry.visitCount : 1;
    totalWeight += weight;
    if (entry.domain) {
      domainWeights.set(entry.domain, (domainWeights.get(entry.domain) || 0) + weight);
      domainCounts.set(entry.domain, (domainCounts.get(entry.domain) || 0) + 1);
    }
    const tokens = new Set([
      ...extractKeywords(entry.title),
      ...extractKeywords(entry.domain.replace(/\./g, " ")),
    ]);
    tokens.forEach((token) => {
      keywordWeights.set(token, (keywordWeights.get(token) || 0) + weight);
    });
    if (Number.isFinite(entry.lastVisitTime) && entry.lastVisitTime > 0) {
      const dayLabel = new Date(entry.lastVisitTime).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      dayCounts.set(dayLabel, (dayCounts.get(dayLabel) || 0) + weight);
      const hour = new Date(entry.lastVisitTime).getHours();
      if (Number.isFinite(hour)) {
        const bucketIndex = clamp(Math.floor(hour / 2), 0, TWO_HOUR_BUCKET_COUNT - 1);
        timeBuckets[bucketIndex] += weight;
      }
    }
  });

  const sortedDomains = Array.from(domainWeights.entries()).sort((a, b) => b[1] - a[1]);
  const sortedKeywords = Array.from(keywordWeights.entries()).sort((a, b) => b[1] - a[1]);
  const sortedDays = Array.from(dayCounts.entries()).sort((a, b) => b[1] - a[1]);

  let peakBucketIndex = -1;
  let peakBucketWeight = 0;
  timeBuckets.forEach((value, index) => {
    if (value > peakBucketWeight) {
      peakBucketIndex = index;
      peakBucketWeight = value;
    }
  });

  return {
    domains: sortedDomains.slice(0, 8),
    domainCounts,
    keywords: sortedKeywords.slice(0, 12),
    days: sortedDays.slice(0, 6),
    totalWeight,
    peakBucketIndex,
    peakBucketWeight,
    timeBuckets,
  };
}

function computeBulletRange(primaryCount, comparisonCount = 0) {
  const total = Math.max(primaryCount || 0, comparisonCount || 0);
  if (total <= 1) {
    return { min: 1, max: 1 };
  }
  if (total <= 3) {
    return { min: 1, max: 2 };
  }
  if (total <= 5) {
    return { min: 2, max: 3 };
  }
  if (total <= 12) {
    return { min: 3, max: comparisonCount > 0 ? 5 : 4 };
  }
  if (total <= 25) {
    return { min: 4, max: comparisonCount > 0 ? 6 : 5 };
  }
  if (total <= 35) {
    return { min: 5, max: comparisonCount > 0 ? 7 : 6 };
  }
  return { min: 5, max: comparisonCount > 0 ? 8 : 7 };
}

function normalizeShareValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = typeof value === "string" ? Number.parseFloat(value) : value;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  if (numeric > 1) {
    return clamp(numeric / 100, 0, 1);
  }
  return clamp(numeric, 0, 1);
}

function formatSharePercent(share) {
  if (!Number.isFinite(share) || share <= 0) {
    return "";
  }
  const percent = Math.round(share * 1000) / 10;
  if (!Number.isFinite(percent) || percent <= 0) {
    return "";
  }
  return `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}%`;
}

function buildSummaryContextSnapshot(entries, aggregates, provided = {}) {
  const entryCount = Number.isFinite(provided.entryCount) && provided.entryCount > 0
    ? Math.floor(provided.entryCount)
    : entries.length;
  const derivedVisits = Number.isFinite(aggregates.totalWeight) && aggregates.totalWeight > 0
    ? aggregates.totalWeight
    : entryCount;
  const totalVisits = Number.isFinite(provided.totalVisits) && provided.totalVisits > 0
    ? provided.totalVisits
    : derivedVisits;
  const derivedUnique = aggregates.domainCounts instanceof Map ? aggregates.domainCounts.size : aggregates.domains.length;
  const uniqueDomains = Number.isFinite(provided.uniqueDomains) && provided.uniqueDomains > 0
    ? Math.floor(provided.uniqueDomains)
    : derivedUnique;

  let domainShares;
  if (Array.isArray(provided.domainShares) && provided.domainShares.length) {
    domainShares = provided.domainShares
      .map((item) => {
        if (!item || typeof item.domain !== "string") {
          return null;
        }
        const share = normalizeShareValue(item.share);
        if (share === null) {
          return null;
        }
        const count = Number.isFinite(item.count) && item.count > 0 ? Math.floor(item.count) : null;
        return { domain: item.domain.trim().toLowerCase(), share, count };
      })
      .filter(Boolean);
  } else {
    domainShares = aggregates.domains.slice(0, 4).map(([domain, weight]) => ({
      domain,
      share: totalVisits > 0 ? clamp(weight / totalVisits, 0, 1) : 0,
      count:
        aggregates.domainCounts instanceof Map && aggregates.domainCounts.has(domain)
          ? aggregates.domainCounts.get(domain)
          : null,
    }));
  }

  let keywordShares;
  if (Array.isArray(provided.topKeywords) && provided.topKeywords.length) {
    keywordShares = provided.topKeywords
      .map((item) => {
        if (!item || typeof item.keyword !== "string") {
          return null;
        }
        const share = normalizeShareValue(item.share);
        const count = Number.isFinite(item.count) && item.count > 0 ? Math.floor(item.count) : null;
        return share !== null ? { keyword: item.keyword.trim().toLowerCase(), share, count } : null;
      })
      .filter(Boolean);
  } else {
    keywordShares = aggregates.keywords.slice(0, 6).map(([keyword, weight]) => ({
      keyword,
      share: totalVisits > 0 ? clamp(weight / totalVisits, 0, 1) : 0,
      count: null,
    }));
  }

  let timeOfDay;
  if (provided.timeOfDayPeak && typeof provided.timeOfDayPeak === "object") {
    const label = typeof provided.timeOfDayPeak.label === "string" ? provided.timeOfDayPeak.label.trim() : "";
    const share = normalizeShareValue(provided.timeOfDayPeak.share);
    if (label) {
      timeOfDay = {
        label,
        share: share !== null ? share : null,
      };
    }
  }
  if (!timeOfDay && Number.isFinite(aggregates.peakBucketIndex) && aggregates.peakBucketIndex >= 0) {
    const share = totalVisits > 0 ? clamp(aggregates.peakBucketWeight / totalVisits, 0, 1) : null;
    timeOfDay = {
      label: formatTimeBucketLabel(aggregates.peakBucketIndex),
      share,
    };
  }

  const topKeyword = keywordShares.length ? keywordShares[0] : null;

  return {
    entryCount,
    totalVisits,
    uniqueDomains,
    domainShares,
    keywordShares,
    topKeyword,
    timeOfDay,
  };
}

function buildContextLines(snapshot) {
  if (!snapshot) {
    return [];
  }
  const lines = [];
  if (Array.isArray(snapshot.domainShares) && snapshot.domainShares.length) {
    const parts = snapshot.domainShares.slice(0, 4).map((item) => {
      const shareLabel = formatSharePercent(item.share);
      const base = item.domain;
      if (shareLabel) {
        return `${base} (${shareLabel})`;
      }
      return base;
    });
    if (parts.length) {
      lines.push(`- Most frequent domains: ${parts.join(", ")}`);
    }
  }
  if (snapshot.topKeyword && snapshot.topKeyword.keyword) {
    const keywordLabel = snapshot.topKeyword.keyword;
    const shareLabel = formatSharePercent(snapshot.topKeyword.share);
    lines.push(
      shareLabel
        ? `- Top topic: ${keywordLabel} (${shareLabel})`
        : `- Top topic: ${keywordLabel}`,
    );
  }
  if (Array.isArray(snapshot.keywordShares) && snapshot.keywordShares.length > 1) {
    const secondary = snapshot.keywordShares.slice(1, 4)
      .map((item) => {
        const shareLabel = formatSharePercent(item.share);
        return shareLabel ? `${item.keyword} (${shareLabel})` : item.keyword;
      })
      .filter(Boolean);
    if (secondary.length) {
      lines.push(`- Other recurring themes: ${secondary.join(", ")}`);
    }
  }
  if (snapshot.timeOfDay && snapshot.timeOfDay.label) {
    const shareLabel = formatSharePercent(snapshot.timeOfDay.share);
    lines.push(
      shareLabel
        ? `- Peak activity: ${snapshot.timeOfDay.label} (${shareLabel} of visits)`
        : `- Peak activity: ${snapshot.timeOfDay.label}`,
    );
  }
  if (snapshot.entryCount > 0) {
    const domainLabel = snapshot.uniqueDomains > 0 ? `${snapshot.uniqueDomains} domain${snapshot.uniqueDomains === 1 ? "" : "s"}` : "several domains";
    const visitLabel = snapshot.totalVisits > 0 ? `${snapshot.totalVisits} visit${snapshot.totalVisits === 1 ? "" : "s"}` : "multiple visits";
    lines.push(`- Entries analyzed: ${snapshot.entryCount} across ${domainLabel} (${visitLabel})`);
  }
  return lines;
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
  bulletRange,
  tone,
  context,
  comparison,
}) {
  const safeRange = timeRangeLabel || "recent activity";
  const minBullets = Math.max(1, Number.isFinite(bulletRange?.min) ? Math.floor(bulletRange.min) : 3);
  const maxBullets = Math.max(minBullets, Number.isFinite(bulletRange?.max) ? Math.floor(bulletRange.max) : Math.max(minBullets, 5));
  const headerLines = [SUMMARY_SYSTEM_PROMPT];
  headerLines.push(
    `Aim for ${minBullets}-${maxBullets} focused bullet${maxBullets === 1 ? "" : "s"} that capture distinct themes. Group related visits instead of repeating near-identical items.`,
  );
  if (entries.length <= 5) {
    headerLines.push("Keep the recap tight when only a few entries are provided.");
  }
  if (maxBullets >= 6) {
    headerLines.push("Feel free to cluster items into broader buckets when many entries are present.");
  }
  if (tone === "formal") {
    headerLines.push("Adopt a polished, academic tone without sounding stiff.");
  } else if (tone === "casual") {
    headerLines.push("Use a light, conversational tone as if chatting with a friend.");
  } else if (tone === "action") {
    headerLines.push("Use an energetic, action-oriented tone that highlights progress and next steps.");
  }
  if (comparison && Array.isArray(comparison.entries) && comparison.entries.length) {
    headerLines.push("Include at least one bullet that contrasts the primary range with the comparison range.");
  }
  headerLines.push("Never invent data or reference sites that are not present in the entries or context.");
  headerLines.push("\nTime range label: " + safeRange);
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

  const snapshot = buildSummaryContextSnapshot(entries, aggregates, context);
  const contextLines = buildContextLines(snapshot);
  if (contextLines.length) {
    headerLines.push("\nContext:");
    headerLines.push(...contextLines);
  }

  headerLines.push("\nHistory entries:");
  const entryLines = buildEntryLines(entries);
  headerLines.push(...entryLines);

  if (comparison && Array.isArray(comparison.entries) && comparison.entries.length) {
    const comparisonLabel = comparison.label || "comparison window";
    const comparisonSnapshot = buildSummaryContextSnapshot(
      comparison.entries,
      comparison.aggregates,
      comparison.context,
    );
    const comparisonLines = buildContextLines(comparisonSnapshot);
    headerLines.push(`\nComparison range label: ${comparisonLabel}`);
    if (Number.isFinite(comparison.totalCount)) {
      headerLines.push(`Comparison total entries: ${comparison.totalCount}`);
    }
    if (comparisonLines.length) {
      headerLines.push("Comparison context:");
      headerLines.push(...comparisonLines);
    }
    headerLines.push("\nComparison entries:");
    headerLines.push(...buildEntryLines(comparison.entries));
  }

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

  function buildTimeoutError() {
    return new Error("History summary timed out");
  }

  function promptWithTimeout(session, prompt, timeoutMs = SUMMARY_PROMPT_TIMEOUT_MS) {
    const hasAbortController = typeof AbortController === "function";
    const controller = hasAbortController ? new AbortController() : null;
    const requestPromise = controller
      ? session.prompt(prompt, { signal: controller.signal })
      : session.prompt(prompt);

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return requestPromise;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const handleResolve = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };

      const handleReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        if (controller) {
          try {
            controller.abort();
          } catch (abortError) {
            console.warn("Spotlight: history summary abort failed", abortError);
          }
        }
        cleanup();
        reject(buildTimeoutError());
      }, Math.max(0, timeoutMs));

      requestPromise.then(handleResolve, (error) => {
        if (
          error &&
          (error.name === "AbortError" || error.message === "The operation was aborted." || error.code === 20)
        ) {
          handleReject(buildTimeoutError());
          return;
        }
        handleReject(error);
      });
    });
  }

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
    const sanitizedEntries = sanitizeEntries(rawEntries, MAX_SUMMARY_ENTRIES);
    if (!sanitizedEntries.length) {
      throw new Error("No history entries to summarize");
    }

    const aggregates = computeAggregates(sanitizedEntries);
    const tone = normalizeToneDirective(options.tone);
    const contextData = sanitizeSummaryContext(options.context);

    const comparisonRaw = Array.isArray(options.comparison?.entries) ? options.comparison.entries : [];
    const comparisonEntries = sanitizeEntries(comparisonRaw, MAX_SUMMARY_ENTRIES);
    const comparisonAggregates = comparisonEntries.length ? computeAggregates(comparisonEntries) : null;
    const comparisonContext = sanitizeSummaryContext(options.comparison?.context);
    const comparisonLabelCandidate =
      (typeof options.comparison?.label === "string" ? options.comparison.label : "") ||
      (typeof options.comparison?.timeRangeLabel === "string" ? options.comparison.timeRangeLabel : "");
    const comparisonTimeLabel = sanitizeTimeRangeLabel(
      comparisonLabelCandidate || options.comparison?.timeRange?.label || options.comparison?.timeRange?.raw || "",
    );
    const comparisonTotalCount = Number.isFinite(options.comparison?.totalCount)
      ? options.comparison.totalCount
      : comparisonEntries.length || null;
    const bulletRange = computeBulletRange(sanitizedEntries.length, comparisonEntries.length);

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
      bulletRange,
      tone,
      context: contextData,
      comparison:
        comparisonEntries.length
          ? {
              label: comparisonTimeLabel || sanitizeTimeRangeLabel(options.comparison?.label || ""),
              totalCount: comparisonTotalCount,
              entries: comparisonEntries,
              aggregates: comparisonAggregates,
              context: comparisonContext,
            }
          : null,
    });

    const session = await ensureSession();
    let result;
    try {
      result = await promptWithTimeout(session, prompt);
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw buildTimeoutError();
      }
      throw error;
    }
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

