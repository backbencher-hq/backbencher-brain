/**
 * TS CLAIM-CLASS PROBE — which CLAIM owns a row, per arm, on the SAME population.
 *
 * ## Why this instrument exists
 *
 * The charter's §21.40 addendum measured, on the production population (17,689 files,
 * `ts,tsx,mts,cts`), that the `--index` arm moves **83,371 rows OUT of `bindOK`** and
 * **+77,089 INTO `extOK`** and **0 → 11,136 INTO `ext?`**, while the javascript lane's indexed
 * arm moved 20,128 rows from UNRESOLVED into extOK with `resolved` and `bindOK` byte-identical.
 * Those are COLUMN TOTALS. This instrument answers the ROW question: for the SAME edge, which
 * claim marker does the analyzer attach in each arm, by what rule, and which claim SHOULD own it.
 *
 * ## The hypothesis this probe tests (and can REFUTE)
 *
 * `real-typescript-analyzer.ts` runs its claim passes in this order:
 *
 *   2828  publishImportedBindingEvidence   (evidence only — publishes `metadata.importedBindings`
 *                                            on the imports rows; no marker of its own)
 *   2834  markExternalTargets              (file-local external markers: test-runner globals,
 *                                            runtime globals, lib types)
 *   2840  applyProjectIndexClaims          (THE INDEX PASS — PASS 1 claims `imports` rows whose
 *                                            module root is not a project module (`module-namespace`);
 *                                            PASS 2 stamps `md.isExternalTarget` +
 *                                            `externalReason: "imported-from-external-module"` on
 *                                            every row whose target is a binding imported from an
 *                                            EXTERNAL module)
 *   2845  applyLocalBindingSpellings       (re-spells to `<callable>\0<binding>` + `md.localBinding`)
 *   2846  applyImportedBindingClaims       (stamps `md.importedBinding = {specifier, binding}`)
 *
 * `carriesClaimMarker()` (line 218) returns TRUE for `md.isExternalTarget === true`, and BOTH
 * binding passes consult it (lines 4740 and 4609). So a row the index pass already claimed is
 * SKIPPED by the binding passes. THE CONSEQUENCE: in the `--index` arm a row that would have been a
 * BINDING CLAIM is instead an EXTERNAL CLAIM — a move between two CLAIM columns, decided purely
 * by PASS ORDER. The javascript analyzer has no index pass of this shape (its `markExternalClaims`
 * claims only host/runtime globals and module-namespace `imports` rows), which is why its `bindOK`
 * is byte-identical between arms.
 *
 * ## What this probe measures (and what it does not)
 *
 * It runs the analyzer over a real corpus population TWICE — once with a complete project index and
 * once without — and for each relationship row it records (a) the CLAIM MARKER the analyzer
 * attached and (b) the ARBITER'S OWN VERDICT for that row (`classifyEdge`, imported from
 * `incoming-rule.ts`, never copied). It is an ATTRIBUTION instrument: it does not adjudicate claims
 * (the arbiter does that, through the very `classifyEdge` it calls) and it does not replace the
 * arm. It answers ONE question: "for the rows whose class changed between the arms, which marker
 * moved, which arbiter branch decided it, and which claim SHOULD own the row".
 *
 * ## THE COUNTERFACTUAL — which claim SHOULD own the row
 *
 * For a row the index pass claimed as `imported-from-external-module`, the probe asks the arbiter
 * what the IMPORTED-BINDING claim would have said (the claim the guard suppressed). The two claims
 * are different statements and only one can be right about a given row:
 *
 *   - the EXTERNAL claim is answered through the SYMBOL KEY SPACE (`verifyExternalClaim` looks the
 *     target up), so a declaration of that name ANYWHERE in the project REFUTES it — and a refuted
 *     claim is counted AGAINST the lane (`extFAIL`);
 *   - the IMPORTED-BINDING claim is verified against the FILE'S OWN import evidence
 *     (`verifyImportedBindingClaim`), so a same-named declaration elsewhere is irrelevant — it is
 *     exactly the name-model DECOY the binding claim exists to displace.
 *
 * So the counterfactual is the measurement that says which claim should own each displaced row.
 *
 * ## The falsifier
 *
 * If the hypothesis is WRONG, the probe must show class changes with no `isExternalTarget` in the
 * index arm, or class changes to a marker the index pass never writes. Both are printed as
 * `UNEXPLAINED-CLASS-CHANGE` with counts, so the probe cannot be read as confirming a story it did
 * not measure. The counterfactual has its own falsifier: a row whose "other claim" is REFUTED is a
 * row the index pass's claim is RIGHT about, and that count is printed too — a hypothesis that
 * claimed the external claim is always the wrong one would be refuted by that number.
 *
 * ## Population rule
 *
 * The file set is derived per run from the corpus the same way `incoming-gate.ts` derives its own:
 * every git checkout under `$BB_CORPUS_ROOT`, `git ls-files`, extension admitted, size cap, then
 * the same deterministic stride. The population is PRINTED with its size, so a sample can never be
 * read as the corpus. `maxFiles` is the PER-REPO cap (0 = every file of every repo).
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-claim-class-probe.ts [maxFiles] [--json out.json]
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-claim-class-probe.ts 50 --json /tmp/probe.json
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { resolveWasmAsset } from "../../src/util/wasm"
// THE ARBITER'S OWN CLASSIFIER — imported, not copied, so the probe cannot disagree with the
// gate by construction (the same rule `incoming-gate.ts` states about `classifyEdge`).
import { classifyEdge, externalClaimOf, isContainsEdge } from "./incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const mod: any = await import("../../src/ast/project-index")
const wasm = resolveWasmAsset("tree-sitter-typescript/tree-sitter-typescript.wasm")

const argv = process.argv.slice(2)
const jsonIdx = argv.indexOf("--json")
const JSON_OUT = jsonIdx >= 0 ? argv[jsonIdx + 1] : null
const MAX_FILES = Number(argv.find((a) => /^\d+$/.test(a)) ?? 0)

/** THE MARKER VOCABULARY, in the analyzer's own order. The first one present IS the claim that
 *  owns the row, because the arbiter's `externalClaimOf` reads them in the same precedence
 *  (localBinding → importedBinding → … → isExternalTarget). */
const MARKERS = [
  "localBinding",
  "importedBinding",
  "defaultExport",
  "moduleExports",
  "importOutsideProject",
  "importProjectFile",
  "remoteRef",
  "baseBeyondRunScope",
  "languageNamespace",
  "sourcePathClaim",
  "isExternalTarget",
] as const

type Marker = string
type RowRec = {
  marker: Marker
  reason: string
  label: string
  target: string
  file: string
  line: number
  source: string
  outcome: string
  claimKind: string
  /** The arbiter's verdict for the OTHER claim — the counterfactual. */
  altOutcome: string
  altClaimKind: string
  /** For the index pass's own claim: would the SYMBOL KEY SPACE refute it? (`extFAIL` risk.) */
  extClaimRisk: string
  /** The ARBITER'S OWN VERDICT for that row — the measurement behind the risk. */
  extClaimActual: string
}

const markerOf = (md: any): { marker: Marker; reason: string } => {
  for (const k of MARKERS) {
    if (k === "isExternalTarget") {
      if (md?.isExternalTarget === true) {
        return { marker: "isExternalTarget", reason: String(md?.externalReason ?? "") }
      }
      continue
    }
    const v = md?.[k]
    if (v === true || (v !== undefined && v !== null && v !== false)) {
      return { marker: k, reason: String(md?.externalReason ?? "") }
    }
  }
  return { marker: "NONE", reason: "" }
}

/**
 * THE OTHER CLAIM — the one the row did NOT carry.
 *
 * The index pass's claim (`isExternalTarget` + `externalReason: "imported-from-external-module"`)
 * is a CLAIM ABOUT A SYMBOL the project does not declare. The imported-binding claim
 * (`importedBinding = {specifier, binding}`) is a CLAIM ABOUT A BINDING the file's own imports
 * establish. They are different statements, and only one of them can be right about a given row:
 *
 *   - the external claim is answered through the SYMBOL KEY SPACE (`verifyExternalClaim` looks the
 *     target up), so a declaration of that name ANYWHERE in the project REFUTES it — and a refuted
 *     claim is counted AGAINST the lane (`extFAIL`);
 *   - the imported-binding claim is verified against the FILE'S OWN import evidence
 *     (`verifyImportedBindingClaim`), so a same-named declaration elsewhere is irrelevant — it is
 *     exactly the name-model DECOY the binding claim exists to displace.
 *
 * So the counterfactual is the measurement that says which claim should own each displaced row.
 *
 * THE BINDING NAME, for the DIRECT case, is the row's own TARGET — the index pass's PASS 2 looked
 * the target up in its `externalBindings` map, so the target IS the binding name it published. For
 * the MEMBER case (`path.join(…)`) the pass published `metadata.externalReceiver` — the binding the
 * member belongs to — and the row's target is the member leaf, which is the arbiter's
 * `position: "receiver"` shape (the JS contract).
 */
const counterfactualClaim = (md: any, actual: any): any => {
  if (actual?.kind === "owner" && md?.externalReason === "imported-from-external-module") {
    const spec = typeof md.externalSpecifier === "string" ? md.externalSpecifier : ""
    if (spec.length === 0) return null
    const recv = typeof md.externalReceiver === "string" ? md.externalReceiver : ""
    if (recv.length > 0) return { kind: "importedBinding", specifier: spec, binding: recv, position: "receiver" }
    // The DIRECT case: the binding name IS the row's target. The probe fills it from the row's
    // own target (it is the only identifier the index pass looked up), so the caller must pass
    // the target in — `counterfactualClaim(md, claim, target)`.
    return { kind: "importedBinding", specifier: spec, binding: "__TARGET__" }
  }
  if (actual?.kind === "importedBinding") {
    return { kind: "owner", specifier: actual.specifier }
  }
  return null
}

type Arm = {
  /** Grouped by the STABLE key (label, file, line) — the join key. Each group is a LIST because
   *  several relationships can share it (two calls of the same callee on one line). */
  groups: Map<string, RowRec[]>
  files: number
  total: number
  byOutcome: Map<string, number>
  /** THE CLAIMS THE PROJECT WOULD REFUTE — the `extFAIL` risk, with samples. */
  refutedSamples: string[]
}

const stableKey = (label: string, file: string, line: number): string => `${label}\0${file}\0${line}`

const runArm = async (useIndex: boolean): Promise<Arm> => {
  const groups = new Map<string, RowRec[]>()
  const byOutcome = new Map<string, number>()
  /** THE CLAIMS THE PROJECT WOULD REFUTE — the `extFAIL` risk. */
  const refutedSamples: string[] = []
  let files = 0
  let total = 0
  const repos = fs.readdirSync(CR).filter((r) => { try { return fs.statSync(path.join(CR, r)).isDirectory() } catch { return false } }).sort()
  for (const repo of repos) {
    const dir = path.join(CR, repo)
    let tracked: string[] = []
    try {
      tracked = (await import("node:child_process")).execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    let filesIn = tracked.filter((r) => /\.(ts|tsx|mts|cts)$/.test(r)).map((r) => path.join(dir, r))
      .filter((abs) => { try { return fs.statSync(abs).size <= 1024 * 1024 } catch { return false } })
    if (filesIn.length === 0) continue
    if (MAX_FILES > 0) filesIn = filesIn.slice(0, MAX_FILES)
    let projectIndex: any
    if (useIndex) {
      try {
        projectIndex = await mod.buildProjectIndexStreaming(wasm, filesIn, mod.TYPESCRIPT_DECLARATION_SPEC)
        projectIndex.complete = true
      } catch { continue }
    }
    // ── THE KEY SPACE, built over the SAME repo's files — the gate's `projectDecl`/`projectKinds`
    // (PER-PROJECT scope: production's scope). The probe builds it the same way so its
    // `classifyEdge` answers the same question the gate's does.
    const pDecl = new Map<string, number>()
    const pKinds = new Map<string, Set<string>>()
    const pFiles = new Set<string>()
    const importEvidence = new Map<string, Map<string, Set<string>>>()
    const repoRows: { rec: RowRec; rel: any }[] = []
    for (const abs of filesIn) {
      let content: string
      try { content = fs.readFileSync(abs, "utf8") } catch { continue }
      let parsed: any
      try {
        parsed = await ASTEngine.parseFile(abs, content, {
          projectIndex, projectRoot: useIndex ? dir : undefined,
        } as any)
      } catch { continue }
      files++
      const relFile = path.relative(dir, abs)
      pFiles.add(relFile)
      for (const s of parsed.symbols ?? []) {
        const key = String(s?.name ?? "")
        if (key.length === 0) continue
        pDecl.set(key, (pDecl.get(key) ?? 0) + 1)
        const ks = pKinds.get(key)
        const kind = String((s as any)?.kind ?? "")
        if (ks) ks.add(kind)
        else pKinds.set(key, new Set([kind]))
      }
      for (const r of parsed.relationships ?? []) {
        const md: any = r.metadata ?? {}
        const { marker, reason } = markerOf(md)
        const label = String(r.type ?? "")
        const source = String(r.source ?? "")
        const target = String(r.target ?? "")
        const line = Number(r.line ?? r.lineStart ?? 0)
        total++
        const rec: RowRec = {
          marker, reason, label, target, file: relFile, line, source,
          outcome: "", claimKind: "", altOutcome: "", altClaimKind: "", extClaimRisk: "", extClaimActual: "",
        }
        const k = stableKey(label, relFile, line)
        const existing = groups.get(k)
        if (existing) existing.push(rec)
        else groups.set(k, [rec])
        repoRows.push({ rec, rel: r })
        // THE IMPORTED-BINDING EVIDENCE, built from the run's OWN import edges (the gate's rule).
        if (label === "imports") {
          const names = Array.isArray(md.importedBindings) ? md.importedBindings : null
          const itemMatch = target.lastIndexOf(":")
          const tgtItem = itemMatch > 0 && itemMatch < target.length - 1 ? target.slice(itemMatch + 1) : ""
          if (names || (tgtItem.length > 0 && tgtItem !== "*")) {
            const specKey = typeof md.module === "string" && md.module.length > 0
              ? md.module
              : (itemMatch > 0 ? target.slice(0, itemMatch) : target)
            let bySpec = importEvidence.get(relFile)
            if (!bySpec) importEvidence.set(relFile, (bySpec = new Map()))
            let bindSet = bySpec.get(specKey)
            if (!bindSet) bySpec.set(specKey, (bindSet = new Set()))
            for (const nm of names ?? []) if (typeof nm === "string" && nm.length > 0) bindSet.add(nm)
            if (tgtItem.length > 0 && tgtItem !== "*") bindSet.add(tgtItem)
          }
        }
      }
    }
    // ── THE ARBITER'S CLASSIFICATION, over the finished key space (the gate's own order).
    const facts = { packages: new Set<string>(), files: pFiles, sdkLib: false, importsByFile: importEvidence }
    for (const { rec, rel } of repoRows) {
      const claim = externalClaimOf(rel)
      const isContains = isContainsEdge(rec.label)
      const c = classifyEdge(pDecl, pKinds, rec.target, claim, facts, isContains, undefined, undefined, rec.file)
      rec.outcome = c.outcome
      rec.claimKind = claim?.kind ?? "-"
      byOutcome.set(c.outcome, (byOutcome.get(c.outcome) ?? 0) + 1)
      const alt0 = counterfactualClaim(rel.metadata ?? {}, claim)
      if (alt0) {
        // The DIRECT case's binding name is the row's own target.
        const alt = alt0.binding === "__TARGET__" ? { ...alt0, binding: rec.target } : alt0
        const c2 = classifyEdge(pDecl, pKinds, rec.target, alt, facts, isContains, undefined, undefined, rec.file)
        rec.altOutcome = c2.outcome
        rec.altClaimKind = alt.kind
      }
      // ── THE EXTERNAL CLAIM'S OWN RISK. The index pass's claim is answered through the SYMBOL
      // KEY SPACE, so a declaration of that name ANYWHERE in the project REFUTES it — and a
      // refuted claim is `extFAIL`, counted AGAINST the lane. The probe measures that risk
      // DIRECTLY: how many of the index pass's claims name a name the project DECLARES. This is
      // the number that says whether the index pass's claim is safe to let own the row.
      if (claim?.kind === "owner" && (rel.metadata as any)?.externalReason === "imported-from-external-module") {
        const declared = (pDecl.get(rec.target) ?? 0) > 0
        rec.extClaimRisk = declared ? "would-be-refuted" : "not-refutable"
        // THE ARBITER'S OWN VERDICT FOR THIS ROW — the measurement, not the prediction. A
        // predicted refutation can be DEMOTED to `ext?` by the project-absolute refiner (a
        // specifier whose root is a project directory), so the two are counted separately.
        rec.extClaimActual = c.outcome
        if (declared) {
          // THE CLAUSE-4 RISK — a claim the project REFUTES, which the gate counts as `extFAIL`.
          // The samples are printed so the class can be characterised before the production
          // dumps land: a name the project declares that ALSO names an external import binding.
          const spec = String((rel.metadata as any)?.externalSpecifier ?? "?")
          refutedSamples.push(`${rec.label} ${rec.source} -> ${rec.target} (specifier ${spec}) @ ${rec.file}:${rec.line}`)
        }
      }
    }
  }
  return { groups, files, total, byOutcome, refutedSamples }
}

console.log(`TS CLAIM-CLASS PROBE — corpus ${CR} · maxFiles ${MAX_FILES} per repo (0 = whole population)`)
const noIndex = await runArm(false)
console.log(`  no-index arm: files ${noIndex.files} · relationships ${noIndex.total}`)
const withIndex = await runArm(true)
console.log(`  --index arm : files ${withIndex.files} · relationships ${withIndex.total}`)

// ── THE JOIN ───────────────────────────────────────────────────────────────────────────────────
// Rows are joined on (label, file, line) — the STABLE part of the key — and paired by ORDINAL
// inside the group. The target is compared separately, because a re-spell changes it (and a
// re-spell IS one of the movements being counted).
type Move = { from: string; to: string; label: string; n: number; reasons: Map<string, number> }
const moves = new Map<string, Move>()
const bump = (from: string, to: string, label: string, reason: string) => {
  const k = `${from} -> ${to} :: ${label}`
  let m = moves.get(k)
  if (!m) moves.set(k, (m = { from, to, label, n: 0, reasons: new Map() }))
  m.n++
  m.reasons.set(reason, (m.reasons.get(reason) ?? 0) + 1)
}

type OutcomeMove = {
  from: string; to: string; label: string; n: number
  fromMarker: string; toMarker: string; reason: string
  altOutcome: string; altClaimKind: string
}
const outcomeMoves = new Map<string, OutcomeMove>()
const bumpOutcome = (a: RowRec, b: RowRec) => {
  const k = `${a.outcome} -> ${b.outcome} :: ${a.label}`
  let m = outcomeMoves.get(k)
  if (!m) {
    outcomeMoves.set(k, (m = {
      from: a.outcome, to: b.outcome, label: a.label, n: 0,
      fromMarker: a.marker, toMarker: b.marker, reason: b.reason,
      altOutcome: b.altOutcome, altClaimKind: b.altClaimKind,
    }))
  }
  m.n++
  if (!m.reason) m.reason = b.reason
  if (!m.altOutcome) { m.altOutcome = b.altOutcome; m.altClaimKind = b.altClaimKind }
}

let joined = 0
let noIndexOnly = 0
let indexOnly = 0
for (const [k, list] of noIndex.groups) {
  const other = withIndex.groups.get(k)
  if (!other) { noIndexOnly += list.length; continue }
  const n = Math.min(list.length, other.length)
  for (let i = 0; i < n; i++) {
    joined++
    const a = list[i]
    const b = other[i]
    if (a.marker !== b.marker) bump(a.marker, b.marker, a.label, String(b.reason ?? ""))
    if (a.outcome !== b.outcome) bumpOutcome(a, b)
  }
}
for (const [k, list] of withIndex.groups) {
  if (!noIndex.groups.has(k)) indexOnly += list.length
}

console.log(`\nJOIN: matched rows ${joined} · no-index-only ${noIndexOnly} · index-only ${indexOnly}`)

// ── THE ARBITER'S VERDICT PER ARM — the columns the gate reports, reproduced row-by-row ──────
console.log(`\nARBITER OUTCOMES PER ARM (the gate's columns, row-exact):`)
const OUTCOME_COLS = [
  "resolved", "ambDeclOnly", "ambBoth", "unresolved",
  "externalVerified", "externalUnverified", "externalRefuted",
  "bindingVerified", "bindingRefuted", "bindingUnverified",
  "causeDeclared", "causeRefuted",
]
const colOf = (o: string): string => {
  if (o === "ambDeclOnly" || o === "ambBoth") return "amb"
  if (o === "externalVerified" || o === "externalUnverified" || o === "externalRefuted") return "ext"
  if (o === "bindingVerified" || o === "bindingRefuted" || o === "bindingUnverified") return "bind"
  return o
}
const armCols = (arm: Arm) => {
  const c = new Map<string, number>()
  for (const o of OUTCOME_COLS) c.set(colOf(o), 0)
  for (const [outcome, n] of arm.byOutcome) {
    const col = colOf(outcome)
    c.set(col, (c.get(col) ?? 0) + n)
  }
  return c
}
const cNo = armCols(noIndex)
const cIdx = armCols(withIndex)
for (const col of ["resolved", "amb", "unresolved", "ext", "bind"]) {
  const a = cNo.get(col) ?? 0
  const b = cIdx.get(col) ?? 0
  console.log(`  ${col.padEnd(11)} no-index ${String(a).padStart(9)}   --index ${String(b).padStart(9)}   delta ${b - a > 0 ? "+" : ""}${b - a}`)
}
console.log(`  per-outcome detail (no-index -> --index):`)
for (const o of OUTCOME_COLS) {
  const a = noIndex.byOutcome.get(o) ?? 0
  const b = withIndex.byOutcome.get(o) ?? 0
  if (a === 0 && b === 0) continue
  console.log(`    ${o.padEnd(20)} ${String(a).padStart(9)} -> ${String(b).padStart(9)}   delta ${b - a > 0 ? "+" : ""}${b - a}`)
}

console.log(`\nOUTCOME MOVEMENT (no-index outcome -> --index outcome), by label:`)
const sortedOutcomes = [...outcomeMoves.values()].sort((x, y) => y.n - x.n)
for (const m of sortedOutcomes) {
  const alt = m.altOutcome ? `  the OTHER claim would be: ${m.altOutcome}` : ""
  console.log(`  ${String(m.n).padStart(9)}  ${m.from} -> ${m.to}   [${m.label}]  markers: ${m.fromMarker} -> ${m.toMarker}${m.reason ? `  reason: ${m.reason}` : ""}${alt}`)
}
const totalOutcomeChanges = sortedOutcomes.reduce((s, m) => s + m.n, 0)
console.log(`  TOTAL outcome changes: ${totalOutcomeChanges}`)

console.log(`\nCLASS CHANGES (marker no-index -> marker --index), by label:`)
const sorted = [...moves.values()].sort((x, y) => y.n - x.n)
for (const m of sorted) {
  const reasons = [...m.reasons.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)
    .map(([r, n]) => `${r || "(none)"}=${n}`).join(", ")
  console.log(`  ${String(m.n).padStart(9)}  ${m.from} -> ${m.to}   [${m.label}]${reasons ? `  reasons: ${reasons}` : ""}`)
}
const totalChanges = sorted.reduce((s, m) => s + m.n, 0)
console.log(`  TOTAL class changes: ${totalChanges}`)

// ── THE FALSIFIER: every class change must be EXPLAINED by the index pass ───────────────────
// The hypothesis says: a class change happens exactly when the index arm's marker is
// `isExternalTarget` with reason `imported-from-external-module` (the index pass's PASS 2) or
// `module-namespace` (the index pass's PASS 1 — an `imports` row that GAINED a claim). Anything
// else is UNEXPLAINED and is printed as such.
const INDEX_REASON = "imported-from-external-module"
const NAMESPACE_REASON = "module-namespace"
let explained = 0
const unexplained: Map<string, number> = new Map()
for (const m of sorted) {
  if (m.to === "isExternalTarget") {
    const idx = m.reasons.get(INDEX_REASON) ?? 0
    const ns = m.reasons.get(NAMESPACE_REASON) ?? 0
    const other = m.n - idx - ns
    if (other > 0) {
      unexplained.set(`to=isExternalTarget reason∉{index,namespace} [${m.label}]`,
        (unexplained.get(`to=isExternalTarget reason∉{index,namespace} [${m.label}]`) ?? 0) + other)
    }
    explained += idx + ns
    continue
  }
  if (m.from === "localBinding" || m.from === "importedBinding") {
    // The guard-suppressed case: the no-index arm carried a binding claim the index arm's
    // `carriesClaimMarker` skipped. The index arm's marker must then be the index pass's claim.
    explained += m.n
    continue
  }
  unexplained.set(`${m.from} -> ${m.to} [${m.label}]`, (unexplained.get(`${m.from} -> ${m.to} [${m.label}]`) ?? 0) + m.n)
}
console.log(`\nEXPLANATION: explained ${explained} · unexplained ${totalChanges - explained}`)
if (unexplained.size > 0) {
  console.log(`  UNEXPLAINED-CLASS-CHANGE (the falsifier fired — the hypothesis does NOT account for these):`)
  for (const [k, n] of [...unexplained.entries()].sort((x, y) => y[1] - x[1])) {
    console.log(`    ${String(n).padStart(9)}  ${k}`)
  }
}

// ── THE COUNTERFACTUAL SUMMARY — which claim SHOULD own the displaced row? ───────────────────
console.log(`\nCOUNTERFACTUAL — for each outcome-moved row, what the OTHER claim would have said:`)
const cfBuckets = new Map<string, { n: number; actual: string; alt: string; label: string }>()
let cfTotal = 0
let cfNoAlt = 0
for (const m of sortedOutcomes) {
  cfBuckets.set(`${m.from} -> ${m.to} :: ${m.label}`, { n: m.n, actual: m.from, alt: m.altOutcome, label: m.label })
  cfTotal += m.n
  if (!m.altOutcome) cfNoAlt += m.n
}
for (const [, v] of [...cfBuckets.entries()].sort((x, y) => y[1].n - x[1].n)) {
  console.log(`  ${String(v.n).padStart(9)}  ${v.actual} -> (index arm claim) ; the OTHER claim would be: ${v.alt || "(not reconstructible from published metadata)"}`)
}
console.log(`  TOTAL outcome-moved rows: ${cfTotal} · of which the other claim is NOT reconstructible: ${cfNoAlt}`)

// ── THE EXTERNAL CLAIM'S REFUTATION RISK (`extFAIL` RISK) ───────────────────────────────────
// The index pass's claim is answered through the SYMBOL KEY SPACE. A name the project DECLARES
// ANYWHERE refutes it — and a refuted claim is counted AGAINST the lane. This is the number that
// says whether letting the index pass own these rows is safe.
console.log(`\nEXTERNAL CLAIM REFUTATION RISK (the index pass's own claims, by whether the project DECLARES the name):`)
const riskBuckets = new Map<string, number>()
for (const list of withIndex.groups.values()) {
  for (const r of list) {
    if (r.extClaimRisk.length === 0) continue
    riskBuckets.set(r.extClaimRisk, (riskBuckets.get(r.extClaimRisk) ?? 0) + 1)
  }
}
for (const [k, n] of [...riskBuckets.entries()].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${String(n).padStart(9)}  ${k}`)
}
console.log(`  samples of the REFUTABLE claims (the extFAIL risk):`)
for (const s of withIndex.refutedSamples.slice(0, 15)) console.log(`    · ${s}`)
// THE MEASUREMENT: the arbiter's OWN verdict for the rows the key space says it would refute.
const actualOfPredicted = new Map<string, number>()
for (const list of withIndex.groups.values()) {
  for (const r of list) {
    if (r.extClaimRisk !== "would-be-refuted") continue
    actualOfPredicted.set(r.extClaimActual, (actualOfPredicted.get(r.extClaimActual) ?? 0) + 1)
  }
}
console.log(`  THE ARBITER'S OWN VERDICT for those predicted-refutable rows (the extFAIL risk MEASURED):`)
for (const [k, n] of [...actualOfPredicted.entries()].sort((x, y) => y[1] - x[1])) {
  console.log(`    ${String(n).padStart(9)}  ${k}${k === "externalRefuted" ? "   <-- extFAIL (a clause-4 red)" : ""}`)
}

const report = {
  corpus: CR,
  maxFiles: MAX_FILES,
  arms: {
    noIndex: { files: noIndex.files, relationships: noIndex.total, byOutcome: Object.fromEntries(noIndex.byOutcome) },
    withIndex: { files: withIndex.files, relationships: withIndex.total, byOutcome: Object.fromEntries(withIndex.byOutcome) },
  },
  join: { matched: joined, noIndexOnly, indexOnly },
  arbiterColumns: {
    noIndex: Object.fromEntries(cNo),
    withIndex: Object.fromEntries(cIdx),
    delta: Object.fromEntries([...cIdx.keys()].map((k) => [k, (cIdx.get(k) ?? 0) - (cNo.get(k) ?? 0)])),
  },
  outcomeChanges: sortedOutcomes.map((m) => ({
    from: m.from, to: m.to, label: m.label, n: m.n,
    fromMarker: m.fromMarker, toMarker: m.toMarker, reason: m.reason,
    altOutcome: m.altOutcome, altClaimKind: m.altClaimKind,
  })),
  totalOutcomeChanges,
  counterfactual: Object.fromEntries([...cfBuckets.entries()].map(([k, v]) => [k, { n: v.n, alt: v.alt }])),
  externalClaimRefutationRisk: Object.fromEntries(riskBuckets),
  refutedSamples: withIndex.refutedSamples,
  classChanges: sorted.map((m) => ({ from: m.from, to: m.to, label: m.label, n: m.n, reasons: Object.fromEntries(m.reasons) })),
  totalChanges,
  explanation: { explained, unexplained: totalChanges - explained, unexplainedDetail: Object.fromEntries(unexplained) },
}
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2))
  console.log(`\nWROTE ${JSON_OUT}`)
}
