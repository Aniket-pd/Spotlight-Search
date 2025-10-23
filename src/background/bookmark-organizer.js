const PROMPT_TEMPLATE = `You are the "Smart Bookmark Organizer" for a browser extension. Your job is to turn messy bookmark metadata into a tidy catalog that people can scan, search, and maintain quickly.

Follow these rules carefully:
1. Work strictly with the bookmark data supplied in the input payload. Do not invent URLs or content.
2. For every bookmark, emit a JSON object containing:
   - \`id\`: the id from the input.
   - \`cleanTitle\`: polished title text. Fix obvious casing/punctuation.
   - \`primaryCategory\`: 1–3 word label that captures the main theme.
   - \`secondaryTags\`: 1–4 optional lowerCamelCase tags for finer grouping.
   - \`keywords\`: 3–6 short search tokens that help retrieve the bookmark.
   - \`summary\`: one sentence (≤18 words) highlighting why the bookmark matters.
   - \`action\`: one of \`keep\`, \`archive\`, or \`reviewDuplicate\`.
   - \`duplicateOf\`: the id of the suspected duplicate when \`action\` is \`reviewDuplicate\`; otherwise \`null\`.
   - \`notes\`: practical tip or follow-up (≤120 characters). Use an empty string when nothing is needed.
3. Choose categories that resemble real bookmark folders (e.g., "Research", "Learning", "Entertainment", "Tools", "Shopping", "Personal"). Use "Unsorted" if the theme is unclear and explain why in \`notes\`.
4. If two bookmarks look like duplicates (same topic + nearly identical titles or URLs), set \`action\` to \`reviewDuplicate\`, point \`duplicateOf\` to the matching id, and mention the reason in \`notes\`.
5. Keep \`secondaryTags\` and \`keywords\` relevant—avoid generic terms such as "misc" or "link".
6. Do not include prose outside the JSON response.

Output schema:
{
  "collectionSummary": {
    "dominantCategories": string[],
    "bookmarksNeedingAttention": string[],
    "suggestedFolders": {
      category: {
        "count": number,
        "sampleIds": string[]
      }
    }
  },
  "bookmarks": BookmarkResult[]
}

BookmarkResult = {
  "id": string,
  "cleanTitle": string,
  "primaryCategory": string,
  "secondaryTags": string[],
  "keywords": string[],
  "summary": string,
  "action": "keep" | "archive" | "reviewDuplicate",
  "duplicateOf": string | null,
  "notes": string
}`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    collectionSummary: {
      type: "object",
      additionalProperties: false,
      properties: {
        dominantCategories: {
          type: "array",
          items: { type: "string" },
        },
        bookmarksNeedingAttention: {
          type: "array",
          items: { type: "string" },
        },
        suggestedFolders: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            properties: {
              count: { type: "number" },
              sampleIds: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["count", "sampleIds"],
          },
        },
      },
      required: ["dominantCategories", "bookmarksNeedingAttention", "suggestedFolders"],
    },
    bookmarks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          cleanTitle: { type: "string" },
          primaryCategory: { type: "string" },
          secondaryTags: {
            type: "array",
            items: { type: "string" },
          },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
          summary: { type: "string" },
          action: {
            type: "string",
            enum: ["keep", "archive", "reviewDuplicate"],
          },
          duplicateOf: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          notes: { type: "string" },
        },
        required: [
          "id",
          "cleanTitle",
          "primaryCategory",
          "secondaryTags",
          "keywords",
          "summary",
          "action",
          "duplicateOf",
          "notes",
        ],
      },
    },
  },
  required: ["collectionSummary", "bookmarks"],
};

const DEFAULT_LANGUAGE = "English";
const DEFAULT_BOOKMARK_LIMIT = 60;
const MAX_BOOKMARK_LIMIT = 200;

function escapeHtml(text = "") {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "";
  }
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString();
  } catch (err) {
    return "";
  }
}

function formatBookmarkNotes(entry) {
  const parts = [];
  if (entry.path) {
    parts.push(`Folder: ${entry.path}`);
  }
  const added = formatDate(entry.dateAdded);
  if (added) {
    parts.push(`Added: ${added}`);
  }
  return parts.join(" · ");
}

function flattenBookmarkTree(nodes, path = [], results = []) {
  if (!Array.isArray(nodes)) {
    return results;
  }
  for (const node of nodes) {
    if (!node) {
      continue;
    }
    const nextPath = node.title ? [...path, node.title] : path.slice();
    if (node.url) {
      const entry = {
        id: String(node.id),
        title: node.title || node.url || "Untitled bookmark",
        url: node.url,
        dateAdded: typeof node.dateAdded === "number" ? node.dateAdded : null,
        path: path.filter(Boolean).join(" / "),
      };
      entry.userNotes = formatBookmarkNotes(entry);
      results.push(entry);
    }
    if (Array.isArray(node.children) && node.children.length) {
      flattenBookmarkTree(node.children, nextPath, results);
    }
  }
  return results;
}

function getBookmarkTree() {
  return new Promise((resolve, reject) => {
    try {
      chrome.bookmarks.getTree((nodes) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(Array.isArray(nodes) ? nodes : []);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function clampLimit(limit) {
  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_BOOKMARK_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_BOOKMARK_LIMIT);
}

function buildPromptPayload(bookmarks, language) {
  const payload = {
    language: language || DEFAULT_LANGUAGE,
    bookmarks: bookmarks.map((entry) => {
      const item = {
        id: String(entry.id),
        title: entry.title || entry.url || "Untitled bookmark",
        url: entry.url || "",
      };
      if (entry.userNotes) {
        item.userNotes = entry.userNotes;
      }
      return item;
    }),
  };
  return payload;
}

function buildPromptText(payload) {
  const payloadJson = JSON.stringify(payload, null, 2);
  return `${PROMPT_TEMPLATE}\n\nInput payload:\n${payloadJson}`;
}

function buildBookmarkSummaryHtml(report) {
  const { result, sourceBookmarks = [], payload, generatedAt } = report;
  const summary = result?.collectionSummary || {};
  const bookmarks = Array.isArray(result?.bookmarks) ? result.bookmarks : [];
  const sourceMap = new Map(sourceBookmarks.map((entry) => [String(entry.id), entry]));
  const resultMap = new Map(bookmarks.map((entry) => [String(entry.id), entry]));

  const dominantCategories = Array.isArray(summary.dominantCategories)
    ? summary.dominantCategories
    : [];
  const bookmarksNeedingAttention = Array.isArray(summary.bookmarksNeedingAttention)
    ? summary.bookmarksNeedingAttention
    : [];
  const suggestedFolders = summary?.suggestedFolders && typeof summary.suggestedFolders === "object"
    ? summary.suggestedFolders
    : {};

  const attentionItems = bookmarksNeedingAttention
    .map((id) => {
      const entry = resultMap.get(String(id));
      if (!entry) {
        return `<li><code>${escapeHtml(String(id))}</code></li>`;
      }
      return `<li><strong>${escapeHtml(entry.cleanTitle || entry.id)}</strong> <span class="badge">${escapeHtml(
        entry.action || "review"
      )}</span></li>`;
    })
    .join("");

  const folderEntries = Object.entries(suggestedFolders)
    .map(([folder, info]) => {
      const count = typeof info?.count === "number" ? info.count : 0;
      const sample = Array.isArray(info?.sampleIds) ? info.sampleIds.slice(0, 3) : [];
      const sampleLabels = sample
        .map((id) => {
          const entry = resultMap.get(String(id));
          if (entry) {
            return escapeHtml(entry.cleanTitle || entry.id);
          }
          return escapeHtml(String(id));
        })
        .join(", ");
      return `<li><strong>${escapeHtml(folder)}</strong> <span class="count">(${count})</span>${
        sampleLabels ? ` — ${sampleLabels}` : ""
      }</li>`;
    })
    .join("");

  const bookmarkSections = bookmarks
    .map((entry) => {
      const source = sourceMap.get(String(entry.id));
      const url = source?.url || "";
      const tags = Array.isArray(entry.secondaryTags) ? entry.secondaryTags : [];
      const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
      const notes = typeof entry.notes === "string" ? entry.notes : "";
      const duplicate = typeof entry.duplicateOf === "string" ? entry.duplicateOf : "";
      const path = source?.path ? `<div class="path">Folder: ${escapeHtml(source.path)}</div>` : "";
      const originalTitle = source?.title && source.title !== entry.cleanTitle
        ? `<div class="original">Original: ${escapeHtml(source.title)}</div>`
        : "";
      const urlLine = url ? `<div class="url"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></div>` : "";
      const tagsLine = tags.length
        ? `<div class="chips">${tags
            .map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`)
            .join(" ")}</div>`
        : "";
      const keywordsLine = keywords.length
        ? `<div class="keywords">Keywords: ${keywords.map((kw) => `<code>${escapeHtml(kw)}</code>`).join(" ")}</div>`
        : "";
      const duplicateLine = duplicate
        ? `<div class="duplicate">Duplicate of: <code>${escapeHtml(duplicate)}</code></div>`
        : "";
      const notesLine = notes
        ? `<div class="notes">Notes: ${escapeHtml(notes)}</div>`
        : "";
      const summaryLine = entry.summary
        ? `<p class="summary">${escapeHtml(entry.summary)}</p>`
        : "";
      return `<section class="bookmark-entry action-${escapeHtml(entry.action || "keep")}">
  <header>
    <h2>${escapeHtml(entry.cleanTitle || entry.id)}</h2>
    <span class="category">${escapeHtml(entry.primaryCategory || "Unsorted")}</span>
    <span class="action">${escapeHtml((entry.action || "keep").toUpperCase())}</span>
  </header>
  ${summaryLine}
  ${urlLine}
  ${path}
  ${originalTitle}
  ${tagsLine}
  ${keywordsLine}
  ${duplicateLine}
  ${notesLine}
</section>`;
    })
    .join("\n");

  const dominantList = dominantCategories.length
    ? dominantCategories.map((category) => `<li>${escapeHtml(category)}</li>`).join("")
    : "<li>No dominant categories detected.</li>";

  const generatedLabel = formatDate(generatedAt);
  const language = payload?.language || DEFAULT_LANGUAGE;
  const bookmarkCount = Array.isArray(payload?.bookmarks) ? payload.bookmarks.length : bookmarks.length;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Smart Bookmark Organizer Report</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #111827;
        color: #e5e7eb;
      }
      body {
        max-width: 960px;
        margin: 0 auto;
        padding: 32px 24px 80px;
        line-height: 1.6;
      }
      h1 {
        font-size: 2rem;
        margin-bottom: 0.25rem;
      }
      h2 {
        font-size: 1.25rem;
        margin: 0;
      }
      a {
        color: #60a5fa;
      }
      .summary-card {
        background: rgba(59, 130, 246, 0.12);
        border: 1px solid rgba(96, 165, 250, 0.4);
        border-radius: 16px;
        padding: 24px;
        margin-bottom: 32px;
      }
      .summary-grid {
        display: grid;
        gap: 24px;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }
      .summary-grid section {
        background: rgba(17, 24, 39, 0.85);
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 12px;
        padding: 16px;
      }
      ul {
        margin: 0.5rem 0 0 1.25rem;
        padding: 0;
      }
      .bookmark-entry {
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        padding: 20px;
        margin-bottom: 20px;
        background: rgba(30, 41, 59, 0.6);
      }
      .bookmark-entry header {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: baseline;
        margin-bottom: 12px;
      }
      .bookmark-entry .category {
        background: rgba(16, 185, 129, 0.2);
        color: #6ee7b7;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: 0.8rem;
      }
      .bookmark-entry .action {
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        padding: 2px 8px;
        border-radius: 6px;
        border: 1px solid rgba(148, 163, 184, 0.25);
        color: rgba(148, 163, 184, 0.9);
      }
      .bookmark-entry.action-reviewDuplicate .action {
        background: rgba(251, 191, 36, 0.2);
        color: #facc15;
        border-color: rgba(251, 191, 36, 0.35);
      }
      .bookmark-entry.action-archive .action {
        background: rgba(239, 68, 68, 0.15);
        color: #fca5a5;
        border-color: rgba(239, 68, 68, 0.3);
      }
      .bookmark-entry .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      .chip {
        background: rgba(129, 140, 248, 0.2);
        color: #a5b4fc;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: 0.75rem;
      }
      .keywords code {
        background: rgba(255, 255, 255, 0.08);
        padding: 2px 6px;
        border-radius: 6px;
        margin-right: 4px;
        font-size: 0.75rem;
      }
      .summary {
        margin: 0 0 8px;
        color: rgba(226, 232, 240, 0.9);
      }
      .notes {
        margin-top: 8px;
        color: rgba(226, 232, 240, 0.72);
      }
      .duplicate {
        margin-top: 8px;
        color: rgba(249, 115, 22, 0.8);
      }
      .generated-info {
        font-size: 0.85rem;
        color: rgba(148, 163, 184, 0.75);
      }
      .badge {
        background: rgba(249, 115, 22, 0.2);
        color: #fb923c;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 0.75rem;
      }
      details {
        margin-top: 32px;
        background: rgba(15, 23, 42, 0.6);
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        padding: 16px;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.8rem;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Smart Bookmark Organizer</h1>
      <p class="generated-info">Language: ${escapeHtml(language)} · Bookmarks analyzed: ${bookmarkCount} · Generated: ${escapeHtml(
        generatedLabel || "just now"
      )}</p>
    </header>
    <section class="summary-card">
      <h2>Collection summary</h2>
      <div class="summary-grid">
        <section>
          <h3>Dominant categories</h3>
          <ul>${dominantList}</ul>
        </section>
        <section>
          <h3>Needs attention</h3>
          <ul>${attentionItems || "<li>No urgent follow-ups.</li>"}</ul>
        </section>
        <section>
          <h3>Suggested folders</h3>
          <ul>${folderEntries || "<li>No folder suggestions.</li>"}</ul>
        </section>
      </div>
    </section>
    ${bookmarkSections || "<p>No bookmark recommendations returned.</p>"}
    <details>
      <summary>Raw response JSON</summary>
      <pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>
    </details>
  </body>
</html>`;
}

async function collectRecentBookmarks(limit) {
  const tree = await getBookmarkTree();
  const flattened = flattenBookmarkTree(tree);
  if (!flattened.length) {
    return [];
  }
  const sorted = flattened.sort((a, b) => {
    const aTime = typeof a.dateAdded === "number" ? a.dateAdded : 0;
    const bTime = typeof b.dateAdded === "number" ? b.dateAdded : 0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return (a.title || "").localeCompare(b.title || "");
  });
  return sorted.slice(0, clampLimit(limit));
}

export function createBookmarkOrganizerService() {
  let sessionInstance = null;
  let sessionPromise = null;
  let activeRequest = null;

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
    sessionPromise = globalThis.LanguageModel.create({
      monitor(monitor) {
        if (!monitor || typeof monitor.addEventListener !== "function") {
          return;
        }
        monitor.addEventListener("downloadprogress", (event) => {
          const percent = typeof event?.loaded === "number" ? Math.round(event.loaded * 100) : null;
          if (percent !== null) {
            console.info(`Spotlight bookmark organizer model download ${percent}%`);
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

  async function runPrompt(payload) {
    const session = await ensureSession();
    const promptText = buildPromptText(payload);
    const raw = await session.prompt(promptText, {
      responseConstraint: RESPONSE_SCHEMA,
    });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error("Bookmark organizer returned invalid JSON");
    }
    return { raw, parsed };
  }

  async function organizeBookmarks(options = {}) {
    if (activeRequest) {
      return activeRequest;
    }
    const task = (async () => {
      const limit = clampLimit(options.limit);
      const language = typeof options.language === "string" && options.language ? options.language : DEFAULT_LANGUAGE;
      const bookmarks = await collectRecentBookmarks(limit);
      if (!bookmarks.length) {
        throw new Error("No bookmarks available to organize");
      }
      const payload = buildPromptPayload(bookmarks, language);
      const { raw, parsed } = await runPrompt(payload);
      return {
        generatedAt: Date.now(),
        payload,
        sourceBookmarks: bookmarks,
        result: parsed,
        rawText: raw,
      };
    })();
    activeRequest = task
      .then((value) => {
        activeRequest = null;
        return value;
      })
      .catch((error) => {
        activeRequest = null;
        throw error;
      });
    return activeRequest;
  }

  async function openResultsTab(report) {
    if (!report || !report.result) {
      throw new Error("Invalid organizer report");
    }
    const html = buildBookmarkSummaryHtml(report);
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await chrome.tabs.create({ url });
    return url;
  }

  async function organizeAndOpen(options = {}) {
    const report = await organizeBookmarks(options);
    await openResultsTab(report);
    return report;
  }

  return {
    organizeBookmarks,
    openResultsTab,
    organizeAndOpen,
  };
}
