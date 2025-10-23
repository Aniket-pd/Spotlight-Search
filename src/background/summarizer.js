const SUMMARY_CACHE_LIMIT = 40;
const PAGE_CACHE_LIMIT = 24;
const SUMMARY_TTL = 15 * 60 * 1000;
const PAGE_CACHE_TTL = 6 * 60 * 1000;
const MAX_CONTENT_LENGTH = 12000;
const STREAMING_UPDATE_INTERVAL = 350;

function pruneCache(map, limit) {
  if (!map || map.size <= limit) {
    return;
  }
  const entries = Array.from(map.entries());
  entries.sort((a, b) => {
    const aTime = a[1]?.lastUsed || 0;
    const bTime = b[1]?.lastUsed || 0;
    return aTime - bTime;
  });
  while (map.size > limit && entries.length) {
    const [key] = entries.shift();
    map.delete(key);
  }
}

function normalizeWhitespace(text = "") {
  return text
    .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

function sanitizeContent(text = "") {
  if (!text) {
    return "";
  }
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= MAX_CONTENT_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, MAX_CONTENT_LENGTH);
}

function htmlToText(html = "") {
  if (!html) {
    return "";
  }
  let sanitized = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  sanitized = sanitized.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  sanitized = sanitized.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ");
  sanitized = sanitized.replace(/<\/(p|div|h[1-6]|li|section|article|br|tr)>/gi, "\n");
  sanitized = sanitized.replace(/<li[^>]*>/gi, "\n- ");
  sanitized = sanitized.replace(/<[^>]+>/g, " ");
  return sanitizeContent(sanitized);
}

function computeFingerprint(text = "") {
  if (!text) {
    return "0:0";
  }
  let hash = 0;
  const limit = Math.min(text.length, 4096);
  for (let i = 0; i < limit; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `${hash}:${text.length}`;
}

function cleanMarkdownText(text = "") {
  if (!text) {
    return "";
  }
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSummaryBullets(markdown = "") {
  if (!markdown) {
    return [];
  }
  const lines = markdown.split(/\r?\n/);
  const bullets = [];
  let current = "";
  for (const line of lines) {
    const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bulletMatch) {
      if (current) {
        bullets.push(cleanMarkdownText(current));
      }
      current = bulletMatch[1];
    } else if (current) {
      current = `${current} ${line.trim()}`.trim();
    }
  }
  if (current) {
    bullets.push(cleanMarkdownText(current));
  }
  if (!bullets.length) {
    const cleaned = cleanMarkdownText(markdown);
    if (!cleaned) {
      return [];
    }
    const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
    return sentences.slice(0, 3);
  }
  return bullets.map(cleanMarkdownText).filter(Boolean).slice(0, 7);
}

function toErrorMessage(error) {
  if (!error) {
    return "Unknown summarizer error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error.message === "string" && error.message) {
    return error.message;
  }
  return "Unable to generate summary";
}

function safeNotify(callback, payload) {
  if (typeof callback !== "function") {
    return;
  }
  try {
    callback(payload);
  } catch (err) {
    console.warn("Spotlight: summary progress notification failed", err);
  }
}

async function queryTabText(tabId) {
  if (typeof tabId !== "number" || Number.isNaN(tabId)) {
    return null;
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "SPOTLIGHT_PAGE_TEXT_REQUEST" });
    if (!response || !response.success || !response.text) {
      return null;
    }
    return {
      text: response.text,
      title: typeof response.title === "string" ? response.title : "",
      lastModified: typeof response.lastModified === "string" ? response.lastModified : null,
      etag: typeof response.etag === "string" ? response.etag : null,
      source: "tab",
    };
  } catch (err) {
    console.warn("Spotlight: failed to read tab text for summary", err);
    return null;
  }
}

function extractTitleFromHtml(html = "") {
  if (!html) {
    return "";
  }
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match && match[1]) {
    return sanitizeContent(match[1]);
  }
  return "";
}

function extractBodyFromHtml(html = "") {
  if (!html) {
    return "";
  }
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (match && match[1]) {
    return match[1];
  }
  return html;
}

function extractCandidateSections(html = "") {
  if (!html) {
    return [];
  }
  const candidates = [];
  const tagPatterns = [
    /<main[^>]*>[\s\S]*?<\/main>/gi,
    /<article[^>]*>[\s\S]*?<\/article>/gi,
    /<(section|div)[^>]*(id|class)="[^"]*(content|article|main|body|post|entry|read)[^"]*"[^>]*>[\s\S]*?<\/\1>/gi,
  ];
  for (const pattern of tagPatterns) {
    let match;
    while ((match = pattern.exec(html))) {
      if (match && match[0]) {
        candidates.push(match[0]);
      }
    }
  }
  if (!candidates.length) {
    const body = extractBodyFromHtml(html);
    if (body) {
      candidates.push(body);
    }
  }
  return candidates;
}

function evaluateContentQuality(text = "") {
  if (!text) {
    return 0;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (!wordCount) {
    return 0;
  }
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  const uniqueCount = uniqueWords.size;
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim().length >= 40);
  const sentenceCount = sentences.length;
  const longParagraphs = trimmed.split(/\n{2,}/).filter((paragraph) => paragraph.trim().length >= 160).length;
  let score = 0;
  if (wordCount >= 180) {
    score += 3;
  } else if (wordCount >= 100) {
    score += 2;
  } else if (wordCount >= 60) {
    score += 1;
  }
  if (uniqueCount >= 90) {
    score += 3;
  } else if (uniqueCount >= 50) {
    score += 2;
  } else if (uniqueCount >= 25) {
    score += 1;
  }
  if (sentenceCount >= 4) {
    score += 2;
  } else if (sentenceCount >= 2) {
    score += 1;
  }
  if (longParagraphs >= 2) {
    score += 2;
  } else if (longParagraphs >= 1) {
    score += 1;
  }
  return score;
}

async function fetchDirectPageContent(url) {
  try {
    const response = await fetch(url, { method: "GET", mode: "cors", credentials: "omit" });
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get("content-type") || "";
    if (!/text|json|xml|html/i.test(contentType)) {
      return null;
    }
    const body = await response.text();
    const title = extractTitleFromHtml(body);
    const candidates = extractCandidateSections(body);
    let bestText = "";
    let bestScore = -1;
    for (const candidate of candidates) {
      const text = htmlToText(candidate);
      if (!text) {
        continue;
      }
      const score = evaluateContentQuality(text);
      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
    }
    if (!bestText) {
      return null;
    }
    return {
      text: bestText,
      title,
      lastModified: response.headers.get("last-modified"),
      etag: response.headers.get("etag"),
      source: "network",
      quality: bestScore,
    };
  } catch (err) {
    console.warn("Spotlight: remote fetch for summary failed", err);
    return null;
  }
}

async function fetchReadableProxyContent(url) {
  let proxyUrl = "";
  try {
    const parsed = new URL(url);
    proxyUrl = `https://r.jina.ai/${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search || ""}`;
  } catch (err) {
    return null;
  }
  try {
    const response = await fetch(proxyUrl, { method: "GET", mode: "cors", credentials: "omit" });
    if (!response.ok) {
      return null;
    }
    const body = await response.text();
    const sanitized = sanitizeContent(body);
    if (!sanitized) {
      return null;
    }
    return {
      text: sanitized,
      title: "",
      lastModified: null,
      etag: null,
      source: "readability-proxy",
      quality: evaluateContentQuality(sanitized),
    };
  } catch (err) {
    console.warn("Spotlight: readability proxy fetch failed", err);
    return null;
  }
}

async function fetchRemoteContent(url) {
  if (!url || (typeof url === "string" && !/^https?:/i.test(url))) {
    return null;
  }
  const direct = await fetchDirectPageContent(url);
  const directQuality = typeof direct?.quality === "number" ? direct.quality : -1;
  if (directQuality >= 5 && direct) {
    const { quality, ...rest } = direct;
    return rest;
  }
  const fallback = await fetchReadableProxyContent(url);
  const fallbackQuality = typeof fallback?.quality === "number" ? fallback.quality : -1;
  if (fallbackQuality > directQuality && fallback) {
    return {
      text: fallback.text,
      title: fallback.title || direct?.title || "",
      lastModified: fallback.lastModified,
      etag: fallback.etag,
      source: fallback.source,
    };
  }
  if (direct) {
    const { quality, ...rest } = direct;
    return rest;
  }
  if (fallback) {
    const { quality, ...rest } = fallback;
    return rest;
  }
  return null;
}

export function createSummarizerService() {
  const summaryCache = new Map();
  const pageCache = new Map();
  const pendingSummaries = new Map();
  let summarizerInstance = null;
  let summarizerPromise = null;

  async function ensureSummarizer() {
    if (summarizerInstance) {
      return summarizerInstance;
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
      type: "key-points",
      format: "markdown",
      length: "short",
      sharedContext: "Summaries for open browser tabs to help users triage content quickly.",
      monitor(monitor) {
        if (!monitor || typeof monitor.addEventListener !== "function") {
          return;
        }
        monitor.addEventListener("downloadprogress", (event) => {
          const percent = typeof event?.loaded === "number" ? Math.round(event.loaded * 100) : null;
          if (percent !== null) {
            console.info(`Spotlight summarizer download ${percent}%`);
          }
        });
      },
    })
      .then((instance) => {
        summarizerInstance = instance;
        summarizerPromise = null;
        return instance;
      })
      .catch((error) => {
        summarizerPromise = null;
        throw error;
      });
    return summarizerPromise;
  }

  async function resolvePageContent(url, tabId) {
    const now = Date.now();
    const cached = pageCache.get(url);
    if (cached && now - cached.timestamp < PAGE_CACHE_TTL) {
      cached.lastUsed = now;
      return cached;
    }
    let result = await queryTabText(tabId);
    if (!result) {
      result = await fetchRemoteContent(url);
    }
    if (!result || !result.text) {
      throw new Error("Page content unavailable");
    }
    const sanitized = sanitizeContent(result.text);
    if (!sanitized) {
      throw new Error("Empty page content");
    }
    const payload = {
      text: sanitized,
      fingerprint: computeFingerprint(sanitized),
      lastModified: result.lastModified || null,
      etag: result.etag || null,
      title: result.title || "",
      source: result.source || "unknown",
      timestamp: now,
      lastUsed: now,
    };
    pageCache.set(url, payload);
    pruneCache(pageCache, PAGE_CACHE_LIMIT);
    return payload;
  }

  function getCachedSummary(url, pageData) {
    const entry = summaryCache.get(url);
    if (!entry) {
      return null;
    }
    const now = Date.now();
    const isFresh = now - entry.timestamp < SUMMARY_TTL;
    const fingerprintMatches = entry.fingerprint === pageData.fingerprint;
    const etagMatches = !pageData.etag || entry.etag === pageData.etag;
    const lastModifiedMatches = !pageData.lastModified || entry.lastModified === pageData.lastModified;
    if (isFresh && fingerprintMatches && etagMatches && lastModifiedMatches) {
      entry.lastUsed = now;
      return {
        bullets: entry.bullets.slice(),
        raw: entry.raw,
        cached: true,
        source: entry.source || "cache",
      };
    }
    return null;
  }

  async function generateSummary(url, tabId, options = {}) {
    const { onProgress } = options;
    const pageData = await resolvePageContent(url, tabId);
    const cached = getCachedSummary(url, pageData);
    if (cached) {
      safeNotify(onProgress, { ...cached, done: true });
      return cached;
    }
    let summarizer;
    try {
      summarizer = await ensureSummarizer();
    } catch (error) {
      throw error;
    }
    const context = pageData.title ? `Title: ${pageData.title}` : undefined;
    let summaryText = "";
    const summarySource = pageData.source || "unknown";

    if (summarizer && typeof summarizer.summarizeStreaming === "function") {
      try {
        const stream = await summarizer.summarizeStreaming(
          pageData.text,
          context ? { context } : undefined
        );
        let aggregate = "";
        let lastEmitTime = 0;
        let lastBulletCount = 0;
        for await (const chunk of stream) {
          if (typeof chunk !== "string" || !chunk) {
            continue;
          }
          aggregate += chunk;
          const trimmed = aggregate.trim();
          if (!trimmed) {
            continue;
          }
          const bullets = parseSummaryBullets(trimmed).slice(0, 3);
          const now = Date.now();
          const shouldEmit =
            bullets.length > lastBulletCount || now - lastEmitTime > STREAMING_UPDATE_INTERVAL;
          if (!shouldEmit) {
            continue;
          }
          lastEmitTime = now;
          lastBulletCount = bullets.length;
          safeNotify(onProgress, {
            bullets: bullets.slice(),
            raw: trimmed,
            cached: false,
            source: summarySource,
            done: false,
          });
        }
        summaryText = aggregate.trim();
      } catch (streamError) {
        console.warn("Spotlight: streaming summary failed, falling back", streamError);
      }
    }

    if (!summaryText) {
      try {
        const response = await summarizer.summarize(
          pageData.text,
          context ? { context } : undefined
        );
        summaryText = typeof response === "string" ? response.trim() : "";
      } catch (error) {
        summarizerInstance = null;
        throw error;
      }
    }

    if (!summaryText) {
      throw new Error("Summary returned empty response");
    }

    const bullets = parseSummaryBullets(summaryText).slice(0, 3);
    const entry = {
      bullets,
      raw: summaryText,
      fingerprint: pageData.fingerprint,
      etag: pageData.etag,
      lastModified: pageData.lastModified,
      timestamp: Date.now(),
      lastUsed: Date.now(),
      source: summarySource,
    };
    summaryCache.set(url, entry);
    pruneCache(summaryCache, SUMMARY_CACHE_LIMIT);
    const result = {
      bullets: bullets.slice(),
      raw: summaryText,
      cached: false,
      source: entry.source,
    };
    safeNotify(onProgress, { ...result, done: true });
    return result;
  }

  async function requestSummary({ url, tabId, onProgress }) {
    if (!url || typeof url !== "string") {
      throw new Error("Invalid URL for summary");
    }
    const key = url;
    if (pendingSummaries.has(key)) {
      return pendingSummaries.get(key);
    }
    const task = generateSummary(url, tabId, { onProgress })
      .catch((error) => {
        throw new Error(toErrorMessage(error));
      })
      .finally(() => {
        pendingSummaries.delete(key);
      });
    pendingSummaries.set(key, task);
    return task;
  }

  return {
    async requestSummary(options = {}) {
      try {
        return await requestSummary(options);
      } catch (error) {
        throw new Error(toErrorMessage(error));
      }
    },
  };
}
