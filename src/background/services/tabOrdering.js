import { getDomainFromUrl } from "../../common/urls.js";

export function tabTitle(tab) {
  return tab?.title || tab?.url || "";
}

export function tabDomain(tab) {
  if (!tab?.url) {
    return "";
  }
  return getDomainFromUrl(tab.url);
}

export function compareTabsByDomainAndTitle(a, b) {
  const domainA = tabDomain(a).toLowerCase();
  const domainB = tabDomain(b).toLowerCase();
  if (domainA !== domainB) {
    return domainA.localeCompare(domainB);
  }

  const titleA = tabTitle(a).toLowerCase();
  const titleB = tabTitle(b).toLowerCase();
  if (titleA !== titleB) {
    return titleA.localeCompare(titleB);
  }

  const urlA = (a?.url || "").toLowerCase();
  const urlB = (b?.url || "").toLowerCase();
  if (urlA !== urlB) {
    return urlA.localeCompare(urlB);
  }

  const idA = a?.id === undefined ? "" : String(a.id);
  const idB = b?.id === undefined ? "" : String(b.id);
  return idA.localeCompare(idB);
}
