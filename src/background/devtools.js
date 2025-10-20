const PROTOCOL_VERSION = "1.3";

function debuggerAvailable() {
  return (
    typeof chrome !== "undefined" &&
    chrome?.debugger &&
    typeof chrome.debugger.attach === "function" &&
    typeof chrome.debugger.detach === "function" &&
    typeof chrome.debugger.sendCommand === "function"
  );
}

function attachDebugger(target) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.attach(target, PROTOCOL_VERSION, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

function detachDebugger(target) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.detach(target, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

function sendDebuggerCommand(target, method, params) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.sendCommand(target, method, params || {}, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function createDevtoolsBridge() {
  if (!debuggerAvailable()) {
    return null;
  }

  const sessions = new Map();

  chrome.debugger.onDetach.addListener((source) => {
    if (!source || typeof source.tabId !== "number") {
      return;
    }
    sessions.delete(source.tabId);
  });

  if (chrome?.tabs?.onRemoved?.addListener) {
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (!Number.isInteger(tabId) || !sessions.has(tabId)) {
        return;
      }
      detachFromTab(tabId).catch((err) => {
        console.warn("Spotlight: failed to detach debugger after tab removal", err);
      });
    });
  }

  async function ensureAttachedSession(tabId) {
    if (!Number.isInteger(tabId)) {
      throw new Error("Invalid tab id");
    }

    let session = sessions.get(tabId);
    if (session && session.attached) {
      return session;
    }

    if (session && session.attachPromise) {
      await session.attachPromise;
      return sessions.get(tabId) || null;
    }

    const target = { tabId };
    const attachPromise = attachDebugger(target)
      .then(() => {
        const current = sessions.get(tabId);
        const commandChain = Promise.resolve();
        const nextSession = {
          target,
          attached: true,
          commandChain,
        };
        sessions.set(tabId, nextSession);
        return nextSession;
      })
      .catch((err) => {
        sessions.delete(tabId);
        throw err;
      });

    sessions.set(tabId, { target, attachPromise });
    return attachPromise;
  }

  async function attachToTab(tabId) {
    const existing = sessions.get(tabId);
    if (existing && existing.attached) {
      return { attached: true, alreadyAttached: true };
    }

    await ensureAttachedSession(tabId);
    return { attached: true, alreadyAttached: Boolean(existing) };
  }

  async function detachFromTab(tabId) {
    const session = sessions.get(tabId);
    if (!session) {
      return { detached: true, wasAttached: false };
    }

    if (session.attachPromise) {
      try {
        await session.attachPromise;
      } catch (err) {
        sessions.delete(tabId);
        return { detached: true, wasAttached: false };
      }
      return detachFromTab(tabId);
    }

    try {
      await detachDebugger(session.target);
    } finally {
      sessions.delete(tabId);
    }

    return { detached: true, wasAttached: true };
  }

  async function sendCommand(tabId, method, params) {
    if (typeof method !== "string" || !method) {
      throw new Error("Invalid DevTools method");
    }

    const session = await ensureAttachedSession(tabId);
    if (!session || !session.attached) {
      throw new Error("Unable to attach to tab");
    }

    const commandChain = session.commandChain || Promise.resolve();
    const nextCommand = commandChain
      .catch(() => undefined)
      .then(() => sendDebuggerCommand(session.target, method, params));

    session.commandChain = nextCommand.catch(() => undefined);
    return nextCommand;
  }

  return {
    attachToTab,
    detachFromTab,
    sendCommand,
    isAvailable: () => true,
  };
}
