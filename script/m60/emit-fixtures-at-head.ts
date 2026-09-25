// script/m60/emit-fixtures-at-head.ts — regenerate M60's fixture input.
//
// WHY THIS EXISTS: `validation/m60/results/fixtures-at-head.json` is the artifact
// the language-completion matrix prefers for its `fixtures` cell (it carries the
// #899 committed-vs-in-flight split). It was first assembled BY HAND from a run
// log, which means it could only rot: the c row kept saying `7/7 committed` while
// the F3 artifact in the same tree said `9/9`, and nothing could tell which was
// stale. A hand-built evidence file is a claim nobody can re-derive.
//
// This script re-derives it from the canonical runner's own log, with the same
// #899 rule the matrix documents: a failing fixture whose expectation file is NOT
// tracked by git is in-flight lane work, not milestone evidence.
//
// Run:
//   bun script/m14/run-fixtures.ts > /tmp/fixtures.log 2>&1
//   npx tsx script/m60/emit-fixtures-at-head.ts [--log <path>] [--commit <sha>]
//
// Default log: /tmp/fixtures.log (the runner's conventional landing spot).
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const OUT = path.join(ROOT, "validation", "m60", "results", "fixtures-at-head.json")

const argOf = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const LOG = argOf("--log") ?? process.env.BB_FIXTURES_LOG ?? "/tmp/fixtures.log"

if (!fs.existsSync(LOG)) {
  console.error(`emit-fixtures-at-head: no log at ${LOG} — run script/m14/run-fixtures.ts first (or pass --log)`)
  process.exit(2)
}
const raw = fs.readFileSync(LOG, "utf8")

// The runner prints `PASS  <lang>/<fixture-slug>` and `FAIL  <lang>/<fixture-slug>`
// once per fixture, and a single `summary: {...}` JSON line. Both are parsed rather
// than recomputed, so this file can never disagree with the log it names.
//
// PASSES ARE PARSED TOO, and that is the second half of the #899 rule. The runner's
// own `summary` counts EVERY fixture on disk, so a lane whose author has added a
// fixture but not committed it reads one fixture higher than it has evidence for —
// and the field is read downstream as "<pass>/<pass> COMMITTED" (the matrix's
// fixtures note), so the overcount is a claim, not a detail. Excluding only untracked
// FAILURES keeps the loud half of the rule and drops the quiet half: an in-flight
// fixture that PASSES is the one that silently inflates a lane. So the run set is
// reconstructed from the log and split by `git ls-files`, and the split is
// CROSS-CHECKED against the runner's own total — if the log ever stops printing one
// line per fixture, the counts would shrink silently, and this refuses instead.
// The excluded fixtures are DISCLOSED in `untrackedFixtures`, never dropped: an
// artifact that quietly forgets in-flight work is how a lane's real count gets lost.
const slugOf = (kind: string) =>
  [...raw.matchAll(new RegExp(`^${kind} {2}([a-z0-9_]+)\\/([a-z0-9._-]+)\\s*$`, "gim"))].map((m) => `${m[1]}/${m[2]}`)
const passSlugs = slugOf("PASS")
const failSlugs = slugOf("FAIL")
const runSlugs = [...passSlugs, ...failSlugs]
const summaryLine = raw.split("\n").find((l) => l.trimStart().startsWith("summary: "))
if (!summaryLine) {
  console.error("emit-fixtures-at-head: the log carries no `summary: {...}` line — is this a run-fixtures.ts log?")
  process.exit(2)
}
const runnerSummary = JSON.parse(summaryLine.slice(summaryLine.indexOf("{"))) as Record<
  string,
  { pass: number; fail: number }
>
const runnerTotal = Object.values(runnerSummary).reduce((n, v) => n + v.pass + v.fail, 0)
if (runSlugs.length !== runnerTotal) {
  console.error(
    `emit-fixtures-at-head: the log yields ${runSlugs.length} per-fixture lines but its summary totals ${runnerTotal}. ` +
      `The per-fixture split would be derived from an incomplete run set, so nothing is written.`,
  )
  process.exit(2)
}

// #899: committed = the expectation file is tracked at HEAD. A fixture can be
// failing *and* committed (a real, pinned defect) — that is the case the matrix
// must see; an untracked expectation is in-flight lane work.
const isCommitted = (slug: string): boolean => {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", `validation/m14/fixtures/${slug}.expectation.json`], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return true
  } catch {
    return false
  }
}

const failures = failSlugs.map((slug) => ({ fixture: slug, committed: isCommitted(slug) }))
const countBy = (pred: (f: (typeof failures)[number]) => boolean): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const f of failures) {
    if (!pred(f)) continue
    const lang = f.fixture.split("/")[0]
    out[lang] = (out[lang] ?? 0) + 1
  }
  return out
}

// The committed half of the run, keyed by the runner's own language order so the
// artifact's shape does not churn when this changes: a re-emitted file should differ
// in the numbers that moved, not in the order of its keys.
const langOf = (slug: string) => slug.split("/")[0]
const committedRun = runSlugs.filter(isCommitted)
const inFlightRun = runSlugs.filter((s) => !isCommitted(s))
const committedSet = new Set(committedRun)
const countLang = (slugs: string[]): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const s of slugs) out[langOf(s)] = (out[langOf(s)] ?? 0) + 1
  return out
}
const committedPass = countLang(passSlugs.filter((s) => committedSet.has(s)))
const committedFail = countLang(failSlugs.filter((s) => committedSet.has(s)))
const summary: Record<string, { pass: number; fail: number }> = {}
for (const lang of Object.keys(runnerSummary)) summary[lang] = { pass: committedPass[lang] ?? 0, fail: committedFail[lang] ?? 0 }
const untrackedFixtures = countLang(inFlightRun)

const commit =
  argOf("--commit") ??
  (() => {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
    } catch {
      return null
    }
  })()

const artifact = {
  at: new Date().toISOString(),
  source: `script/m14/run-fixtures.ts (canonical, all lanes) — log ${LOG}`,
  commit,
  rawLog: LOG,
  summary,
  untrackedFixtures,
  runnerTotal,
  totalFailures: failures.length,
  committedFixtureFailures: countBy((f) => f.committed),
  untrackedFixtureFailures: countBy((f) => !f.committed),
  failures,
  rule: "COMMITTED evidence only: `summary` counts the fixtures whose expectation file is tracked by git at the time of the run, and every untracked (in-flight) fixture is disclosed in `untrackedFixtures` instead of counted (#899 — a failing fixture whose expectation file is not tracked is in-flight lane work, not milestone evidence; the same applies to a passing one, which is the count a reader would otherwise mistake for stable)",
}

fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
console.log(
  `emit-fixtures-at-head: ${committedRun.length}/${runSlugs.length} fixture(s) committed ` +
    `(in-flight excluded: ${JSON.stringify(untrackedFixtures)}) — ${failures.length} failure(s), ` +
    `committed ${JSON.stringify(artifact.committedFixtureFailures)}, in-flight ${JSON.stringify(artifact.untrackedFixtureFailures)} ` +
    `→ validation/m60/results/fixtures-at-head.json @ ${String(commit).slice(0, 8)}`,
)
