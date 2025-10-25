const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SESSION_GAP_MS = 30 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 90 * DAY_MS;
const MAX_HISTORY_RESULTS = 800;
const MAX_GROUPS = 10;
const MAX_ENTRIES_PER_GROUP = 10;
const QUICK_OPEN_LIMIT = 6;
const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function clampTimestamp(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

function startOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function startOfWeek(timestamp) {
  const date = new Date(timestamp);
  const day = date.getDay();
  const diff = (day + 7 - 1) % 7; // Monday as start
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfWeek(timestamp) {
  const start = startOfWeek(timestamp);
  return start + WEEK_MS - 1;
}

function startOfMonth(timestamp) {
  const date = new Date(timestamp);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfMonth(timestamp) {
  const date = new Date(timestamp);
  date.setMonth(date.getMonth() + 1, 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime() - 1;
}

function parseIsoDate(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function applyDayPart(range, description) {
  if (!range || !Number.isFinite(range.start)) {
    return range;
  }
  const lower = (description || "").toLowerCase();
  const adjustments = {
    morning: [6, 12],
    afternoon: [12, 17],
    evening: [17, 22],
    night: [20, 28],
  };
  for (const [key, [startHour, endHour]] of Object.entries(adjustments)) {
    if (!lower.includes(key)) {
      continue;
    }
    const start = new Date(range.start);
    start.setHours(startHour, 0, 0, 0);
    let end = new Date(range.start);
    if (endHour >= 24) {
      end.setDate(end.getDate() + 1);
      end.setHours(endHour - 24, 0, 0, 0);
    } else {
      end.setHours(endHour, 0, 0, 0);
    }
    const adjusted = { ...range };
    adjusted.start = start.getTime();
    if (Number.isFinite(range.end)) {
      adjusted.end = Math.min(range.end, end.getTime() - 1);
    } else {
      adjusted.end = end.getTime() - 1;
    }
    return adjusted;
  }
  return range;
}

function resolveRelativeRange(description, now) {
  const lower = (description || "").toLowerCase();
  const result = { start: null, end: null, preset: null };

  const absoluteMatch = lower.match(/(\d{4}-\d{2}-\d{2})/);
  if (absoluteMatch) {
    const start = parseIsoDate(absoluteMatch[1]);
    if (start) {
      result.start = startOfDay(start);
      result.end = endOfDay(start);
      return applyDayPart(result, description);
    }
  }

  if (lower.includes("today")) {
    result.start = startOfDay(now);
    result.end = now;
    result.preset = "today";
    return applyDayPart(result, description);
  }

  if (lower.includes("yesterday")) {
    const day = startOfDay(now) - DAY_MS;
    result.start = day;
    result.end = endOfDay(day);
    result.preset = "yesterday";
    return applyDayPart(result, description);
  }

  if (lower.includes("last weekend") || lower.includes("past weekend")) {
    const date = new Date(now);
    const day = date.getDay();
    const offset = day === 0 ? 8 : day + 1;
    const sunday = startOfDay(now - offset * DAY_MS);
    const saturday = sunday - DAY_MS;
    result.start = startOfDay(saturday);
    result.end = endOfDay(sunday);
    result.preset = "last_weekend";
    return applyDayPart(result, description);
  }

  if (lower.includes("weekend")) {
    const saturday = startOfDay(now) - ((new Date(now).getDay() + 1) % 7) * DAY_MS;
    result.start = startOfDay(saturday);
    result.end = endOfDay(saturday + DAY_MS);
    result.preset = "weekend";
    return applyDayPart(result, description);
  }

  if (lower.includes("last week") || lower.includes("past week")) {
    const end = startOfWeek(now) - 1;
    const start = end - WEEK_MS + 1;
    result.start = start;
    result.end = end;
    result.preset = "last_week";
    return applyDayPart(result, description);
  }

  if (lower.includes("last 7 days") || lower.includes("past 7 days") || lower.includes("past week")) {
    result.start = now - 7 * DAY_MS;
    result.end = now;
    result.preset = "last7";
    return applyDayPart(result, description);
  }

  if (lower.includes("last 30 days") || lower.includes("past month")) {
    result.start = now - 30 * DAY_MS;
    result.end = now;
    result.preset = "last30";
    return applyDayPart(result, description);
  }

  if (lower.includes("last month")) {
    const start = startOfMonth(now);
    const prevStart = startOfMonth(start - DAY_MS);
    result.start = prevStart;
    result.end = start - 1;
    result.preset = "last_month";
    return applyDayPart(result, description);
  }

  if (lower.includes("three months ago") || lower.includes("3 months ago")) {
    const anchor = new Date(now);
    anchor.setDate(1);
    anchor.setHours(0, 0, 0, 0);
    anchor.setMonth(anchor.getMonth() - 3);
    const targetStart = anchor.getTime();
    result.start = targetStart;
    result.end = endOfMonth(targetStart);
    result.preset = "three_months_ago";
    return applyDayPart(result, description);
  }

  const weekdayMatch = lower.match(/(last|this|past)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (weekdayMatch) {
    const modifier = weekdayMatch[1] || "last";
    const weekday = weekdayMatch[2];
    const targetIndex = WEEKDAY_INDEX[weekday];
    const today = new Date(now);
    const todayIndex = today.getDay();
    let diff = targetIndex - todayIndex;
    if (modifier === "last" || modifier === "past") {
      if (diff >= 0) {
        diff -= 7;
      }
    } else if (modifier === "this") {
      if (diff > 0) {
        diff -= 7;
      }
    }
    const target = startOfDay(now + diff * DAY_MS);
    result.start = target;
    result.end = endOfDay(target);
    result.preset = `day_${weekday}`;
    return applyDayPart(result, description);
  }

  return applyDayPart(result, description);
}

function resolveTimeRange(timeRange = {}, now = Date.now()) {
  const description = typeof timeRange.description === "string" && timeRange.description.trim()
    ? timeRange.description.trim()
    : "recently";
  const explicitStart = parseIsoDate(timeRange.start);
  const explicitEnd = parseIsoDate(timeRange.end);
  let start = explicitStart;
  let end = explicitEnd;
  let preset = typeof timeRange.preset === "string" ? timeRange.preset : null;

  if (!start || !Number.isFinite(start)) {
    const relative = resolveRelativeRange(description, now);
    start = Number.isFinite(relative.start) ? relative.start : null;
    end = Number.isFinite(relative.end) ? relative.end : end;
    preset = preset || relative.preset || null;
  }

  if (!Number.isFinite(start)) {
    start = now - DEFAULT_LOOKBACK_MS;
  }
  if (!Number.isFinite(end)) {
    end = now;
  }
  if (start > end) {
    const temp = start;
    start = end;
    end = temp;
  }

  return {
    description,
    preset,
    startTime: clampTimestamp(start),
    endTime: clampTimestamp(end),
  };
}

function normalizeTopics(topics) {
  if (!Array.isArray(topics)) {
    return [];
  }
  return topics
    .map((topic) => (typeof topic === "string" ? topic.trim() : ""))
    .filter(Boolean);
}

function filterHistoryByTopics(entries, topics) {
  if (!topics.length) {
    return entries;
  }
  const lowerTopics = topics.map((topic) => topic.toLowerCase());
  return entries.filter((entry) => {
    const title = (entry.title || "").toLowerCase();
    const url = (entry.url || "").toLowerCase();
    return lowerTopics.every((topic) => title.includes(topic) || url.includes(topic));
  });
}

function groupHistoryEntries(entries, { locale, sessionGapMs }) {
  const groups = [];
  let currentGroup = null;
  let lastEntry = null;

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  });
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  });

  entries.forEach((entry) => {
    const timestamp = typeof entry.lastVisitTime === "number" ? entry.lastVisitTime : 0;
    if (!timestamp) {
      return;
    }
    if (
      !currentGroup ||
      !lastEntry ||
      lastEntry.lastVisitTime - timestamp > sessionGapMs ||
      startOfDay(lastEntry.lastVisitTime) !== startOfDay(timestamp)
    ) {
      const groupId = `group-${timestamp}-${groups.length}`;
      currentGroup = {
        id: groupId,
        entries: [],
        start: timestamp,
        end: timestamp,
        dateLabel: dateFormatter.format(new Date(timestamp)),
        timeLabel: "",
        label: "Session",
      };
      groups.push(currentGroup);
    }

    const groupEntry = {
      id: `${currentGroup.id}-entry-${currentGroup.entries.length}`,
      url: entry.url,
      title: entry.title || entry.url,
      lastVisitTime: timestamp,
      hostname: (() => {
        try {
          return new URL(entry.url).hostname || "";
        } catch (err) {
          return "";
        }
      })(),
      groupId: currentGroup.id,
    };
    currentGroup.entries.push(groupEntry);
    currentGroup.start = Math.max(currentGroup.start, timestamp);
    currentGroup.end = Math.min(currentGroup.end, timestamp);
    lastEntry = entry;
  });

  groups.forEach((group) => {
    group.entries.sort((a, b) => b.lastVisitTime - a.lastVisitTime);
    const first = group.entries[0];
    const last = group.entries[group.entries.length - 1];
    const startLabel = first ? timeFormatter.format(new Date(first.lastVisitTime)) : "";
    const endLabel = last ? timeFormatter.format(new Date(last.lastVisitTime)) : "";
    group.timeLabel = startLabel && endLabel ? `${endLabel} – ${startLabel}` : startLabel || endLabel || "";
    group.entryCount = group.entries.length;
    if (group.entries.length === 1 && group.entries[0].hostname) {
      group.label = group.entries[0].hostname;
    } else if (group.entries.length >= 2) {
      const hostnames = new Set(
        group.entries
          .map((entry) => entry.hostname)
          .filter(Boolean)
      );
      if (hostnames.size === 1) {
        group.label = Array.from(hostnames)[0];
      } else {
        group.label = `${group.entries.length} pages`;
      }
    }
  });

  return groups.slice(0, MAX_GROUPS).map((group) => ({
    ...group,
    entries: group.entries.slice(0, MAX_ENTRIES_PER_GROUP),
  }));
}

async function queryHistory({ text, startTime, endTime }) {
  const params = {
    text: text || "",
    startTime: clampTimestamp(startTime) || 0,
    maxResults: MAX_HISTORY_RESULTS,
  };
  const items = await chrome.history.search(params);
  const filtered = Array.isArray(items)
    ? items.filter((item) => {
        if (!item || !item.url) {
          return false;
        }
        if (Number.isFinite(endTime) && typeof item.lastVisitTime === "number") {
          return item.lastVisitTime <= endTime;
        }
        return true;
      })
    : [];
  filtered.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
  return filtered;
}

function buildSummary(action, groups, { topics, description }) {
  const entryCount = groups.reduce((sum, group) => sum + (group.entryCount || 0), 0);
  const topicLabel = topics.length ? topics.join(", ") : "everything";
  const rangeLabel = description || "recently";
  if (action === "open") {
    return entryCount
      ? `Reopened ${entryCount} item${entryCount === 1 ? "" : "s"} from ${rangeLabel}.`
      : `I didn’t find anything to reopen from ${rangeLabel}.`;
  }
  if (action === "delete") {
    return entryCount
      ? `Review ${entryCount} item${entryCount === 1 ? "" : "s"} from ${rangeLabel} before deleting.`
      : `There’s nothing to delete for ${topicLabel} in ${rangeLabel}.`;
  }
  return entryCount
    ? `Here’s what I found for ${topicLabel} from ${rangeLabel}.`
    : `I couldn’t find ${topicLabel} from ${rangeLabel}.`;
}

async function openEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return { opened: 0 };
  }
  const unique = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || !entry.url || seen.has(entry.url)) {
      continue;
    }
    seen.add(entry.url);
    unique.push(entry);
    if (unique.length >= QUICK_OPEN_LIMIT) {
      break;
    }
  }
  let opened = 0;
  for (let index = 0; index < unique.length; index += 1) {
    const entry = unique[index];
    try {
      await chrome.tabs.create({ url: entry.url, active: index === 0 });
      opened += 1;
    } catch (err) {
      console.warn("Spotlight history assistant: failed to open", entry.url, err);
    }
  }
  return { opened };
}

async function deleteEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return { deleted: 0 };
  }
  let deleted = 0;
  for (const entry of entries) {
    if (!entry || !entry.url) {
      continue;
    }
    try {
      await chrome.history.deleteUrl({ url: entry.url });
      deleted += 1;
    } catch (err) {
      console.warn("Spotlight history assistant: failed to delete", entry.url, err);
    }
  }
  return { deleted };
}

export function createHistoryAssistantService() {
  const locale = chrome?.i18n?.getUILanguage?.() || "en-US";

  async function handleIntent(intent = {}, { requestId } = {}) {
    const action = typeof intent.action === "string" ? intent.action.toLowerCase() : "search";
    const topics = normalizeTopics(intent.topics);
    const range = resolveTimeRange(intent.time_range, Date.now());

    const historyItems = await queryHistory({
      text: topics.join(" "),
      startTime: range.startTime,
      endTime: range.endTime,
    });

    const filtered = filterHistoryByTopics(historyItems, topics);
    const groups = groupHistoryEntries(filtered, { locale, sessionGapMs: SESSION_GAP_MS });
    const summary = buildSummary(action, groups, { topics, description: range.description });

    if (action === "delete") {
      return {
        success: true,
        requestId,
        action: "delete",
        summary,
        confirmationRequired: true,
        groups,
      };
    }

    if (action === "open") {
      const toOpen = groups.flatMap((group) => group.entries);
      const { opened } = await openEntries(toOpen);
      const message = opened
        ? `Reopened ${opened} item${opened === 1 ? "" : "s"}.`
        : "Nothing matched to reopen.";
      return {
        success: true,
        requestId,
        action: "open",
        summary: message,
        groups,
      };
    }

    return {
      success: true,
      requestId,
      action: "search",
      summary,
      groups,
    };
  }

  async function openSelection(entries = []) {
    const { opened } = await openEntries(entries);
    return {
      success: true,
      opened,
      summary: opened
        ? `Opened ${opened} item${opened === 1 ? "" : "s"}.`
        : "Nothing opened—try a different session.",
    };
  }

  async function deleteSelection(entries = []) {
    const { deleted } = await deleteEntries(entries);
    return {
      success: true,
      deleted,
      summary: deleted
        ? `Deleted ${deleted} item${deleted === 1 ? "" : "s"}.`
        : "Nothing deleted.",
    };
  }

  return {
    handleIntent,
    openSelection,
    deleteSelection,
  };
}
