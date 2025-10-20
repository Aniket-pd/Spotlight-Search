const TAB_PERFORMANCE_ALIASES = [
  "tab performance",
  "tabs performance",
  "performance tabs",
  "view tab performance",
  "tab resource usage",
  "performance",
  "tab stats",
  "tab usage",
];

export const TAB_PERFORMANCE_REFRESH_INTERVAL = 2000;

function normalizeQuery(value = "") {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesTabPerformanceQuery(query = "") {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return false;
  }
  if (TAB_PERFORMANCE_ALIASES.includes(normalized)) {
    return true;
  }
  if (normalized.includes("performance") && normalized.includes("tab")) {
    return true;
  }
  if (normalized === "performance") {
    return true;
  }
  return false;
}

function mapProcessesByTab(processes) {
  const map = new Map();
  if (!processes || typeof processes !== "object") {
    return map;
  }
  const processEntries = Object.entries(processes);
  for (const [processId, info] of processEntries) {
    if (!info || typeof info !== "object") {
      continue;
    }
    const tasks = Array.isArray(info.tasks) ? info.tasks : [];
    for (const task of tasks) {
      if (!task || typeof task !== "object") {
        continue;
      }
      const tabId = typeof task.tabId === "number" ? task.tabId : null;
      if (tabId === null) {
        continue;
      }
      let entry = map.get(tabId);
      if (!entry) {
        entry = [];
        map.set(tabId, entry);
      }
      entry.push({ processId, info });
    }
  }
  return map;
}

function sumMetrics(entries = []) {
  const totals = {
    cpu: 0,
    hasCpu: false,
    privateMemory: 0,
    hasPrivateMemory: false,
    jsMemoryUsed: 0,
    hasJsMemoryUsed: false,
    jsMemoryAllocated: 0,
    hasJsMemoryAllocated: false,
    network: 0,
    hasNetwork: false,
    processCount: 0,
  };

  for (const entry of entries) {
    const info = entry?.info;
    if (!info) {
      continue;
    }
    if (typeof info.cpu === "number" && Number.isFinite(info.cpu)) {
      totals.cpu += info.cpu;
      totals.hasCpu = true;
    }
    if (typeof info.privateMemory === "number" && Number.isFinite(info.privateMemory)) {
      totals.privateMemory += info.privateMemory;
      totals.hasPrivateMemory = true;
    }
    if (typeof info.jsMemoryUsed === "number" && Number.isFinite(info.jsMemoryUsed)) {
      totals.jsMemoryUsed += info.jsMemoryUsed;
      totals.hasJsMemoryUsed = true;
    }
    if (typeof info.jsMemoryAllocated === "number" && Number.isFinite(info.jsMemoryAllocated)) {
      totals.jsMemoryAllocated += info.jsMemoryAllocated;
      totals.hasJsMemoryAllocated = true;
    }
    if (typeof info.network === "number" && Number.isFinite(info.network)) {
      totals.network += info.network;
      totals.hasNetwork = true;
    }
    totals.processCount += 1;
  }

  return {
    cpu: totals.hasCpu ? totals.cpu : null,
    memoryBytes: totals.hasPrivateMemory ? totals.privateMemory * 1024 : null,
    jsMemoryUsedBytes: totals.hasJsMemoryUsed ? totals.jsMemoryUsed : null,
    jsMemoryAllocatedBytes: totals.hasJsMemoryAllocated ? totals.jsMemoryAllocated : null,
    networkBytesPerSec: totals.hasNetwork ? totals.network * 1024 : null,
    processCount: totals.processCount,
  };
}

function extractOrigin(url) {
  if (!url || typeof url !== "string") {
    return "";
  }
  try {
    const parsed = new URL(url);
    return parsed.origin || "";
  } catch (err) {
    return "";
  }
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

function formatDisplayDomain(tab) {
  const hostname = extractHostname(tab?.url || "");
  if (hostname) {
    return hostname.replace(/^www\./i, "");
  }
  if (tab?.url?.startsWith("chrome://")) {
    return tab.url.replace(/^chrome:\/\//i, "Chrome · ");
  }
  return tab?.url || "";
}

async function queryProcesses() {
  if (!chrome?.processes || typeof chrome.processes.getProcessInfo !== "function") {
    return {};
  }
  return new Promise((resolve) => {
    try {
      chrome.processes.getProcessInfo([], true, (processes) => {
        if (chrome.runtime.lastError) {
          console.warn("Spotlight: process info unavailable", chrome.runtime.lastError);
          resolve({});
          return;
        }
        resolve(processes || {});
      });
    } catch (err) {
      console.warn("Spotlight: failed to query process info", err);
      resolve({});
    }
  });
}

function buildPerformanceResult(tab, metrics) {
  const title = tab?.title || tab?.url || "Untitled tab";
  const description = formatDisplayDomain(tab);
  const favIconUrl = typeof tab?.favIconUrl === "string" ? tab.favIconUrl : null;
  const origin = extractOrigin(tab?.url || "");
  return {
    id: `tab-performance:${tab.id}`,
    type: "tabPerformance",
    title,
    url: tab?.url || "",
    description,
    tabId: tab?.id ?? null,
    windowId: tab?.windowId ?? null,
    active: Boolean(tab?.active),
    audible: Boolean(tab?.audible),
    muted: Boolean(tab?.mutedInfo?.muted),
    discarded: Boolean(tab?.discarded),
    autoDiscardable: tab?.autoDiscardable !== false,
    pinned: Boolean(tab?.pinned),
    attention: Boolean(tab?.attention),
    lastAccessed: typeof tab?.lastAccessed === "number" ? tab.lastAccessed : null,
    faviconUrl,
    origin,
    metrics,
  };
}

function sortPerformanceResults(results = []) {
  return results
    .slice()
    .sort((a, b) => {
      const aCpu = typeof a?.metrics?.cpu === "number" ? a.metrics.cpu : -1;
      const bCpu = typeof b?.metrics?.cpu === "number" ? b.metrics.cpu : -1;
      if (bCpu !== aCpu) {
        return bCpu - aCpu;
      }
      const aMemory = typeof a?.metrics?.memoryBytes === "number" ? a.metrics.memoryBytes : -1;
      const bMemory = typeof b?.metrics?.memoryBytes === "number" ? b.metrics.memoryBytes : -1;
      if (bMemory !== aMemory) {
        return bMemory - aMemory;
      }
      const aTitle = a?.title || "";
      const bTitle = b?.title || "";
      if (aTitle && bTitle) {
        const diff = aTitle.localeCompare(bTitle);
        if (diff !== 0) {
          return diff;
        }
      }
      const aUrl = a?.url || "";
      const bUrl = b?.url || "";
      return aUrl.localeCompare(bUrl);
    });
}

export async function getTabPerformanceSnapshot() {
  const [tabs, processes] = await Promise.all([chrome.tabs.query({}), queryProcesses()]);
  const tabsById = Array.isArray(tabs) ? tabs.filter((tab) => typeof tab?.id === "number") : [];
  const processMap = mapProcessesByTab(processes);

  const results = [];
  for (const tab of tabsById) {
    const relatedProcesses = processMap.get(tab.id) || [];
    const metrics = sumMetrics(relatedProcesses);
    results.push(buildPerformanceResult(tab, metrics));
  }

  const sorted = sortPerformanceResults(results);
  const activeCount = sorted.filter((item) => item.active).length;
  const answerParts = [];
  if (sorted.length > 0) {
    answerParts.push(`${sorted.length} tabs`);
  }
  if (activeCount > 0 && activeCount < sorted.length) {
    answerParts.push(`${activeCount} active`);
  }
  const topCpu = sorted.find((item) => typeof item?.metrics?.cpu === "number");
  if (topCpu) {
    const cpuValue = Math.max(topCpu.metrics.cpu, 0).toFixed(1);
    const label = topCpu.title || topCpu.description || "Top tab";
    answerParts.push(`${cpuValue}% CPU · ${label}`);
  }

  const answer = answerParts.length ? answerParts.join(" · ") : "No tabs open";

  return {
    results: sorted,
    answer,
  };
}

export { TAB_PERFORMANCE_ALIASES };

