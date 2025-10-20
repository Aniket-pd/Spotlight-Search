function processesAvailable() {
  return (
    typeof chrome !== "undefined" &&
    chrome?.processes &&
    typeof chrome.processes.getProcessIdForTab === "function" &&
    typeof chrome.processes.getProcessInfo === "function"
  );
}

function getProcessIdForTab(tabId) {
  if (!Number.isInteger(tabId) || !processesAvailable()) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      chrome.processes.getProcessIdForTab(tabId, (processId) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(processId ?? null);
      });
    } catch (err) {
      console.warn("Spotlight: failed to get process id for tab", err);
      resolve(null);
    }
  });
}

function getProcessesInfo(processIds, includeMemory) {
  if (!processIds.length || !processesAvailable()) {
    return Promise.resolve({});
  }
  return new Promise((resolve) => {
    try {
      chrome.processes.getProcessInfo(processIds, includeMemory, (processInfo) => {
        if (chrome.runtime.lastError) {
          resolve({});
          return;
        }
        resolve(processInfo || {});
      });
    } catch (err) {
      console.warn("Spotlight: failed to get process info", err);
      resolve({});
    }
  });
}

function normalizeTabEntry(tab) {
  if (!tab) {
    return null;
  }
  return {
    tabId: typeof tab.id === "number" ? tab.id : null,
    windowId: typeof tab.windowId === "number" ? tab.windowId : null,
    title: tab.title || tab.url || "Untitled tab",
    url: tab.url || "",
    active: Boolean(tab.active),
    audible: Boolean(tab.audible),
    discarded: Boolean(tab.discarded),
    autoDiscardable: Boolean(tab.autoDiscardable),
    attention: Boolean(tab.attention),
    lastAccessed: typeof tab.lastAccessed === "number" ? tab.lastAccessed : null,
    favIconUrl: typeof tab.favIconUrl === "string" ? tab.favIconUrl : null,
    status: tab.status || "",
  };
}

export function createPerformanceTracker() {
  async function captureSnapshot() {
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({});
    } catch (err) {
      console.warn("Spotlight: failed to query tabs for performance", err);
      return {
        metricsAvailable: false,
        timestamp: Date.now(),
        tabs: [],
        error: "Unable to query tabs",
      };
    }

    const filteredTabs = tabs.filter((tab) => tab && tab.url && !tab.url.startsWith("chrome://"));

    const tabEntries = await Promise.all(
      filteredTabs.map(async (tab) => {
        const base = normalizeTabEntry(tab);
        const processId = await getProcessIdForTab(base.tabId);
        return { ...base, processId };
      })
    );

    const processIds = Array.from(
      new Set(tabEntries.map((entry) => entry.processId).filter((id) => Number.isInteger(id)))
    );

    const includeMemory = true;
    const processInfo = await getProcessesInfo(processIds, includeMemory);

    const metricsAvailable = processesAvailable();

    const results = tabEntries.map((entry) => {
      const info = entry.processId != null ? processInfo?.[entry.processId] : null;
      const cpu = typeof info?.cpu === "number" && Number.isFinite(info.cpu) ? info.cpu : null;
      const memory =
        typeof info?.privateMemory === "number" && Number.isFinite(info.privateMemory)
          ? info.privateMemory
          : null;
      const jsMemory =
        typeof info?.jsMemoryAllocated === "number" && Number.isFinite(info.jsMemoryAllocated)
          ? info.jsMemoryAllocated
          : null;
      const network =
        typeof info?.network === "number" && Number.isFinite(info.network) ? info.network : null;
      return {
        ...entry,
        cpu,
        memory,
        jsMemory,
        network,
      };
    });

    results.sort((a, b) => {
      const cpuA = Number.isFinite(a.cpu) ? a.cpu : -1;
      const cpuB = Number.isFinite(b.cpu) ? b.cpu : -1;
      if (cpuA !== cpuB) {
        return cpuB - cpuA;
      }
      const memA = Number.isFinite(a.memory) ? a.memory : -1;
      const memB = Number.isFinite(b.memory) ? b.memory : -1;
      if (memA !== memB) {
        return memB - memA;
      }
      if (a.active !== b.active) {
        return a.active ? -1 : 1;
      }
      const titleA = a.title || "";
      const titleB = b.title || "";
      return titleA.localeCompare(titleB);
    });

    return {
      timestamp: Date.now(),
      metricsAvailable,
      tabs: results,
    };
  }

  return {
    captureSnapshot,
  };
}
