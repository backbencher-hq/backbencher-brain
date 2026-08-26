/**
 * M14.0.SPEC — Grammar-derived completeness inventory (#419, java pilot)
 *
 * The completeness half of the honesty system: gates verify what EXISTS;
 * this verifies that EVERYTHING THE GRAMMAR DECLARES is classified — nothing
 * may be silently absent. Every public named node type in the pinned
 * tree-sitter-java wasm must appear in exactly one bucket of
 * script/m14/spec/java-completeness.json:
 *
 *   - handled_verified : the analyzer emits correctly (probe/fixture-confirmed)
 *   - internal_silent  : container/literal/keyword correctly emitting nothing
 *   - gap              : confirmed missing emission, numbered G1.. (work items)
 *   - design_decision  : owner ruling pending (G5/G6/S1), never silent absence
 *
 * Gate rules (silence is guilt):
 *   1. A node type in NO bucket = failure (the inventory is incomplete).
 *   2. A node type the wasm no longer produces = stale row, reported.
 *   3. An open gap is a tracked work item, NOT a gate failure — the gate
 *      fails when a gap exists but is not declared in the classification.
 *
 * Per the ledger's "#419 section definition", a language closes #419 only
 * when ALL eight mandatory judgments are machine-verified on committed
 * artifacts. This script verifies each section for java and emits the
 * per-section checks into M14.0.SPEC evidence:
 *
 *   A. Structural completeness  — every grammar node type classified (below)
 *   B. Every relationship kind  — all 11 kinds pinned by >=1 java fixture
 *      (calls, extends, implements, instantiates, uses, references,
 *      contains, overrides, exports, imports, permits — Matrix 1c taxonomy
 *      + permits; imports pinned via meta.isJavaImport, permits via
 *      meta.relationshipType)
 *   C. Payload matrix           — Matrix 1b rows for java all pinned
 *      (qualified_calls, docstrings, complexity, typeParameters, visibility,
 *      apiContract)
 *   D. Evidence tiers           — >=2 distinct evidenceClass values pinned by
 *      fixtures (structural, reference_qualified, ...)
 *   E. Corpus differential      — differential-java check in M14.0.F5.json
 *      passes at the grails-core floor (coverage 100%, unexplained 0%)
 *   F. Perf budget              — avgMsPerFile recorded in
 *      differential-baseline.json (grails-core:java); the F9 gate enforces
 *      the budget, this records it
 *   G. Docs truthful            — docs/analyzers/java.md +
 *      real-java-analyzer.md exist
 *   H. Cross-language           — M14.CC1.json evidence exists, all checks pass
 *
 * CLI:
 *   bun run script/m14/completeness-inventory.ts          # verify + emit evidence
 *   bun run script/m14/completeness-inventory.ts --list   # print the gap list only
 */
import fs from "fs"
import path from "path"

const ROOT = process.cwd()
const WASM = path.join(ROOT, "wasm", "tree-sitter-java.wasm")
const SPEC = path.join(ROOT, "script", "m14", "spec", "java-completeness.json")
const FIXTURES = path.join(ROOT, "validation", "m14", "fixtures", "java")
const RESULTS = path.join(ROOT, "validation", "m14", "results")
const BASELINE = path.join(ROOT, "validation", "m14", "differential-baseline.json")

const REQUIRED_KINDS = ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports", "permits"]
const REQUIRED_PAYLOADS: Record<string, { key: string; pin: string }> = {
  qualified_calls: { key: "expectQualifiedCalls", pin: "java/qualified-call-path" },
  docstrings: { key: "expectComments", pin: "java/javadoc-payload" },
  complexity: { key: "expectComplexity", pin: "java/method-complexity-payload" },
  typeParameters: { key: "expectTypeParameters", pin: "java/generic-parameters-payload" },
  visibility: { key: "expectVisibility", pin: "java/generic-visibility-payload" },
  apiContract: { key: "expectApiContractPaths", pin: "java/fq-api-endpoint" },
  parameters: { key: "expectParameters", pin: "java/parameters-payload" },
}

async function loadNamedNodeTypes(): Promise<string[]> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(WASM))
  const named: string[] = []
  for (let i = 0; i < g.nodeTypeCount; i++) {
    if (!g.nodeTypeIsNamed(i)) continue
    const n = g.nodeTypeForId(i)
    if (n && !n.startsWith("_")) named.push(n)
  }
  return named
}

function loadSpec() {
  const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"))
  const handled = new Set(spec.handled_verified.types)
  const silent = new Set(spec.internal_silent.types)
  const gapTypes = new Set<string>()
  for (const g of spec.gap.gaps) {
    for (const t of g.node_type.split(",")) gapTypes.add(t.trim())
  }
  const decisionTypes = new Set<string>()
  for (const d of spec.design_decision.decisions) {
    for (const t of d.node_type.split(",")) decisionTypes.add(t.trim())
  }
  return { spec, handled, silent, gapTypes, decisionTypes }
}

interface SectionCheck { id: string; description: string; status: "pass" | "fail"; detail?: string }

function readExpectations(): any[] {
  if (!fs.existsSync(FIXTURES)) return []
  return fs.readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".expectation.json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, f), "utf8")))
}

function verifySectionB(): SectionCheck {
  const pinned = new Set<string>()
  for (const exp of readExpectations()) {
    for (const rel of exp.expectRelationships ?? []) {
      if (typeof rel.type === "string") pinned.add(rel.type)
      if (rel["meta.relationshipType"]) pinned.add(rel["meta.relationshipType"])
      if (rel["meta.isJavaImport"]) pinned.add("imports")
    }
  }
  const unpinned = REQUIRED_KINDS.filter((k) => !pinned.has(k))
  return {
    id: "section-b-relationship-kinds",
    description: `${REQUIRED_KINDS.length} relationship kinds pinned by java fixtures`,
    status: unpinned.length ? "fail" : "pass",
    detail: unpinned.length ? `unpinned: ${unpinned.join(", ")}` : `pinned: ${[...pinned].sort().join(", ")}`,
  }
}

function verifySectionC(): SectionCheck {
  const exps = readExpectations()
  const missing: string[] = []
  for (const [payload, { key, pin }] of Object.entries(REQUIRED_PAYLOADS)) {
    if (!exps.some((e) => Array.isArray(e[key]) && e[key].length > 0)) missing.push(`${payload} (${pin})`)
  }
  return {
    id: "section-c-payload-matrix",
    description: `Matrix 1b payload rows pinned (${Object.keys(REQUIRED_PAYLOADS).length})`,
    status: missing.length ? "fail" : "pass",
    detail: missing.length ? `missing pins: ${missing.join(", ")}` : Object.keys(REQUIRED_PAYLOADS).join(", "),
  }
}

function verifySectionD(): SectionCheck {
  const tiers = new Set<string>()
  for (const exp of readExpectations()) {
    for (const rel of exp.expectRelationships ?? []) {
      if (rel["meta.evidenceClass"]) tiers.add(rel["meta.evidenceClass"])
    }
  }
  return {
    id: "section-d-evidence-tiers",
    description: ">=2 distinct evidenceClass values pinned by fixtures",
    status: tiers.size >= 2 ? "pass" : "fail",
    detail: `${tiers.size} tier(s) pinned: ${[...tiers].sort().join(", ")}`,
  }
}

function verifySectionE(): SectionCheck {
  const p = path.join(RESULTS, "M14.0.F5.json")
  if (!fs.existsSync(p)) return { id: "section-e-differential", description: "differential evidence (M14.0.F5.json) exists", status: "fail", detail: "missing M14.0.F5.json" }
  const ev = JSON.parse(fs.readFileSync(p, "utf8"))
  const check = (ev.checks ?? []).find((c: any) => c.id === "differential-java")
  if (!check) return { id: "section-e-differential", description: "differential-java check present", status: "fail", detail: "no differential-java check in M14.0.F5.json" }
  const ok = check.status === "pass" && /coverage 100%/.test(check.detail ?? "") && /unexplained 0%/.test(check.detail ?? "")
  return {
    id: "section-e-differential",
    description: "differential-java at grails-core floor (coverage 100%, unexplained 0%)",
    status: ok ? "pass" : "fail",
    detail: check.detail ?? String(check.status),
  }
}

function verifySectionF(): SectionCheck {
  if (!fs.existsSync(BASELINE)) return { id: "section-f-perf-budget", description: "perf budget recorded in differential-baseline.json", status: "fail", detail: "missing differential-baseline.json" }
  const b = JSON.parse(fs.readFileSync(BASELINE, "utf8"))
  const avg = b?.counts?.["grails-core:java"]?.perf?.avgMsPerFile
  return {
    id: "section-f-perf-budget",
    description: "java avgMsPerFile recorded (F9 gate enforces budget)",
    status: typeof avg === "number" && avg > 0 ? "pass" : "fail",
    detail: typeof avg === "number" && avg > 0 ? `grails-core:java ${avg} ms/file` : "no avgMsPerFile for grails-core:java",
  }
}

function verifySectionG(): SectionCheck {
  const docs = ["docs/analyzers/java.md", "docs/analyzers/real-java-analyzer.md"]
  const missing = docs.filter((d) => !fs.existsSync(path.join(ROOT, d)))
  return {
    id: "section-g-docs",
    description: "java analyzer docs present and committed",
    status: missing.length ? "fail" : "pass",
    detail: missing.length ? `missing: ${missing.join(", ")}` : docs.join(", "),
  }
}

function verifySectionH(): SectionCheck {
  const p = path.join(RESULTS, "M14.CC1.json")
  if (!fs.existsSync(p)) return { id: "section-h-cross-language", description: "cross-language consistency evidence (M14.CC1.json) exists", status: "fail", detail: "missing M14.CC1.json" }
  const ev = JSON.parse(fs.readFileSync(p, "utf8"))
  const checks: any[] = ev.checks ?? []
  const bad = checks.filter((c) => c.status !== "pass")
  return {
    id: "section-h-cross-language",
    description: "cross-language consistency checks all pass",
    status: bad.length === 0 && checks.length > 0 ? "pass" : "fail",
    detail: bad.length ? `failing: ${bad.map((c) => c.id).join(", ")}` : `${checks.length} checks pass`,
  }
}

async function run() {
  const types = await loadNamedNodeTypes()
  const { spec, handled, silent, gapTypes, decisionTypes } = loadSpec()

  const classified = (t: string) => handled.has(t) || silent.has(t) || gapTypes.has(t) || decisionTypes.has(t)
  const unclassified = types.filter((t) => !classified(t))
  const staleRows = [...handled, ...silent].filter((t) => !types.includes(t))

  const listOnly = process.argv.includes("--list")

  if (listOnly) {
    console.log(`java grammar: ${types.length} public named node types`)
    console.log(`handled_verified: ${handled.size} | internal_silent: ${silent.size} | gaps: ${spec.gap.gaps.length} | design decisions: ${spec.design_decision.decisions.length}`)
    console.log("\n=== NUMBERED GAP LIST ===")
    for (const g of spec.gap.gaps) {
      console.log(`  ${g.id}: [${g.severity}] ${g.node_type} — ${g.missing}`)
    }
    console.log("\n=== PENDING OWNER DECISIONS ===")
    for (const d of spec.design_decision.decisions) {
      console.log(`  ${d.id}: ${d.question.slice(0, 120)}`)
    }
    return
  }

  let failures = 0
  if (unclassified.length > 0) {
    failures++
    console.error(`COMPLETENESS FAIL: ${unclassified.length} node type(s) in NO bucket: ${unclassified.join(", ")}`)
  }
  if (staleRows.length > 0) {
    failures++
    console.error(`COMPLETENESS FAIL: ${staleRows.length} classified row(s) no longer produced by the wasm (grammar drift?): ${staleRows.join(", ")}`)
  }

  const sectionChecks: SectionCheck[] = [
    {
      id: "section-a-structural",
      description: "every named node type classified (143)",
      status: unclassified.length === 0 ? "pass" : "fail",
      detail: `${types.length} types, ${handled.size} handled, ${silent.size} silent, ${spec.gap.gaps.length} gaps, ${spec.design_decision.decisions.length} decisions`,
    },
    verifySectionB(),
    verifySectionC(),
    verifySectionD(),
    verifySectionE(),
    verifySectionF(),
    verifySectionG(),
    verifySectionH(),
  ]
  const sectionFails = sectionChecks.filter((c) => c.status !== "pass")
  if (sectionFails.length > 0) {
    failures++
    for (const c of sectionFails) console.error(`SECTION FAIL: ${c.id} — ${c.detail}`)
  }
  if (failures > 0) process.exit(1)

  // Emit evidence (machine-generated; never hand-edited)
  const { emitEvidence } = await import("./evidence-harness")
  const gapList = spec.gap.gaps.map((g: any) => `${g.id}: ${g.missing}`)
  const ruled = spec.design_decision.decisions.filter((d: any) => d.status === "RULED")
  const pending = spec.design_decision.decisions.filter((d: any) => d.status !== "RULED")
  emitEvidence({
    issueId: "M14.0.SPEC",
    title: "Completeness spec — java pilot (#419), A–H sections",
    claimLevel: "L2",
    layers: ["completeness"],
    checks: [
      { id: "inventory-fully-classified", description: "every named node type classified", status: "pass" },
      { id: "gap-list-present", description: `${spec.gap.gaps.length} confirmed gaps declared`, status: "pass" },
      { id: "design-decisions-tracked", description: `${ruled.length} ruled, ${pending.length} pending owner`, status: "pass" },
      ...sectionChecks,
    ],
    limitations: [
      { description: `classified against pinned tree-sitter-java wasm (${types.length} public named types); grammar drift re-validates on every run` },
      { description: "gaps G1-G4 probe-verified on synthetic fixtures and closed with fixture-gated fixes (2026-08-26)" },
      { description: "G5/G6/S1 ruled by owner 2026-08-26: declared out of scope / declared limitation / spec-table corrected" },
      { description: "B-section imports pin added 2026-08-26 (java/import-edges + mutant java/drop-import-edges): static-import isStatic flag added to edge metadata; sections A-H verified mechanically on committed artifacts" },
    ],
    data: {
      nodeTypeCount: types.length,
      handledVerified: handled.size,
      internalSilent: silent.size,
      gaps: gapList,
      ruledDecisions: ruled.map((d: any) => d.id),
      pendingDecisions: pending.map((d: any) => d.id),
      sections: Object.fromEntries(sectionChecks.map((c) => [c.id, { status: c.status, detail: c.detail ?? "" }])),
    },
  })
  console.log(`inventory OK: ${types.length} types classified; sections A-H: ${sectionChecks.length - sectionFails.length}/${sectionChecks.length} pass`)
}

run().catch((e) => { console.error(e); process.exit(1) })
