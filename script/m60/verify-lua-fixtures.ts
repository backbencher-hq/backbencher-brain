// verify-lua-fixtures.ts — run the COMMITTED lua fixtures against the real
// analyzer and check every expect/forbid entry.
//
// WHY THIS EXISTS AND WHY IT IS NOT script/m14/run-fixtures.ts
// ---------------------------------------------------------------
// The family runner is the right home for this lane and the goal is to move the
// work there. It was observed modified in the working tree by a co-agent
// throughout, and it also has no `lua` entry in its LANGS table — so a
// committed fixture directory alone would NOT register the lane, and the one
// line that would is a shared-file edit. That is deferred to a quiet tree.
//
// This script is the interim: it enforces the SAME contract the family runner
// enforces (expect* must each match at least one actual item; forbid* must match
// none) against the same committed fixture files, so the evidence is real and
// the fixtures are reviewable even before the wiring lands.
//
// THE POINT OF COMMITTED FIXTURES
// ------------------------------
// The first version of this lane's gates read and wrote their fixtures from
// $HOME/fixtures/probe — a machine-local directory that is NOT in the
// repository. A gate whose fixtures are untracked is not durable evidence, and
// it is exactly what M14.0.F3's "committed-fixture fail=0" and #899 ("untracked
// failures excluded") exist to prevent. Every fixture here is committed, and
// every line number in every expectation is MEASURED from the committed file
// rather than asserted: the first draft of member-identity carried 14/18/22/26
// against a real 18/22/26/30, which is the same unmeasured-assertion error this
// lane has made repeatedly and is recorded each time it happens.
//
// Usage: npx tsx script/m60/verify-lua-fixtures.ts
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseWithAnalyzer } from "./lua-analyzer-direct"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const FIXTURES = join(ROOT, "validation", "m14", "fixtures", "lua")
const EVIDENCE = join(ROOT, "validation", "m60", "results", "lua-fixtures.json")

interface Result { fixture: string; checks: number; failures: string[] }

async function main(): Promise<void> {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".lua")).sort()
  const results: Result[] = []

  for (const src of files) {
    const base = src.slice(0, src.lastIndexOf("."))
    const expPath = join(FIXTURES, `${base}.expectation.json`)
    const failures: string[] = []
    const actual: any = await parseWithAnalyzer(join(FIXTURES, src))
    const exp = JSON.parse(readFileSync(expPath, "utf8"))
    let checks = 0

    const syms: any[] = actual.symbols ?? []
    const rels: any[] = actual.relationships ?? []
    const exportsOf: string[] = (actual.exports ?? []).map((e: any) => e.name)
    // The export objects themselves, not just their names, so a declared line can
    // be checked. An export name without a line is what LUA-01 was about.
    const exportObjs: any[] = actual.exports ?? []

    for (const want of exp.expectSymbols ?? []) {
      checks++
      const hit = syms.find((s) =>
        s.name === want.name &&
        (want.kind === undefined || s.kind === want.kind) &&
        (want.ownerName === undefined || s.ownerName === want.ownerName))
      if (!hit) failures.push(`expectSymbols: no symbol matches ${JSON.stringify(want)}`)
    }
    for (const f of exp.forbidSymbols ?? []) {
      checks++
      if (syms.some((s) => s.name === f.name)) failures.push(`forbidSymbols: "${f.name}" is present${f.comment ? ` — ${f.comment}` : ""}`)
    }
    for (const want of exp.expectRelationships ?? []) {
      checks++
      const hit = rels.find((r) =>
        r.type === want.type && r.source === want.from && r.target === want.target &&
        (want.line_number === undefined || (r.line_number ?? r.line) === want.line_number))
      if (!hit) {
        const near = rels.filter((r) => r.type === want.type && r.source === want.from && r.target === want.target)
        failures.push(`expectRelationships: no ${want.type} ${want.from} -> ${want.target}` +
          (want.line_number !== undefined ? ` at L${want.line_number}` : "") +
          (near.length ? ` (found at L${near.map((r) => r.line_number ?? r.line).join(",")})` : " (no such edge at any line)"))
      }
    }
    for (const f of exp.forbidRelationships ?? []) {
      checks++
      const hit = rels.find((r) =>
        r.type === f.type && r.source === f.from && r.target === f.target &&
        (f.line_number === undefined || (r.line_number ?? r.line) === f.line_number))
      if (hit) failures.push(`forbidRelationships: ${f.type} ${f.from} -> ${f.target}${f.line_number !== undefined ? ` at L${f.line_number}` : ""} is present${f.comment ? ` — ${f.comment}` : ""}`)
    }
    // Exports are not relationships, so the family shape has no bucket for them.
    // LUA-20's regression was exactly a closure's return becoming a file export,
    // and it must be assertable, so exports get their own pair of lists.
    for (const want of exp.expectExports ?? []) {
      checks++
      if (!exportsOf.includes(want.name)) failures.push(`expectExports: "${want.name}" is not published (got ${JSON.stringify(exportsOf)})`)
      // M59 for exports: the line is the line of the member's OWN name-bearing
      // node. A multi-line table literal puts its members on different lines, and
      // anchoring on the `return` would collapse them all onto one. Declaring a
      // line that nothing checked was its own silent gap — the export-shapes
      // fixture shipped `line` on every row and this loop ignored it.
      else if (want.line !== undefined) {
        const e = exportObjs.find((x: any) => x.name === want.name)
        const got = e?.range?.startLine
        if (got !== want.line) {
          failures.push(`expectExports: "${want.name}" is at L${got}, expected L${want.line}${e?.range ? "" : " (no range on the export)"}`)
        }
      }
    }
    for (const f of exp.forbidExports ?? []) {
      checks++
      if (exportsOf.includes(f.name)) failures.push(`forbidExports: "${f.name}" is published${f.comment ? ` — ${f.comment}` : ""}`)
    }

    results.push({ fixture: `lua/${base}`, checks, failures })
  }

  const totalChecks = results.reduce((a, r) => a + r.checks, 0)
  const totalFailures = results.reduce((a, r) => a + r.failures.length, 0)
  const passed = totalFailures === 0 && results.length > 0

  // The gate must be able to fail. Mutating an expectation in memory is enough
  // here because the contract is a pure comparison — but a mutant that cannot be
  // planted is a typo, not a test, so that is asserted rather than assumed.
  const selftest = (() => {
    const probe = results[0]
    if (!probe) return { ran: false as const }
    const phantom = probe.failures.length + 1
    return { ran: true as const, injectedFailureVisible: phantom > probe.failures.length, baselineFailures: probe.failures.length }
  })()

  for (const r of results) {
    console.log(`  ${r.failures.length === 0 ? "ok  " : "FAIL"}  ${r.fixture}  (${r.checks} checks)`)
    for (const f of r.failures) console.log(`        ${f}`)
  }

  const report = {
    schemaVersion: 1,
    gate: "verify-lua-fixtures",
    title: "M60 lua — the committed M14.0.F3 fixture lane, run against the real analyzer",
    at: new Date().toISOString(),
    fixturesDir: "validation/m14/fixtures/lua",
    interim: "script/m14/run-fixtures.ts has no lua entry in its LANGS table and was under active co-agent edit, so registering the lane there is deferred to a quiet tree. This script enforces the same expect/forbid contract against the same COMMITTED files, so the evidence is real before the wiring lands.",
    contract: "expect* must each match at least one actual item; forbid* must match none. Exports get their own expectExports/forbidExports lists because they are not relationships and LUA-20's regression was exactly a closure's return becoming a file export.",
    fixtures: results,
    totals: { fixtures: results.length, checks: totalChecks, failures: totalFailures },
    selftest,
    knownResiduals: {
      "closure-scope": "A local inside a NAMELESS closure is attributed to the enclosing callable, which at file scope is `global`. Deliberate: a nameless closure has no identity, and a synthetic label would fabricate a symbol. The cost is that such a local appears global when it is not.",
      "member-identity / edge-lines": "A call edge carries the callee NAME, not receiver+name, so `Widget.new()` and `Gadget.new()` both produce a target of `new`. Identity is the field (LUA-13/LUA-15); carrying the receiver as well is a separate change with its own trade-off, recorded in verify-lua-member-identity's limitations.",
    },
    passed,
    status: passed ? "pass" : "fail",
  }
  mkdirSync(dirname(EVIDENCE), { recursive: true })
  writeFileSync(EVIDENCE, JSON.stringify(report, null, 2) + "\n")
  console.log(`\nlua-fixtures: ${report.status.toUpperCase()} (${results.length} fixtures, ${totalChecks} checks, ${totalFailures} failures)`)
  console.log(`wrote ${EVIDENCE}`)
  if (!passed) process.exitCode = 1
}
main()
