const RAW_SEARCH_ENGINES = [
  {
    id: "google",
    name: "Google",
    urlTemplate: "https://www.google.com/search?q=%s",
    aliases: ["g", "google.com"],
  },
  {
    id: "bing",
    name: "Bing",
    urlTemplate: "https://www.bing.com/search?q=%s",
    aliases: ["b", "bing.com"],
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    urlTemplate: "https://duckduckgo.com/?q=%s",
    aliases: ["ddg", "duck", "duck.com", "duckduckgo.com"],
  },
  {
    id: "brave",
    name: "Brave Search",
    urlTemplate: "https://search.brave.com/search?q=%s",
    aliases: ["brave.com", "brave"],
  },
  {
    id: "yahoo",
    name: "Yahoo",
    urlTemplate: "https://search.yahoo.com/search?p=%s",
    aliases: ["y", "yahoo.com"],
  },
];

const DEFAULT_SEARCH_ENGINE_ID = "google";

function computeDomain(urlTemplate) {
  if (typeof urlTemplate !== "string" || !urlTemplate) {
    return "";
  }
  try {
    const sampleUrl = urlTemplate.replace("%s", "test");
    const parsed = new URL(sampleUrl);
    return parsed.hostname || "";
  } catch (err) {
    return "";
  }
}

function normalizeEngine(engine) {
  const domain = computeDomain(engine.urlTemplate);
  const keywords = new Set();
  if (engine.id) {
    keywords.add(engine.id);
  }
  if (engine.name) {
    keywords.add(engine.name);
  }
  if (domain) {
    keywords.add(domain);
  }
  for (const alias of engine.aliases || []) {
    if (typeof alias === "string" && alias) {
      keywords.add(alias);
    }
  }
  return Object.freeze({
    id: engine.id,
    name: engine.name,
    urlTemplate: engine.urlTemplate,
    domain,
    keywords: Array.from(keywords),
  });
}

const SEARCH_ENGINES = RAW_SEARCH_ENGINES.map(normalizeEngine);

function getSearchEngines() {
  return SEARCH_ENGINES.map((engine) => ({ ...engine }));
}

function findSearchEngine(idOrAlias) {
  if (typeof idOrAlias === "string" && idOrAlias) {
    const normalized = idOrAlias.trim().toLowerCase();
    if (normalized) {
      const direct = SEARCH_ENGINES.find((engine) => engine.id === normalized);
      if (direct) {
        return direct;
      }
      const aliasMatch = SEARCH_ENGINES.find((engine) =>
        engine.keywords.some((keyword) => keyword.toLowerCase() === normalized)
      );
      if (aliasMatch) {
        return aliasMatch;
      }
    }
  }
  return SEARCH_ENGINES.find((engine) => engine.id === DEFAULT_SEARCH_ENGINE_ID) || null;
}

function getDefaultSearchEngine() {
  return findSearchEngine(DEFAULT_SEARCH_ENGINE_ID);
}

function buildSearchUrl(engineId, query) {
  const engine = findSearchEngine(engineId) || getDefaultSearchEngine();
  const trimmed = typeof query === "string" ? query.trim() : "";
  if (!trimmed) {
    return "";
  }
  const encoded = encodeURIComponent(trimmed);
  const template = engine?.urlTemplate || "";
  if (!template) {
    return "";
  }
  return template.replace("%s", encoded);
}

function scoreKeyword(keyword, normalized) {
  if (!keyword) {
    return 0;
  }
  const value = keyword.toLowerCase();
  if (value === normalized) {
    return 5;
  }
  if (value.startsWith(normalized)) {
    return 4;
  }
  if (value.includes(normalized)) {
    return 2;
  }
  return 0;
}

function filterSearchEngines(input) {
  const normalized = typeof input === "string" ? input.trim().toLowerCase() : "";
  const scored = SEARCH_ENGINES.map((engine) => {
    if (!normalized) {
      return { engine, score: 1 };
    }
    let score = 0;
    for (const keyword of engine.keywords) {
      score = Math.max(score, scoreKeyword(keyword, normalized));
      if (score >= 5) {
        break;
      }
    }
    return { engine, score };
  }).filter((entry) => (normalized ? entry.score > 0 : true));

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.engine.name.localeCompare(b.engine.name);
  });

  return scored.map((entry) => ({ ...entry.engine }));
}

function createWebSearchResult(query, options = {}) {
  const trimmed = typeof query === "string" ? query.trim() : "";
  if (!trimmed) {
    return null;
  }
  const engineId =
    typeof options.engineId === "string" && options.engineId
      ? options.engineId
      : DEFAULT_SEARCH_ENGINE_ID;
  const engine = findSearchEngine(engineId);
  if (!engine) {
    return null;
  }
  const url = buildSearchUrl(engine.id, trimmed);
  if (!url) {
    return null;
  }
  const identifier = encodeURIComponent(trimmed).replace(/%/g, "-").slice(0, 96);
  const resultId = `web-search:${engine.id}:${identifier}`;
  const hostLabel = engine.domain || engine.name;
  return {
    id: resultId,
    title: `Search ${engine.name} for \u201c${trimmed}\u201d`,
    url,
    description: hostLabel,
    type: "webSearch",
    engineId: engine.id,
    engineName: engine.name,
    engineDomain: engine.domain,
    query: trimmed,
    score: 0,
    label: "Web",
  };
}

const api = Object.freeze({
  DEFAULT_SEARCH_ENGINE_ID,
  getSearchEngines,
  getDefaultSearchEngine,
  findSearchEngine,
  filterSearchEngines,
  buildSearchUrl,
  createWebSearchResult,
});

if (typeof globalThis !== "undefined") {
  if (!globalThis.SpotlightWebSearch || typeof globalThis.SpotlightWebSearch !== "object") {
    Object.defineProperty(globalThis, "SpotlightWebSearch", {
      value: api,
      configurable: true,
      writable: false,
      enumerable: false,
    });
  }
}

