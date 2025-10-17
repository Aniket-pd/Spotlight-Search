import { buildIndex } from "../../indexing/indexer.js";

let indexData = null;
let buildingPromise = null;
let rebuildTimer = null;

export async function ensureIndex() {
  if (indexData) {
    return indexData;
  }
  return rebuildIndex();
}

export async function rebuildIndex() {
  if (!buildingPromise) {
    buildingPromise = buildIndex()
      .then((data) => {
        indexData = data;
        buildingPromise = null;
        return data;
      })
      .catch((error) => {
        console.error("Spotlight: failed to build index", error);
        buildingPromise = null;
        throw error;
      });
  }
  return buildingPromise;
}

export function scheduleRebuild(delay = 600) {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuildIndex().catch((err) => console.error("Spotlight: rebuild failed", err));
  }, delay);
}

export function getCachedIndex() {
  return indexData;
}

export function clearIndexCache() {
  indexData = null;
}
