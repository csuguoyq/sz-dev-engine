import type { TestSummary } from "./types.js";

/**
 * Parse a test report into a verdict. Accepts a machine-readable JSON body
 * (totals + cases) and/or the markdown report; a prose-only report with no
 * PASS=/FAIL=/SKIP= tokens at all is "unverified" — evidence that the phase
 * ran exists, but no test counts can be confirmed (never a green pass).
 */
export function parseCheckResult(jsonText: string | null, markdown: string): TestSummary {
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as {
        totals?: { pass?: number; fail?: number; skip?: number };
        cases?: Array<{ id?: string; status?: string }>;
      };
      // A parsed JSON body without totals and without cases is not evidence
      // of any test run — report it as unverified instead of a green pass.
      if (parsed.totals === undefined && (parsed.cases ?? []).length === 0) {
        return { verdict: "unverified", pass: 0, fail: 0, skip: 0, skipped: [] };
      }
      const pass = parsed.totals?.pass ?? 0;
      const fail = parsed.totals?.fail ?? 0;
      const skip = parsed.totals?.skip ?? 0;
      const skipped = (parsed.cases ?? [])
        .filter((item) => (item.status ?? "").startsWith("SKIP"))
        .map((item) => `${item.id ?? "case"}: ${item.status}`);
      return { ...verdict(pass, fail, skip), skipped };
    } catch {
      // fall through to the markdown totals line
    }
  }
  const totals = /PASS=(\d+)\s+FAIL=(\d+)\s+SKIP=(\d+)/.exec(markdown);
  if (totals) {
    const pass = Number(totals[1]);
    const fail = Number(totals[2]);
    const skip = Number(totals[3]);
    return { ...verdict(pass, fail, skip), skipped: [] };
  }
  // No structured totals line (hand-authored / replay reports). Only count a
  // failure when an explicit FAIL=<n> total is present with n > 0; the bare
  // word "FAIL" in prose (e.g. "FAIL: **0**", "no FAIL") must not read as a fail.
  const fail = Number(/FAIL=(\d+)/.exec(markdown)?.[1] ?? 0);
  const pass = Number(/PASS=(\d+)/.exec(markdown)?.[1] ?? 0);
  const skip = Number(/SKIP=(\d+)/.exec(markdown)?.[1] ?? 0);
  if (pass === 0 && fail === 0 && skip === 0 && !/(?:PASS|FAIL|SKIP)=\d+/.test(markdown)) {
    // No totals tokens at all: the report is hand-authored prose. The phase
    // ran (the file is gate evidence) but no test counts are verifiable.
    return { verdict: "unverified", pass: 0, fail: 0, skip: 0, skipped: [] };
  }
  return { ...verdict(pass, fail, skip), skipped: [] };
}

function verdict(pass: number, fail: number, skip: number): Omit<TestSummary, "skipped"> {
  if (fail > 0) return { verdict: "failed", pass, fail, skip };
  if (skip > 0) return { verdict: "passed_with_blocked", pass, fail, skip };
  return { verdict: "passed", pass, fail, skip };
}
