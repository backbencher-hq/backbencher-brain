/**
 * M14.0.SPEC — Grammar-derived completeness inventory (#419)
 *
 * The completeness half of the honesty system: gates verify what EXISTS;
 * this verifies that EVERYTHING THE GRAMMAR DECLARES is classified — nothing
 * may be silently absent. Every public named node type in the pinned
 * language wasm must appear in exactly one bucket of
 * script/m14/spec/<lang>-completeness.json:
 *
 *   - handled_verified : the analyzer emits correctly (probe/fixture-confirmed)
 *   - internal_silent  : container/literal/keyword correctly emitting nothing
 *   - gap              : confirmed missing emission, numbered G1.. (work items)
 *   - design_decision  : owner ruling pending, never silent absence
 *
 * Gate rules (silence is guilt):
 *   1. A node type in NO bucket = failure (the inventory is incomplete).
 *   2. A node type the wasm no longer produces = stale row, reported.
 *   3. An open gap is a tracked work item, NOT a gate failure — the gate
 *      fails when a gap exists but is not declared in the classification.
 *
 * Per the ledger's "#419 section definition", a language closes #419 only
 * when ALL eight mandatory judgments are machine-verified on committed
 * artifacts. This script verifies each section per language and emits the
 * per-section checks into M14.0.SPEC evidence:
 *
 *   A. Structural completeness  — every grammar node type classified
 *   B. Every relationship kind  — all kinds the language's taxonomy requires
 *      pinned by >=1 fixture (kinds the language never produces are declared
 *      decisions, e.g. groovy exports/permits)
 *   C. Payload matrix           — required Matrix 1b rows pinned
 *   D. Evidence tiers           — >=2 distinct evidenceClass values pinned
 *   E. Corpus differential      — <lang> check in M14.0.F5.json at its floor
 *   F. Perf budget              — avgMsPerFile recorded in
 *      differential-baseline.json (F9 gate enforces it, this records it)
 *   G. Docs truthful            — docs/analyzers/<lang>.md +
 *      real-<lang>-analyzer.md exist
 *   H. Cross-language           — M14.CC1.json evidence exists, all checks pass
 *
 * CLI:
 *   bun run script/m14/completeness-inventory.ts                # verify all GATED langs
 *   bun run script/m14/completeness-inventory.ts --lang groovy  # verify one lang
 *   bun run script/m14/completeness-inventory.ts --list --lang groovy  # gap list only
 */
import fs from "fs"
import path from "path"

const ROOT = process.cwd()
const RESULTS = path.join(ROOT, "validation", "m14", "results")
const BASELINE = path.join(ROOT, "validation", "m14", "differential-baseline.json")

interface LangConfig {
  id: string
  wasm: string
  classification: string
  fixturesDir: string
  docs: string[]
  differentialCheck: string
  perfKey: string
  requiredKinds: string[]
  payloads: Record<string, { key: string; pin: string }>
  title: string
}

const LANG_CONFIGS: Record<string, LangConfig> = {
  java: {
    id: "java",
    wasm: "tree-sitter-java.wasm",
    classification: "java-completeness.json",
    fixturesDir: "validation/m14/fixtures/java",
    docs: ["docs/analyzers/java.md", "docs/analyzers/real-java-analyzer.md"],
    differentialCheck: "differential-java",
    perfKey: "grails-core:java",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports", "permits"],
    payloads: {
      qualified_calls: { key: "expectQualifiedCalls", pin: "java/qualified-call-path" },
      docstrings: { key: "expectComments", pin: "java/javadoc-payload" },
      complexity: { key: "expectComplexity", pin: "java/method-complexity-payload" },
      typeParameters: { key: "expectTypeParameters", pin: "java/generic-parameters-payload" },
      visibility: { key: "expectVisibility", pin: "java/generic-visibility-payload" },
      apiContract: { key: "expectApiContractPaths", pin: "java/fq-api-endpoint" },
      parameters: { key: "expectParameters", pin: "java/parameters-payload" },
    },
    title: "java pilot (#419)",
  },
  groovy: {
    id: "groovy",
    wasm: "tree-sitter-groovy.wasm",
    classification: "groovy-completeness.json",
    fixturesDir: "validation/m14/fixtures/groovy",
    docs: ["docs/analyzers/groovy.md", "docs/analyzers/real-groovy-analyzer.md"],
    differentialCheck: "differential-groovy",
    perfKey: "grails-core:groovy",
    requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "imports"],
    payloads: {
      qualified_calls: { key: "expectQualifiedCalls", pin: "groovy/qualified-call-path" },
      docstrings: { key: "expectComments", pin: "groovy/groovydoc-payload" },
      complexity: { key: "expectComplexity", pin: "groovy/complexity-parity" },
      typeParameters: { key: "expectTypeParameters", pin: "groovy/generic-visibility-payload" },
      visibility: { key: "expectVisibility", pin: "groovy/generic-visibility-payload" },
      parameters: { key: "expectParameters", pin: "groovy/parameters-payload (wave)" },
    },
    title: "groovy pass (#419)",
  },
}

// Languages that have reached CONFORMANT and therefore run in npm run verify.
const GATED_LANGS = ["java", "groovy"]

async function loadNamedNodeTypes(cfg: LangConfig): Promise<string[]> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
  const named: string[] = []
  for (let i = 0; i < g.nodeTypeCount; i++) {
    if (!g.nodeTypeIsNamed(i)) continue
    const n = g.nodeTypeForId(i)
    if (n && !n.startsWith("_")) named.push(n)
  }
  return named
}

function loadSpec(cfg: LangConfig) {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "script", "m14", "spec", cfg.classification), "utf8"))
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

function readExpectations(cfg: LangConfig): any[] {
  const dir = path.join(ROOT, cfg.fixturesDir)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".expectation.json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
}

function verifySectionB(cfg: LangConfig): SectionCheck {
  const pinned = new Set<string>()
  for (const exp of readExpectations(cfg)) {
    for (const rel of exp.expectRelationships ?? []) {
      if (typeof rel.type === "string") pinned.add(rel.type)
      if (rel["meta.relationshipType"]) pinned.add(rel["meta.relationshipType"])
      if (rel["meta.isJavaImport"] || rel["meta.isGroovyImport"] || rel["meta.isImport"]) pinned.add("imports")
    }
  }
  const unpinned = cfg.requiredKinds.filter((k) => !pinned.has(k))
  return {
    id: "section-b-relationship-kinds",
    description: `${cfg.requiredKinds.length} relationship kinds pinned by ${cfg.id} fixtures`,
    status: unpinned.length ? "fail" : "pass",
    detail: unpinned.length ? `unpinned: ${unpinned.join(", ")}` : `pinned: ${[...pinned].sort().join(", ")}`,
  }
}

function verifySectionC(cfg: LangConfig): SectionCheck {
  const exps = readExpectations(cfg)
  const missing: string[] = []
  for (const [payload, { key, pin }] of Object.entries(cfg.payloads)) {
    if (!exps.some((e) => Array.isArray(e[key]) && e[key].length > 0)) missing.push(`${payload} (${pin})`)
  }
  return {
    id: "section-c-payload-matrix",
    description: `Matrix 1b payload rows pinned for ${cfg.id} (${Object.keys(cfg.payloads).length})`,
    status: missing.length ? "fail" : "pass",
    detail: missing.length ? `missing pins: ${missing.join(", ")}` : Object.keys(cfg.payloads).join(", "),
  }
}

function verifySectionD(cfg: LangConfig): SectionCheck {
  const tiers = new Set<string>()
  for (const exp of readExpectations(cfg)) {
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

function verifySectionE(cfg: LangConfig): SectionCheck {
  const p = path.join(RESULTS, "M14.0.F5.json")
  if (!fs.existsSync(p)) return { id: "section-e-differential", description: "differential evidence (M14.0.F5.json) exists", status: "fail", detail: "missing M14.0.F5.json" }
  const ev = JSON.parse(fs.readFileSync(p, "utf8"))
  const check = (ev.checks ?? []).find((c: any) => c.id === cfg.differentialCheck)
  if (!check) return { id: "section-e-differential", description: `${cfg.differentialCheck} check present`, status: "fail", detail: `no ${cfg.differentialCheck} check in M14.0.F5.json` }
  const ok = check.status === "pass" && /coverage 100%/.test(check.detail ?? "") && /unexplained 0%/.test(check.detail ?? "")
  return {
    id: "section-e-differential",
    description: `${cfg.differentialCheck} at corpus floor (coverage 100%, unexplained 0%)`,
    status: ok ? "pass" : "fail",
    detail: check.detail ?? String(check.status),
  }
}

function verifySectionF(cfg: LangConfig): SectionCheck {
  if (!fs.existsSync(BASELINE)) return { id: "section-f-perf-budget", description: "perf budget recorded in differential-baseline.json", status: "fail", detail: "missing differential-baseline.json" }
  const b = JSON.parse(fs.readFileSync(BASELINE, "utf8"))
  const avg = b?.counts?.[cfg.perfKey]?.perf?.avgMsPerFile
  return {
    id: "section-f-perf-budget",
    description: `${cfg.id} avgMsPerFile recorded (F9 gate enforces budget)`,
    status: typeof avg === "number" && avg > 0 ? "pass" : "fail",
    detail: typeof avg === "number" && avg > 0 ? `${cfg.perfKey} ${avg} ms/file` : `no avgMsPerFile for ${cfg.perfKey}`,
  }
}

function verifySectionG(cfg: LangConfig): SectionCheck {
  const missing = cfg.docs.filter((d) => !fs.existsSync(path.join(ROOT, d)))
  return {
    id: "section-g-docs",
    description: `${cfg.id} analyzer docs present and committed`,
    status: missing.length ? "fail" : "pass",
    detail: missing.length ? `missing: ${missing.join(", ")}` : cfg.docs.join(", "),
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

async function runLang(cfg: LangConfig): Promise<{ checks: SectionCheck[]; summary: string; failures: number }> {
  const types = await loadNamedNodeTypes(cfg)
  const { spec, handled, silent, gapTypes, decisionTypes } = loadSpec(cfg)

  const classified = (t: string) => handled.has(t) || silent.has(t) || gapTypes.has(t) || decisionTypes.has(t)
  const unclassified = types.filter((t) => !classified(t))
  const staleRows = [...handled, ...silent].filter((t) => !types.includes(t))

  let failures = 0
  if (unclassified.length > 0) {
    failures++
    console.error(`${cfg.id} COMPLETENESS FAIL: ${unclassified.length} node type(s) in NO bucket: ${unclassified.join(", ")}`)
  }
  if (staleRows.length > 0) {
    failures++
    console.error(`${cfg.id} COMPLETENESS FAIL: ${staleRows.length} classified row(s) no longer produced by the wasm (grammar drift?): ${staleRows.join(", ")}`)
  }

  const checks: SectionCheck[] = [
    {
      id: "section-a-structural",
      description: `every named node type classified (${cfg.id})`,
      status: unclassified.length === 0 ? "pass" : "fail",
      detail: `${types.length} types, ${handled.size} handled, ${silent.size} silent, ${spec.gap.gaps.length} gaps, ${spec.design_decision.decisions.length} decisions`,
    },
    verifySectionB(cfg),
    verifySectionC(cfg),
    verifySectionD(cfg),
    verifySectionE(cfg),
    verifySectionF(cfg),
    verifySectionG(cfg),
    verifySectionH(),
  ]
  const sectionFails = checks.filter((c) => c.status !== "pass")
  if (sectionFails.length > 0) {
    failures++
    for (const c of sectionFails) console.error(`${cfg.id} SECTION FAIL: ${c.id} — ${c.detail}`)
  }
  const summary = `${cfg.id}: ${types.length} types classified; sections A-H: ${checks.length - sectionFails.length}/${checks.length} pass`
  return { checks, summary, failures }
}

async function main() {
  const listOnly = process.argv.includes("--list")
  const langArg = process.argv.includes("--lang") ? process.argv[process.argv.indexOf("--lang") + 1] : undefined
  const ids = langArg ? [langArg] : GATED_LANGS
  const cfgs = ids.map((id) => {
    if (!LANG_CONFIGS[id]) throw new Error(`unknown language ${id}`)
    return LANG_CONFIGS[id]
  })

  if (listOnly) {
    for (const cfg of cfgs) {
      const { spec } = loadSpec(cfg)
      const types = await loadNamedNodeTypes(cfg)
      console.log(`\n${cfg.id} grammar: ${types.length} public named node types`)
      console.log(`handled_verified: ${spec.handled_verified.types.length} | internal_silent: ${spec.internal_silent.types.length} | gaps: ${spec.gap.gaps.length} | design decisions: ${spec.design_decision.decisions.length}`)
      console.log("=== NUMBERED GAP LIST ===")
      for (const g of spec.gap.gaps) {
        console.log(`  ${g.id}: [${g.severity}] ${g.node_type} — ${g.missing}`)
      }
      console.log("=== PENDING OWNER DECISIONS ===")
      for (const d of spec.design_decision.decisions) {
        console.log(`  ${d.id}: ${d.question.slice(0, 140)}`)
      }
    }
    return
  }

  let anyFailure = false
  const results: any[] = []
  for (const cfg of cfgs) {
    const r = await runLang(cfg)
    anyFailure = anyFailure || r.failures > 0
    results.push(r)
  }
  if (anyFailure) process.exit(1)

  // Emit evidence (machine-generated; never hand-edited)
  const { emitEvidence } = await import("./evidence-harness")
  const checks: any[] = []
  const data: any = { languages: {} }
  for (const r of results) {
    const cfg = cfgs.find((c) => r.summary.startsWith(c.id + ":"))!
    const { spec } = loadSpec(cfg)
    const gapList = spec.gap.gaps.map((g: any) => `${g.id}: ${g.missing}`)
    const ruled = spec.design_decision.decisions.filter((d: any) => d.status === "RULED")
    const pending = spec.design_decision.decisions.filter((d: any) => d.status !== "RULED")
    checks.push(
      { id: `inventory-fully-classified`, description: `${cfg.id}: every named node type classified`, status: "pass", language: cfg.id },
      { id: "gap-list-present", description: `${cfg.id}: ${spec.gap.gaps.length} confirmed gaps declared`, status: "pass", language: cfg.id },
      { id: "design-decisions-tracked", description: `${cfg.id}: ${ruled.length} ruled, ${pending.length} pending owner`, status: "pass", language: cfg.id },
      ...r.checks.map((c) => ({ ...c, language: cfg.id })),
    )
    data.languages[cfg.id] = {
      nodeTypeCount: (await loadNamedNodeTypes(cfg)).length,
      gaps: gapList,
      ruledDecisions: ruled.map((d: any) => d.id),
      pendingDecisions: pending.map((d: any) => d.id),
      sections: Object.fromEntries(r.checks.map((c) => [c.id, { status: c.status, detail: c.detail ?? "" }])),
    }
  }
  emitEvidence({
    issueId: "M14.0.SPEC",
    title: "Completeness spec (#419) — A–H sections per language",
    claimLevel: "L2",
    layers: ["completeness"],
    checks,
    limitations: [
      { description: "classified against pinned wasm grammars; grammar drift re-validates on every run" },
      { description: "java gaps G1-G4 closed fixture-first (2026-08-26); rulings G5/G6/S1 applied; CONFORMANT" },
      { description: "groovy G1-G8 closed fixture-first 2026-08-27 (34/34 fixtures, 41/41 mutants incl. 13 groovy); S1-S5 ruled: gstring Uses declared limitation (grammar emits no interpolation nodes), JPMS never-reachable, exports/apiContractPath NOT EMITTED, parameters GATED; exports + permits declared not-required for groovy" },
    ],
    data,
  })
  for (const r of results) console.log(r.summary)
}

main().catch((e) => { console.error(e); process.exit(1) })
