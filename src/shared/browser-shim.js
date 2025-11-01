const globalObject = (typeof globalThis !== "undefined" && globalThis)
  || (typeof self !== "undefined" && self)
  || (typeof window !== "undefined" && window)
  || {};

const rawChrome = typeof globalObject.chrome !== "undefined" ? globalObject.chrome : null;
const rawBrowser = typeof globalObject.browser !== "undefined" ? globalObject.browser : null;

const isChrome = Boolean(rawChrome && rawChrome.runtime);
const isBrowserNamespace = Boolean(!isChrome && rawBrowser && rawBrowser.runtime);

if (isBrowserNamespace && rawBrowser && !rawBrowser.action && rawBrowser.browserAction) {
  try {
    rawBrowser.action = rawBrowser.browserAction;
  } catch (err) {
    // Read-only in some environments; ignore if assignment fails.
  }
}

const proxyCache = new WeakMap();

function wrapNamespace(target) {
  if (!target || typeof target !== "object") {
    return target;
  }
  if (proxyCache.has(target)) {
    return proxyCache.get(target);
  }

  const proxy = new Proxy(target, {
    get(obj, prop) {
      if (prop === "__isShimProxy") {
        return true;
      }
      if (prop === "__raw") {
        return obj;
      }
      const value = Reflect.get(obj, prop);
      if (typeof value === "function") {
        return (...args) => {
          const hasCallback = args.length && typeof args[args.length - 1] === "function";
          if (isChrome) {
            if (hasCallback) {
              return value.apply(obj, args);
            }
            return new Promise((resolve, reject) => {
              try {
                value.call(obj, ...args, (result) => {
                  const lastError = rawChrome?.runtime?.lastError;
                  if (lastError) {
                    reject(lastError);
                    return;
                  }
                  resolve(result);
                });
              } catch (err) {
                reject(err);
              }
            });
          }
          return value.apply(obj, args);
        };
      }
      if (value && typeof value === "object") {
        return wrapNamespace(value);
      }
      return value;
    },
  });

  proxyCache.set(target, proxy);
  return proxy;
}

const baseApi = wrapNamespace(isChrome ? rawChrome : isBrowserNamespace ? rawBrowser : {});

if (globalObject && typeof globalObject === "object") {
  try {
    globalObject.SpotlightBrowser = baseApi;
  } catch (err) {
    // Ignore assignment failures.
  }
}

export const browser = baseApi;
export const platform = {
  isChrome,
  isFirefoxLike: Boolean(isBrowserNamespace && !isChrome),
  isSafariLike: Boolean(isBrowserNamespace && !isChrome),
};

function hasFunction(namespace, method) {
  const target = namespace ? namespace[method] : undefined;
  return typeof target === "function";
}

export function supportsTabGroups() {
  const tabGroupsNamespace = browser?.tabGroups;
  return Boolean(tabGroupsNamespace && hasFunction(browser.tabs, "group") && hasFunction(tabGroupsNamespace, "update"));
}

export function supportsDownloads() {
  const downloadsNamespace = browser?.downloads;
  return Boolean(downloadsNamespace && (hasFunction(downloadsNamespace, "download") || hasFunction(downloadsNamespace, "open")));
}

export function supportsWebNavigation() {
  const webNavigation = browser?.webNavigation;
  return Boolean(webNavigation && hasFunction(webNavigation, "onCommitted") && hasFunction(webNavigation, "onHistoryStateUpdated"));
}

export function supportsScripting() {
  const scripting = browser?.scripting;
  return Boolean(scripting && hasFunction(scripting, "executeScript"));
}

export function supportsTopSites() {
  const topSites = browser?.topSites;
  return Boolean(topSites && hasFunction(topSites, "get"));
}

export function getActionNamespace() {
  return browser?.action || browser?.browserAction || null;
}

export function withFallback(asyncFn, fallback) {
  return async (...args) => {
    if (typeof asyncFn === "function") {
      try {
        return await asyncFn(...args);
      } catch (err) {
        if (typeof fallback === "function") {
          return fallback(err, ...args);
        }
        throw err;
      }
    }
    if (typeof fallback === "function") {
      return fallback(null, ...args);
    }
    return undefined;
  };
}
