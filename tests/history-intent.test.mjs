import assert from "node:assert/strict";
import { interpretHistoryQuery } from "../src/search/nlp/history-intent.js";
import { isSmartHistoryAssistantEnabled, setSmartHistoryAssistantEnabled } from "../src/shared/flags.js";

function testTimeRangeExtraction() {
  const intent = interpretHistoryQuery("show me yesterday's visits");
  assert.equal(intent.timeRange?.id, "yesterday");
  assert.ok(intent.answer.toLowerCase().includes("yesterday"));
}

function testDomainDetection() {
  const intent = interpretHistoryQuery("history from example.com about docs");
  assert.equal(intent.domain, "example.com");
  assert.ok(intent.searchQuery.includes("docs"));
}

function testFallbackWhenOnlyTime() {
  const intent = interpretHistoryQuery("last week");
  assert.equal(intent.timeRange?.id, "last7");
  assert.ok(intent.answer.toLowerCase().includes("last"));
}

function testFlagDefault() {
  setSmartHistoryAssistantEnabled(false);
  assert.equal(isSmartHistoryAssistantEnabled(), false);
  setSmartHistoryAssistantEnabled(true);
  assert.equal(isSmartHistoryAssistantEnabled(), true);
  setSmartHistoryAssistantEnabled(false);
}

function run() {
  testTimeRangeExtraction();
  testDomainDetection();
  testFallbackWhenOnlyTime();
  testFlagDefault();
  console.log("history-intent tests passed");
}

run();
