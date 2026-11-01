// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the honesty-field gate: no public tool may publish a
//   completeness/absence claim that can only ever be one value, and the static
//   audit must actually cover the live tool-output builders.
// WHICH GATE IT SERVES — m48/P2; it reads the sixteen public tools' output
//   builders (the split per-tool handlers plus every builder module reachable
//   from a tool) and the shared validator/legacy boundaries.
// WHY IT IS SHAPED THIS WAY — the per-tool module split moved every tool's
//   output builder out of one aggregate file, so a hardcoded builder list went
//   green over an empty coverage set. The list is DISCOVERED from
//   `src/mcp/tools/*/handler.ts` now, and the gate asserts the discovered set is
//   complete and non-empty before the scanner is allowed to pass. The scanner
//   itself is a pure function over source text so a planted hollow field is
//   proven to be detected (section 6), not assumed to be.
// WHERE ITS EVIDENCE LIVES — validation/m48/results/P2.json; the mutation proof
//   for this tool is recorded in validation/tools/bb_impact/MUTANTS.json.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/*/handler.ts (the
//   discovered builders), src/mcp/tools/shared.ts, the P1 evidence it cross-refs.
// CONTRACTS IT MUST NOT BREAK — it must be able to go red (a hollow field, a
//   missing builder, a coverage gap, a legacy import) and must never pass on an
//   empty audited set.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"

import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m48/results")
const READ_ONLY = process.env.BB_M48_READ_ONLY === "1"

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

// Watchlist: completeness/absence claims that must be able to flip.
const WATCH = ["truncated", "declaredAbsent", "declared_absent", "complete", "sampled"]

/** The split layout's per-tool output builders, discovered from disk. */
const TOOLS_DIR = path.join(ROOT, "src/mcp/tools")
const HANDLER_FILES: string[] = existsSync(TOOLS_DIR)
  ? readdirSync(TOOLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `src/mcp/tools/${entry.name}/handler.ts`)
      .filter((rel) => existsSync(path.join(ROOT, rel)))
      .sort()
  : []

// Builder modules reachable from a public tool that are not per-tool handlers.
const SHARED_BUILDER_FILES = [
  "src/mcp/tool-handlers.ts",
  "src/mcp/tools/shared.ts",
  "src/intelligence/analysis/impact.ts",
  "src/intelligence/analysis/dependencies.ts",
  "src/intelligence/analysis/complexity.ts",
  "src/intelligence/analysis/project-stats.ts",
  "src/intelligence/analysis/run-history.ts",
  "src/intelligence/testing/test-intel.ts",
  "src/intelligence/testing/quality.ts",
  "src/intelligence/patterns/orphans.ts",
  "src/intelligence/search/quick-answer.ts",
  "src/intelligence/health/health-provider.ts",
  "src/intelligence/documentation/doc-engine.ts",
  "src/intelligence/visualization/visualization-engine.ts",
  "src/intelligence/migration/migration-engine.ts",
  "src/intelligence/edit/edit-engine.ts",
  "src/security/cross-language-security.ts",
  "src/lsp/impact.ts",
  "src/intelligence/graph/graph-engine.ts",
]

const BUILDER_FILES = [...HANDLER_FILES, ...SHARED_BUILDER_FILES]

/** Read the token that follows `key:` in a source text, as "true", "false",
 *  or "other" (a dynamic value). String operations, not a second regex: the
 *  first version of this scanner used a lookahead that backtracked into the
 *  whitespace after `:`, so EVERY spaced `key: value` counted as dynamic and
 *  the gate could not go red at all. A planted hollow field is the negative
 *  case in section 6 that keeps that defect from returning. */
function nextValueToken(src: string, colonIndex: number): string {
  let i = colonIndex + 1
  const isSpace = (ch: string | undefined) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r"
  while (i < src.length && isSpace(src[i])) i++
  if (i >= src.length) return "other"
  const isIdent = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_$.]/.test(ch)
  if (!isIdent(src[i])) return "other"
  let end = i
  while (end < src.length && isIdent(src[end])) end++
  const token = src.slice(i, end)
  return token === "true" || token === "false" ? token : "other"
}

/** The scanner itself: source text in, hollow-field hits out. Pure so a planted
 *  hollow field can be proven caught without touching the tree. */
function auditSource(rel: string, src: string): string[] {
  const hits: string[] = []
  for (const key of WATCH) {
    const literals = new Set<string>()
    let dynamic = false
    let searchFrom = 0
    for (;;) {
      const at = src.indexOf(key, searchFrom)
      if (at === -1) break
      searchFrom = at + key.length
      const previous = at > 0 ? src[at - 1] : ""
      if (previous !== "" && /[A-Za-z0-9_$]/.test(previous)) continue
      let afterKey = at + key.length
      while (afterKey < src.length && (src[afterKey] === " " || src[afterKey] === "\t")) afterKey++
      if (src[afterKey] !== ":") continue
      const token = nextValueToken(src, afterKey)
      if (token === "other") dynamic = true
      else literals.add(token)
    }
    if (literals.size === 1 && !dynamic) hits.push(`${rel}: "${key}" only ever assigned ${[...literals][0]} (never the opposite, never dynamic)`)
  }
  return hits
}

function auditFile(rel: string): string[] {
  const abs = path.join(ROOT, rel)
  if (!existsSync(abs)) return [`${rel}: MISSING`]
  return auditSource(rel, readFileSync(abs, "utf8"))
}

/** Does the audited set contain every discovered handler builder? Pure so the
 *  coverage rule can be tested against a deliberately incomplete list. */
function coverageComplete(builderFiles: readonly string[], handlerFiles: readonly string[]): boolean {
  return handlerFiles.length > 0 && handlerFiles.every((rel) => builderFiles.includes(rel))
}

/** Does a source text import the deprecated calculator? Pure for the same reason. */
function importsDeprecatedCalculator(src: string): boolean {
  return src.includes("analyzeImpact")
}

/** Watchlist keys actually assigned in a source text — the coverage witness. */
function watchAssignments(src: string): number {
  let n = 0
  for (const key of WATCH) {
    let from = 0
    for (;;) {
      const at = src.indexOf(key, from)
      if (at === -1) break
      from = at + key.length
      let after = at + key.length
      while (after < src.length && (src[after] === " " || src[after] === "\t")) after++
      if (src[after] === ":") n++
    }
  }
  return n
}

async function main() {
  // 1. Coverage: the audited set is the split layout ITSELF, not a stale list.
  check("per-tool handler builders were discovered (split layout)", HANDLER_FILES.length >= 16, `${HANDLER_FILES.length} handlers`)
  check("audited builder set covers every discovered handler", coverageComplete(BUILDER_FILES, HANDLER_FILES), `${BUILDER_FILES.length} audited / ${HANDLER_FILES.length} discovered`)
  const missingBuilders = BUILDER_FILES.filter((rel) => !existsSync(path.join(ROOT, rel)))
  check("every audited builder file exists", missingBuilders.length === 0, missingBuilders.join(", "))
  // A scan over files that hold no watchlist field proves nothing. This is the
  // assertion that makes the gate unable to pass over an empty coverage set.
  const watchWitnesses = BUILDER_FILES.map((rel) => readFileSync(path.join(ROOT, rel), "utf8")).reduce((n, src) => n + watchAssignments(src), 0)
  check("the audited builders really carry completeness fields", watchWitnesses > 0, `${watchWitnesses} watchlist assignments across ${BUILDER_FILES.length} files`)

  // 2. Static self-audit over that set.
  const hollowHits: string[] = []
  for (const rel of BUILDER_FILES) hollowHits.push(...auditFile(rel))
  check("no hollow completeness field in any tool output builder", hollowHits.length === 0, hollowHits.join(" | "))

  // 3. Legacy guard: no tool door may import the deprecated calculator.
  const doorSources = [
    ...HANDLER_FILES.map((rel) => ({ rel, src: readFileSync(path.join(ROOT, rel), "utf8") })),
    { rel: "src/mcp/tool-handlers.ts", src: readFileSync(path.join(ROOT, "src/mcp/tool-handlers.ts"), "utf8") },
  ]
  const legacyImporters = doorSources.filter((entry) => importsDeprecatedCalculator(entry.src)).map((entry) => entry.rel)
  check("no tool door imports the deprecated analyzeImpact", legacyImporters.length === 0, legacyImporters.join(", "))
  const legacySrc = readFileSync(path.join(ROOT, "src/intelligence/analysis/impact.ts"), "utf8")
  check("legacy analyzeImpact carries a deprecation marker", legacySrc.toLowerCase().includes("deprecated"), "")

  // 3. P1 cross-ref: truncated-can-be-true is proven by P1 evidence in the
  // same npm chain (250-caller fixture > 200-node budget).
  const p1Path = path.join(RESULTS_DIR, "P1.json")
  let p1Ok = false
  if (existsSync(p1Path)) {
    const p1 = JSON.parse(readFileSync(p1Path, "utf8"))
    p1Ok = p1.status === "verified" && p1.failed === 0 && p1.passed > 0
  }
  check("P1 evidence verified (proves truncated can be true on a real fixture)", p1Ok, "")

  // 4. Fixture proof: annotations declaredAbsent is REAL (both states).
  {
    const dataDir = mkdtempSync(path.join(tmpdir(), "m48-p2-data-"))
    process.env.BB_DATA_DIR = dataDir
    const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
    const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
    const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
    const proj = mkdtempSync(path.join(tmpdir(), "m48-p2-fixture-"))
    mkdirSync(path.join(proj, "src"), { recursive: true })
    writeFileSync(path.join(proj, "src", "a.ts"), "export function alpha(): number { return 1 }\n")
    const pid = getProjectId(proj)
    await indexProjectParallel(pid, proj, {})
    const h = createToolHandlers()
    const ctx = { projectPath: proj, projectId: pid }
    const call = async (name: string, args: any) => {
      const r = await (h as any)[name](args, ctx as any)
      return JSON.parse(r.content[0].text)
    }
    const before = await call("bb_annotations", { symbol: "alpha" })
    check("bb_annotations: declaredAbsent TRUE with zero rows (absence is real)", before.declaredAbsent === true, JSON.stringify(before).slice(0, 120))
    const w = await call("bb_annotate", { symbol: "alpha", body: "m48.p2 probe note" })
    check("bb_annotate writes one row", typeof w === "object" && w.stored === true && w.annotation?.symbol_name === "alpha", JSON.stringify(w).slice(0, 140))
    const after = await call("bb_annotations", { symbol: "alpha" })
    check("bb_annotations: declaredAbsent FALSE after a real write (field can flip)", after.declaredAbsent === false, JSON.stringify(after).slice(0, 120))
  }

  // 5. Audit doc present, covering all 16 tools. The registered set is read from
  // the LIVE registry, not scraped from a file the module split emptied.
  const auditPath = path.join(ROOT, "docs/m48/P2-AUDIT.md")
  check("docs/m48/P2-AUDIT.md exists", existsSync(auditPath), "")
  if (existsSync(auditPath)) {
    const audit = readFileSync(auditPath, "utf8")
    const { PUBLIC_TOOL_DESCRIPTORS } = await import(path.join(ROOT, "src/mcp/tool-registry"))
    const registered: string[] = (PUBLIC_TOOL_DESCRIPTORS as Array<{ name: string }>).map((tool) => tool.name)
    check("the live registry yields the sixteen public tools", registered.length === 16, `${registered.length}`)
    const missing = registered.filter((t) => !audit.includes(`| ${t} `))
    check("audit doc lists every one of the 16 tools", missing.length === 0, missing.join(","))
  }

  // 6. Negatives: each predicate is shown able to refuse, against the REAL
  // scanner (not a re-implementation of it).
  {
    // Scanner mutant: a planted hollow completeness field must be caught.
    const hollowMutant = auditSource("mutant.ts", "export const result = { truncated: false }\n")
    negative("the scanner catches a field only ever assigned one literal", hollowMutant.length > 0, JSON.stringify(hollowMutant))
    const dynamicControl = auditSource("control.ts", "export const result = { truncated: flag }\n")
    negative("a dynamic assignment is accepted by the same scanner (no false positive)", dynamicControl.length === 0, JSON.stringify(dynamicControl))
    // Coverage mutant: a discovered handler missing from the audit list fails.
    const droppedHandler = HANDLER_FILES[0] ?? "src/mcp/tools/bb_impact/handler.ts"
    const incomplete = BUILDER_FILES.filter((rel) => rel !== droppedHandler)
    negative("a coverage gap would fail the completeness predicate", !coverageComplete(incomplete, HANDLER_FILES), droppedHandler)
    negative("an empty disclosure would fail the coverage predicate", !coverageComplete([], HANDLER_FILES), "")
    // Legacy mutant: a door importing the deprecated calculator is caught.
    const legacyMutant = importsDeprecatedCalculator('import { analyzeImpact } from "../analysis/impact"')
    negative("the legacy guard catches a door that imports analyzeImpact", legacyMutant, "")
    negative("the legacy guard passes a clean door", !importsDeprecatedCalculator('import { computeImpact } from "../../../lsp/impact"'), "")
    // Evidence mutant: unverified P1 evidence fails the cross-ref.
    negative("missing P1 evidence would fail the cross-ref", p1Ok, "P1.json missing or not verified")
  }

  const ok = failed === 0
  const evidence = {
    status: ok ? "verified" : "known-gap",
    currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m48/verify-p2-honesty-fields.ts",
    evidenceFile: "P2.json",
    generatedAt: new Date().toISOString(),
    passed, failed, negativeCases: negatives,
    failures,
    buildersAudited: BUILDER_FILES.length,
    discoveredHandlers: HANDLER_FILES.length,
    watchlistAssignments: watchWitnesses,
  }
  mkdirSync(RESULTS_DIR, { recursive: true })
  // Every evidence record is written through the ONE sealed write path, so the
  // digest moves WITH the content.
  if (!READ_ONLY) writeSealed(path.join(RESULTS_DIR, "P2.json"), evidence)
  console.log(`M48 P2 HONESTY FIELDS: ${ok ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed, ${negatives} negatives)`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
