export const MILLISECONDS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

export function startOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export const TIME_UNIT_DEFINITIONS = [
  { id: "second", labels: ["second", "seconds", "sec", "secs", "s"], ms: MILLISECONDS.second },
  { id: "minute", labels: ["minute", "minutes", "min", "mins", "m"], ms: MILLISECONDS.minute },
  { id: "hour", labels: ["hour", "hours", "hr", "hrs", "h"], ms: MILLISECONDS.hour },
  { id: "day", labels: ["day", "days", "d"], ms: MILLISECONDS.day },
  { id: "week", labels: ["week", "weeks", "wk", "wks"], ms: MILLISECONDS.week },
  { id: "month", labels: ["month", "months"], ms: MILLISECONDS.month },
  { id: "year", labels: ["year", "years", "yr", "yrs"], ms: MILLISECONDS.year },
];

export const NUMBER_WORD_DEFINITIONS = [
  { value: 0, labels: ["zero"] },
  { value: 1, labels: ["one", "a", "an", "single"] },
  { value: 2, labels: ["two"] },
  { value: 3, labels: ["three"] },
  { value: 4, labels: ["four"] },
  { value: 5, labels: ["five"] },
  { value: 6, labels: ["six"] },
  { value: 7, labels: ["seven"] },
  { value: 8, labels: ["eight"] },
  { value: 9, labels: ["nine"] },
  { value: 10, labels: ["ten"] },
  { value: 11, labels: ["eleven"] },
  { value: 12, labels: ["twelve"] },
  { value: 13, labels: ["thirteen"] },
  { value: 14, labels: ["fourteen"] },
  { value: 15, labels: ["fifteen"] },
  { value: 16, labels: ["sixteen"] },
  { value: 17, labels: ["seventeen"] },
  { value: 18, labels: ["eighteen"] },
  { value: 19, labels: ["nineteen"] },
  { value: 20, labels: ["twenty"] },
  { value: 30, labels: ["thirty"] },
  { value: 40, labels: ["forty"] },
  { value: 50, labels: ["fifty"] },
  { value: 60, labels: ["sixty"] },
  { value: 70, labels: ["seventy"] },
  { value: 80, labels: ["eighty"] },
  { value: 90, labels: ["ninety"] },
  { value: 100, labels: ["hundred"] },
  { value: 1000, labels: ["thousand"] },
  { value: 1000000, labels: ["million"] },
  { value: 1000000000, labels: ["billion"] },
];

export const QUANTITY_KEYWORD_DEFINITIONS = [
  { value: 2, labels: ["couple"] },
  { value: 3, labels: ["few"] },
  { value: 4, labels: ["several"] },
];

export const TIME_PRESET_DEFINITIONS = [
  {
    id: "all",
    labels: [
      "all",
      "all time",
      "all history",
      "any time",
      "anytime",
      "entire history",
      "everything",
      "whole history",
    ],
    resolveBounds(now) {
      return { from: null, to: null };
    },
  },
  {
    id: "today",
    labels: ["today"],
    resolveBounds(now) {
      const startToday = startOfDay(now);
      return { from: startToday, to: now };
    },
  },
  {
    id: "yesterday",
    labels: ["yesterday"],
    resolveBounds(now) {
      const startToday = startOfDay(now);
      const startYesterday = startToday - MILLISECONDS.day;
      return { from: startYesterday, to: startToday };
    },
  },
  {
    id: "last7",
    labels: [
      "last 7 days",
      "past 7 days",
      "previous 7 days",
      "last seven days",
      "past seven days",
      "last week",
      "past week",
      "previous week",
    ],
    resolveBounds(now) {
      return { from: Math.max(0, now - 7 * MILLISECONDS.day), to: now };
    },
  },
  {
    id: "last30",
    labels: [
      "last 30 days",
      "past 30 days",
      "previous 30 days",
      "last thirty days",
      "past thirty days",
      "last month",
      "past month",
      "previous month",
    ],
    resolveBounds(now) {
      return { from: Math.max(0, now - 30 * MILLISECONDS.day), to: now };
    },
  },
  {
    id: "older",
    labels: ["older"],
    resolveBounds(now) {
      return { from: 0, to: Math.max(0, now - 30 * MILLISECONDS.day) };
    },
  },
];
