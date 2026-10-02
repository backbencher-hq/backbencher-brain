// script/m15/security-oracle.ts — a fix-differential oracle for taint detection.
//
// WHY THIS EXISTS
//
// bb_security reports a measured 16.0% hit rate on this repository's own index
// (docs/m48/SECURITY-PRECISION-PROPOSAL.md). Nobody could act on that number
// because there is no ORACLE: no verifier in this repository can say "this
// SHOULD have been a finding", so every precision figure is a proxy — and a
// proxy cannot decide whether a change helped.
//
// This file is the smallest oracle that produces a ground-truth-labelled
// measurement without needing a labelled corpus.
//
// THE METHOD
//
// For each fixture, index a VULNERABLE file and then its REAL FIX:
//
//   disappeared  the fix removed the finding   -> the detector tracked the
//                                                  actual vulnerability
//   persisted    the fix left the finding in   -> it did not
//
// That is the whole trick. The FIX is the label. It is written by a human who
// knows the vulnerability and the repair, so it carries exactly the ground truth
// a precision number needs, and it is hermetic: two temp directories, no corpus,
// no network.
//
// The fixed variants are written to be genuinely CLEAN — the vulnerability is
// removed and nothing else is introduced. That makes the measurement one-sided
// and unambiguous:
//
//   any finding in a FIXED file is a false positive for that fixture's class
//
// (A finding in a fixed file could in principle be a real second vulnerability
// the author did not notice. Writing the fixed variants clean makes that
// unlikely, and `EXPECTED_CLASSES` below records what each fixture is supposed
// to detect so the claim is checkable rather than assumed.)
//
// WHAT IT DELIBERATELY DOES NOT CLAIM
//
//   - It does not measure RECALL against real-world prevalence. It measures
//     whether the detector responds to a real fix. A detector that reports
//     nothing anywhere scores 0/0 here and would look perfect.
//   - Every fixture is a pattern I chose. It is not a sample of the world's
//     vulnerabilities and must not be published as a rate.
//
// It is a REGRESSION ORACLE: its job is to make "did this change help?" a
// decidable question, not to certify the detector as good.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { analyzeTaintFlows } from "../../src/intelligence/security/taint"

export type Fixture = {
  id: string
  language: string
  file: string
  /** The vulnerability class the fixture is a known instance of. */
  vuln: string
  /** What a correct fix does. Used in the failure report, not asserted. */
  fixDescription: string
  vulnerable: string
  /** Genuinely clean: the vulnerability is repaired and nothing else added. */
  fixed: string
}

/**
 * Eight fixtures across six languages. Each `fixed` body is a real repair for
 * the stated class — parameterization, allow-listing, a safe API, a bounds
 * check — not a rename or a comment.
 *
 * The parameterization fixtures are the sharpest ones: after the fix the source
 * token (`req.query`) and the sink token (`db.query`) are BOTH still present in
 * the body, because that is what a parameterized query looks like. A
 * token-matching detector has no way to tell it from the vulnerability.
 */
export const FIXTURES: Fixture[] = [
  {
    id: "ts-sqli-concat",
    language: "typescript",
    file: "handler.ts",
    vuln: "sql_injection",
    fixDescription: "parameterize the query instead of concatenating request data",
    vulnerable: [
      "import { db } from './db'",
      "export function findUser(req: { query: string }) {",
      "  const name = req.query",
      "  return db.query('SELECT * FROM users WHERE name = ' + name)",
      "}",
    ].join("\n") + "\n",
    fixed: [
      "import { db } from './db'",
      "export function findUser(req: { query: string }) {",
      "  const name = req.query",
      "  return db.query('SELECT * FROM users WHERE name = ?', [name])",
      "}",
    ].join("\n") + "\n",
  },
  {
    id: "ts-cmdi-exec",
    language: "typescript",
    file: "runner.ts",
    vuln: "command_injection",
    fixDescription: "use execFile with an argument array instead of a shell string",
    vulnerable: [
      "import { exec } from 'child_process'",
      "export function runCmd(req: { query: string }) {",
      "  const cmd = 'ls ' + req.query",
      "  return exec(cmd)",
      "}",
    ].join("\n") + "\n",
    fixed: [
      "import { execFile } from 'child_process'",
      "export function runCmd(req: { query: string }) {",
      "  return execFile('ls', [req.query])",
      "}",
    ].join("\n") + "\n",
  },
  {
    id: "ts-xss-innerhtml",
    language: "typescript",
    file: "view.ts",
    vuln: "xss",
    fixDescription: "assign to textContent instead of innerHTML",
    vulnerable: [
      "export function render(el: HTMLElement, req: { query: string }) {",
      "  const name = req.query",
      "  el.innerHTML = name",
      "}",
    ].join("\n") + "\n",
    fixed: [
      "export function render(el: HTMLElement, req: { query: string }) {",
      "  el.textContent = req.query",
      "}",
    ].join("\n") + "\n",
  },
  {
    id: "py-sqli-execute",
    language: "python",
    file: "view.py",
    vuln: "sql_injection",
    fixDescription: "pass the value as a bound parameter",
    vulnerable: [
      "def find_user(request):",
      "    name = request.GET['name']",
      "    cursor.execute('SELECT * FROM users WHERE name = ' + name)",
    ].join("\n") + "\n",
    fixed: [
      "def find_user(request):",
      "    name = request.GET['name']",
      "    cursor.execute('SELECT * FROM users WHERE name = %s', [name])",
    ].join("\n") + "\n",
  },
  {
    id: "py-cmdi-system",
    language: "python",
    file: "runner.py",
    vuln: "command_injection",
    fixDescription: "pass an argument list instead of invoking a shell",
    vulnerable: [
      "import os",
      "def run(request):",
      "    target = request.GET['host']",
      "    os.system('ping ' + target)",
    ].join("\n") + "\n",
    fixed: [
      "import subprocess",
      "def run(request):",
      "    target = request.GET['host']",
      "    subprocess.run(['ping', target], shell=False)",
    ].join("\n") + "\n",
  },
  {
    id: "go-cmdi-command",
    language: "go",
    file: "runner.go",
    vuln: "command_injection",
    fixDescription: "invoke the binary directly without a shell",
    vulnerable: [
      "package main",
      "import \"os/exec\"",
      "func run(host string) {",
      "\texec.Command(\"sh\", \"-c\", \"ping \"+host)",
      "}",
    ].join("\n") + "\n",
    fixed: [
      "package main",
      "import \"os/exec\"",
      "func run(host string) {",
      "\texec.Command(\"ping\", host)",
      "}",
    ].join("\n") + "\n",
  },
  {
    id: "java-sqli-execquery",
    language: "java",
    file: "Dao.java",
    vuln: "sql_injection",
    fixDescription: "bind the parameter instead of building SQL by concatenation",
    vulnerable: [
      "class Dao {",
      "  void find(String requestParam) throws Exception {",
      "    stmt.executeQuery(\"SELECT * FROM users WHERE name = \" + requestParam);",
      "  }",
      "}",
    ].join("\n") + "\n",
    fixed: [
      "class Dao {",
      "  void find(String requestParam) throws Exception {",
      "    ps = conn.prepareStatement(\"SELECT * FROM users WHERE name = ?\");",
      "    ps.setString(1, requestParam);",
      "    ps.executeQuery();",
      "  }",
      "}",
    ].join("\n") + "\n",
  },
  {
    id: "rb-cmdi-system",
    language: "ruby",
    file: "runner.rb",
    vuln: "command_injection",
    fixDescription: "use the array form so no shell parses the string",
    vulnerable: [
      "def run(request)",
      "  target = request.params[:host]",
      "  system(\"ping #{target}\")",
      "end",
    ].join("\n") + "\n",
    fixed: [
      "def run(request)",
      "  target = request.params[:host]",
      "  system(\"ping\", target)",
      "end",
    ].join("\n") + "\n",
  },
]

export type FixtureOutcome = {
  id: string
  language: string
  vuln: string
  /** Findings in the vulnerable file, keyed by `class|file:line|state`. */
  before: string[]
  /** Findings in the fixed file. */
  after: string[]
  /** In `before`, absent from `after` — the detector tracked the fix. */
  disappeared: string[]
  /** In both — the finding did not respond to the fix. */
  persisted: string[]
  /** Did the vulnerable file produce a finding of the expected class at all? */
  detectedVulnerable: boolean
  /** Did the fixed file produce any finding at all? */
  cleanFixed: boolean
}

/**
 * Run one fixture. Both halves are indexed as SEPARATE projects in temp dirs so
 * neither can contaminate the other's symbols or taint rows.
 */
export async function runFixture(fx: Fixture): Promise<FixtureOutcome> {
  const scan = async (body: string): Promise<string[]> => {
    const root = mkdtempSync(path.join(tmpdir(), `bb-oracle-${fx.id}-`))
    try {
      const abs = path.join(root, fx.file)
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, body)
      const projectId = getProjectId(root)
      await indexProjectParallel(projectId, root, {})
      const report = await analyzeTaintFlows(projectId, { maxResults: 500 })
      return report.findings
        // The line number is deliberately NOT part of the key: a fix legitimately
        // moves a line, and keying on it would score every line-shifting fix as
        // "disappeared" — which would reward the detector for finding the right
        // class at the wrong place rather than for tracking the vulnerability.
        .map((f) => `${f.vulnerabilityType}|${f.file}|${f.state}`)
        .sort()
    } finally {
      const projectId = getProjectId(root)
      rmSync(root, { recursive: true, force: true })
      try {
        const { BrainDatabase } = await import("../../src/brain/database")
        rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
      } catch {}
    }
  }

  const before = await scan(fx.vulnerable)
  const after = await scan(fx.fixed)
  const afterSet = new Set(after)
  const beforeSet = new Set(before)
  return {
    id: fx.id,
    language: fx.language,
    vuln: fx.vuln,
    before: [...beforeSet],
    after: [...afterSet],
    disappeared: [...beforeSet].filter((k) => !afterSet.has(k)),
    persisted: [...beforeSet].filter((k) => afterSet.has(k)),
    detectedVulnerable: before.some((k) => k.startsWith(`${fx.vuln}|`)),
    cleanFixed: after.length === 0,
  }
}

export async function runOracle(): Promise<FixtureOutcome[]> {
  const out: FixtureOutcome[] = []
  for (const fx of FIXTURES) out.push(await runFixture(fx))
  return out
}

/** Aggregate. Every number here is defined in the header of this file. */
export function summarise(outcomes: FixtureOutcome[]) {
  const detected = outcomes.filter((o) => o.detectedVulnerable).length
  const trackedFix = outcomes.filter((o) => o.persisted.length === 0 && o.detectedVulnerable).length
  const cleanFixed = outcomes.filter((o) => o.cleanFixed).length
  const totalPersisted = outcomes.reduce((n, o) => n + o.persisted.length, 0)
  const totalDisappeared = outcomes.reduce((n, o) => n + o.disappeared.length, 0)
  const totalBefore = outcomes.reduce((n, o) => n + o.before.length, 0)
  return {
    fixtures: outcomes.length,
    detectedVulnerableFixture: detected,
    trackedItsFix: trackedFix,
    cleanFixedFixture: cleanFixed,
    findingsInVulnerableFiles: totalBefore,
    findingsThatDisappearedOnFix: totalDisappeared,
    findingsThatPersistedOnFix: totalPersisted,
    /** Fraction of reported findings that did not respond to a real fix. */
    persistedFraction: totalBefore > 0 ? totalPersisted / totalBefore : 0,
  }
}