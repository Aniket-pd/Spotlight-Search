const STORAGE_KEY = "spotlightPreferences";
const DATA_SOURCE_LABELS = {
  tabs: {
    title: "Tabs",
    description: "Search through your currently open browser tabs.",
  },
  bookmarks: {
    title: "Bookmarks",
    description: "Include saved bookmarks from all folders.",
  },
  history: {
    title: "History",
    description: "Index recently visited pages from your browsing history.",
  },
  downloads: {
    title: "Downloads",
    description: "Surface your recent downloads with quick actions.",
  },
  topSites: {
    title: "Top Sites",
    description: "Add the sites Chrome highlights most frequently for you.",
  },
};

const DEFAULT_PREFERENCES = {
  dataSources: {
    tabs: true,
    bookmarks: true,
    history: true,
    downloads: true,
    topSites: true,
  },
  defaultWebSearchEngineId: null,
};

const statusEl = document.getElementById("status");
const dataSourceContainer = document.getElementById("data-source-toggles");
const searchEngineSelect = document.getElementById("search-engine-select");
let currentPreferences = structuredClone(DEFAULT_PREFERENCES);
let saveTimeout = null;

function getWebSearchApi() {
  const api = typeof globalThis !== "undefined" ? globalThis.SpotlightWebSearch : null;
  if (!api || typeof api !== "object") {
    return null;
  }
  return api;
}

function normalizeDataSourcePreferences(raw) {
  const defaults = structuredClone(DEFAULT_PREFERENCES.dataSources);
  if (!raw || typeof raw !== "object") {
    return defaults;
  }
  for (const key of Object.keys(defaults)) {
    defaults[key] = raw[key] !== false;
  }
  return defaults;
}

function normalizePreferences(raw) {
  const normalized = structuredClone(DEFAULT_PREFERENCES);
  if (raw && typeof raw === "object") {
    normalized.dataSources = normalizeDataSourcePreferences(raw.dataSources);
    if (typeof raw.defaultWebSearchEngineId === "string" && raw.defaultWebSearchEngineId.trim()) {
      normalized.defaultWebSearchEngineId = raw.defaultWebSearchEngineId.trim();
    }
  }
  return normalized;
}

function showStatus(message, delay = 2400) {
  if (!statusEl) return;
  statusEl.textContent = message;
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  if (message) {
    saveTimeout = setTimeout(() => {
      statusEl.textContent = "";
    }, delay);
  }
}

function renderDataSourceToggles() {
  if (!dataSourceContainer) {
    return;
  }
  dataSourceContainer.innerHTML = "";

  Object.entries(DATA_SOURCE_LABELS).forEach(([key, meta]) => {
    const wrapper = document.createElement("label");
    wrapper.className = "toggle";
    wrapper.htmlFor = `toggle-${key}`;

    const label = document.createElement("div");
    label.className = "toggle-label";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = meta.title;
    const descriptionSpan = document.createElement("span");
    descriptionSpan.textContent = meta.description;
    label.appendChild(titleSpan);
    label.appendChild(descriptionSpan);

    const switchWrapper = document.createElement("div");
    switchWrapper.className = "switch";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `toggle-${key}`;
    input.checked = Boolean(currentPreferences.dataSources[key]);
    input.addEventListener("change", () => {
      currentPreferences.dataSources[key] = input.checked;
      persistPreferences();
    });

    const slider = document.createElement("span");
    slider.className = "slider";

    switchWrapper.appendChild(input);
    switchWrapper.appendChild(slider);

    wrapper.appendChild(label);
    wrapper.appendChild(switchWrapper);

    dataSourceContainer.appendChild(wrapper);
  });
}

function renderSearchEngineOptions() {
  if (!searchEngineSelect) {
    return;
  }
  const api = getWebSearchApi();
  const engines = api && typeof api.getSearchEngines === "function" ? api.getSearchEngines() : [];
  const defaultEngine =
    api && typeof api.getDefaultSearchEngine === "function" ? api.getDefaultSearchEngine() : null;

  searchEngineSelect.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = defaultEngine
    ? `Use Spotlight default (${defaultEngine.name || defaultEngine.domain || defaultEngine.id})`
    : "Use Spotlight default";
  searchEngineSelect.appendChild(defaultOption);

  engines
    .filter((engine) => engine && engine.id)
    .forEach((engine) => {
      const option = document.createElement("option");
      option.value = engine.id;
      option.textContent = engine.name || engine.domain || engine.id;
      if (engine.id === currentPreferences.defaultWebSearchEngineId) {
        option.selected = true;
      }
      searchEngineSelect.appendChild(option);
    });

  if (!currentPreferences.defaultWebSearchEngineId) {
    searchEngineSelect.value = "";
  }
}

async function readStoredPreferences() {
  if (!chrome?.storage?.sync?.get) {
    return structuredClone(DEFAULT_PREFERENCES);
  }
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          console.warn("Spotlight: failed to read preferences", chrome.runtime.lastError);
          resolve(structuredClone(DEFAULT_PREFERENCES));
          return;
        }
        resolve(normalizePreferences(result?.[STORAGE_KEY]));
      });
    } catch (err) {
      console.warn("Spotlight: unable to read preferences", err);
      resolve(structuredClone(DEFAULT_PREFERENCES));
    }
  });
}

async function persistPreferences() {
  if (!chrome?.storage?.sync?.set) {
    showStatus("Unable to save preferences");
    return;
  }
  const payload = normalizePreferences(currentPreferences);
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.set({ [STORAGE_KEY]: payload }, () => {
        if (chrome.runtime.lastError) {
          console.warn("Spotlight: failed to save preferences", chrome.runtime.lastError);
          showStatus("Unable to save changes");
          resolve();
          return;
        }
        showStatus("Preferences saved");
        resolve();
      });
    } catch (err) {
      console.warn("Spotlight: unable to save preferences", err);
      showStatus("Unable to save changes");
      resolve();
    }
  });
}

function applyPreferences(preferences) {
  currentPreferences = normalizePreferences(preferences);
  renderDataSourceToggles();
  renderSearchEngineOptions();
  searchEngineSelect.value = currentPreferences.defaultWebSearchEngineId || "";
}

function setupEventListeners() {
  if (searchEngineSelect) {
    searchEngineSelect.addEventListener("change", () => {
      const value = searchEngineSelect.value;
      currentPreferences.defaultWebSearchEngineId = value || null;
      persistPreferences();
    });
  }

  if (chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes || !changes[STORAGE_KEY]) {
        return;
      }
      const next = normalizePreferences(changes[STORAGE_KEY].newValue);
      currentPreferences = next;
      renderDataSourceToggles();
      renderSearchEngineOptions();
      searchEngineSelect.value = currentPreferences.defaultWebSearchEngineId || "";
      showStatus("Preferences updated");
    });
  }
}

async function initialize() {
  setupEventListeners();
  const stored = await readStoredPreferences();
  applyPreferences(stored);
}

initialize().catch((err) => {
  console.error("Spotlight: failed to initialize options", err);
  showStatus("Unable to load preferences");
});
