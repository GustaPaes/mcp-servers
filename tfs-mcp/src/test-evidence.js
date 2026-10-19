import { z } from "zod";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const count = z.number().int().min(0).max(1_000_000);
const summary = z.strictObject({ schemaVersion: z.literal(1), total: count, passed: count, failed: count, skipped: count });
const array = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
function counts(total, failed, skipped, passed = Number(total) - Number(failed) - Number(skipped)) {
  const result = summary.parse({ schemaVersion: 1, total: Number(total), passed: Number(passed), failed: Number(failed), skipped: Number(skipped) });
  if (result.total !== result.passed + result.failed + result.skipped) throw new Error("Inconsistent test counters.");
  return result;
}
export function parseTestEvidence(bytes, format) {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  if (format === "summary-json") {
    const data = summary.parse(JSON.parse(text));
    return counts(data.total, data.failed, data.skipped, data.passed);
  }
  if (format === "jest-json") {
    const data = z.object({ numTotalTests: count, numPassedTests: count, numFailedTests: count, numPendingTests: count,
      numTodoTests: count.optional(), numRuntimeErrorTestSuites: count.optional(), success: z.boolean() }).parse(JSON.parse(text));
    const result = counts(data.numTotalTests, data.numFailedTests, data.numPendingTests + (data.numTodoTests ?? 0), data.numPassedTests);
    return { ...result, executionFailed: !data.success || (data.numRuntimeErrorTestSuites ?? 0) > 0 };
  }
  if (!['junit', 'trx'].includes(format)) throw new Error("Unsupported report format.");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new Error("DTD and entity declarations are forbidden.");
  if (XMLValidator.validate(text) !== true) throw new Error("Invalid XML test report.");
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true,
    processEntities: false, maxNestedTags: 32, parseTagValue: false,
    onDangerousProperty: () => { throw new Error("Unsafe XML property."); },
  }).parse(text);
  if (format === "trx") {
    const counters = parsed.TestRun?.ResultSummary?.Counters;
    if (!counters || Array.isArray(counters)) throw new Error("Missing TRX counters.");
    const total = Number(counters['@_total']);
    const passed = Number(counters['@_passed']);
    const failed = Number(counters['@_failed']);
    const results = array(parsed.TestRun?.Results?.UnitTestResult);
    if (results.length !== total) throw new Error("TRX results do not match counters.");
    if (results.filter((item) => item['@_outcome'] === 'Passed').length !== passed
      || results.filter((item) => item['@_outcome'] === 'Failed').length !== failed) {
      throw new Error("TRX result outcomes do not match counters.");
    }
    return { ...counts(total, failed, total - passed - failed, passed),
      executionFailed: !['Completed', 'Passed'].includes(parsed.TestRun.ResultSummary['@_outcome']) };
  }
  const suites = array(parsed.testsuites?.testsuite ?? parsed.testsuite);
  if (!suites.length || suites.length > 1000) throw new Error("Expected bounded JUnit suites.");
  let total = 0, failed = 0, skipped = 0, failureCases = 0, errorCases = 0;
  const checkCounters = (suite, expected) => {
    for (const [attribute, amount] of Object.entries(expected)) {
      if (suite[`@_${attribute}`] != null && Number(suite[`@_${attribute}`]) !== amount) throw new Error('JUnit cases do not match counters.');
    }
  };
  const visit = (suite, depth) => {
    if (depth > 20) throw new Error("JUnit nesting limit exceeded.");
    const cases = array(suite.testcase);
    const nested = array(suite.testsuite);
    const before = { total, failureCases, errorCases, skipped };
    if (cases.length + total > 1_000_000) throw new Error("JUnit case limit exceeded.");
    total += cases.length;
    for (const item of cases) {
      if (Object.hasOwn(item, 'failure') || Object.hasOwn(item, 'error')) failed++;
      else if (Object.hasOwn(item, 'skipped')) skipped++;
      if (Object.hasOwn(item, 'failure')) failureCases++;
      if (Object.hasOwn(item, 'error')) errorCases++;
    }
    for (const child of nested) visit(child, depth + 1);
    checkCounters(suite, { tests: total - before.total, failures: failureCases - before.failureCases,
      errors: errorCases - before.errorCases, skipped: skipped - before.skipped });
  };
  for (const suite of suites) visit(suite, 0);
  if (parsed.testsuites) checkCounters(parsed.testsuites, { tests: total, failures: failureCases, errors: errorCases, skipped });
  return counts(total, failed, skipped);
}
