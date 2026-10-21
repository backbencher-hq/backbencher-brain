/**
 * CLOJURE LANE — THE QUALIFIED-NAME JOIN's DISCRIMINATING COLUMN, AND THE ANSWERING KEY.
 * Author: Muhammad Ishaq Khan (clojure lane).
 *
 * WHAT THIS INSTRUMENT ANSWERS. The gate's own counter says the qualified-name join resolved **994**
 * rows on the whole admitted population. The lane's own probe priced the same rule at **841**. The
 * 153-row difference is the campaign's NAMED OPEN ITEM, and this instrument closes it ROW BY ROW:
 * for every row the gate's join answered, it prints the (target, namespace used, ANSWERING KEY)
 * triple, says where the namespace came from, and says whether the answering key is a GENUINE
 * qualified declaration or a NAME COINCIDENCE — **which is what tells the join which rows it got
 * right and which it guessed**.
 *
 * THE DISCIPLINE (the Lead's ruling ④, 2026-10-21).
 *   · THE GATE'S OWN RULE IS READ, NOT COPIED. The arbiter's `classifyEdge` is IMPORTED from
 *     `script/m14/incoming-rule.ts`; the gate's own source is READ and its join rule is PARITY-CHECKED
 *     (the phrases the rule consists of must be present in the Lead's file, and the file's sha256 is
 *     printed in the output) ⇒ a copy cannot drift from the gate without this instrument going RED.
 *   · THE ROW POPULATION IS THE GATE'S OWN: the same discovery rule, the same `parseFile` call, the
 *     same symbol loop (`countKey`), the same pending-edge construction, the same `classifyEdge`
 *     call. The join's rows this instrument reports are COUNTED AGAINST THE GATE'S OWN COUNTER —
 *     a check that CAN FAIL.
 *   · THE PRICE IS NOT RESTATED. This instrument prices the JOIN's REACH under two NAMESPACE SOURCES
 *     over ONE row population, so the difference between them is the namespace source's effect and
 *     nothing else.
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/clojure-join-discriminating-column.ts \
 *     --out validation/m14/measurements/clojure-join-discriminating-column.json \
 *     [--gate-arm <the gate's AFTER arm output file>]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

import { parseFile } from "../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, isContainsEdge } from "./incoming-rule"
import { clojureFileNamespace } from "../../src/ast/project-index"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0) return argv[i + 1] ?? ""
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const OUT = argOf("--out") ?? ""
const GATE_ARM = argOf("--gate-arm") ?? ""
const CR = argOf("--corpus-root") ?? process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")

/* ───────────────────────────────── THE GATE's OWN SOURCE, READ FOR PARITY ── */
const GATE_SRC = path.join(ROOT, "script", "m14", "incoming-gate.ts")
const RULE_SRC = path.join(ROOT, "script", "m14", "incoming-rule.ts")
const gateSrc = readFileSync(GATE_SRC, "utf8")
const ruleSrc = readFileSync(RULE_SRC, "utf8")
const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex")
/** THE PHRASES THE GATE's JOIN RULE CONSISTS OF. If the Lead's file changes the rule, one of these
 *  is absent and this instrument refuses to answer under the old rule's name. */
const PARITY_PHRASES: { file: string; text: string; what: string }[] = [
  { file: "incoming-gate.ts", text: 'const branch: "slash" | "namespace" = target.includes("/") ? "slash" : "namespace"', what: "the join's BRANCH test" },
  { file: "incoming-gate.ts", text: "qualified = `${ns}/${target}`", what: "the namespace branch's KEY SPELLING" },
  { file: "incoming-gate.ts", text: "const count = projectDecl.get(repo)?.get(qualified) ?? 0", what: "the join's COUNT read" },
  { file: "incoming-gate.ts", text: 'if (symKind.toLowerCase() === "module" && !nsByFile.has(f)) {', what: "the NAMESPACE SOURCE (the analyzer's module symbol, first per file)" },
  { file: "incoming-gate.ts", text: "const ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)", what: "the OWN-FILE tie-break's input" },
  { file: "incoming-rule.ts", text: "if (qualifiedJoin !== undefined && qualifiedJoin.count === 1) {", what: "the join's ANSWER CONDITION (count === 1)" },
]
const parity: { what: string; ok: boolean }[] = []
for (const p of PARITY_PHRASES) {
  const src = p.file === "incoming-gate.ts" ? gateSrc : ruleSrc
  parity.push({ what: p.what, ok: src.includes(p.text) })
}
const parityOk = parity.every((p) => p.ok)
if (!parityOk) {
  console.error("THE GATE's OWN JOIN RULE HAS MOVED — THE READER-PARITY CHECK FAILED:")
  for (const p of parity) if (!p.ok) console.error(`  MISSING: ${p.what} — ${p.text}`)
  console.error("⇒ THIS INSTRUMENT REFUSES TO ANSWER UNDER THE OLD RULE's NAME ✓✓")
  process.exit(3)
}

/* ───────────────────────────────── THE POPULATION — the gate's own rule ── */
const EXTS = ["clj", "cljs", "cljc", "edn"]
const SIZE_CAP = 1024 * 1024
function gitTracked(repoDir: string): string[] {
  try {
    const r = Bun.spawnSync(["git", "-C", repoDir, "ls-files"], { stdout: "pipe", stderr: "pipe" })
    if (r.exitCode !== 0) return []
    return new TextDecoder().decode(r.stdout).split("\n").filter((l) => l.trim().length > 0)
  } catch { return [] }
}
function discover(): { files: string[]; repos: Map<string, number>; byExt: Map<string, number>; symlinkedDirs: number } {
  const files: string[] = []
  const repos = new Map<string, number>()
  const byExt = new Map<string, number>()
  let symlinkedDirs = 0
  for (const repo of readdirSync(CR).sort()) {
    const repoDir = path.join(CR, repo)
    let st: any
    try { st = statSync(repoDir) } catch { continue }
    if (!st.isDirectory()) continue
    let n = 0
    for (const rel of gitTracked(repoDir)) {
      const ext = rel.split(".").pop()?.toLowerCase() ?? ""
      if (!EXTS.includes(ext)) continue
      const abs = path.join(repoDir, rel)
      let size = 0
      try { size = statSync(abs).size } catch { continue }
      if (size > SIZE_CAP) continue
      files.push(abs)
      byExt.set(ext, (byExt.get(ext) ?? 0) + 1)
      n++
    }
    if (n > 0) repos.set(repo, n)
  }
  files.sort()
  return { files, repos, byExt, symlinkedDirs }
}

/* ───────────────────────────────── THE LABEL TABLE — the gate's own ── */
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls",
  uses: "uses",
  contains: "contains", composition: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
  decorates: "decorates", renders: "renders", mixes_in: "mixes_in", part_of: "part_of",
}
const ontologyName = (raw: string): string | null => (LABEL_ALIASES[raw] as string) ?? null

/* ───────────────────────────────── THE PARSER (for the production's namespace) ── */
const { getParser } = await import("../../src/ast/engine")
const parser = await getParser("clojure" as any)

/** DOES THIS FILE CARRY AN `(in-ns …)` FORM? The analyzer publishes a MODULE SYMBOL for every
 *  namespace form it sees — `(ns …)` AND `(in-ns …)` — so the module symbol alone cannot say which
 *  one produced it, and the namespace's PROVENANCE needs the form itself. */
const hasInNsForm = (root: any): boolean => {
  const walk = (n: any): boolean => {
    if (n.type === "list_lit") {
      const head = n.namedChild(0)
      if (head && head.type === "sym_lit") {
        const nm = String(head.text ?? "")
        if (nm === "in-ns") return true
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && walk(c)) return true
    }
    return false
  }
  return walk(root)
}

/* ───────────────────────────────── THE STATE ── */
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const declPos = new Map<string, { file: string; line: number }[]>()
/** THE GATE's NAMESPACE SOURCE — the analyzer's FIRST MODULE SYMBOL's name, per file. */
const nsByFile = new Map<string, string>()
/** THE PRODUCTION's NAMESPACE SOURCE — `clojureFileNamespace` (the `(ns …)` form), per file. */
const prodNsByFile = new Map<string, string>()
/** THE FILE's NAMESPACE PROVENANCE — `ns-form` | `in-ns` | `user-default`. */
const nsProvenanceByFile = new Map<string, string>()
/** EVERY MODULE SYMBOL's NAME, per file — so a reader can see what the analyzer published. */
const moduleNamesByFile = new Map<string, string[]>()
/** THE DECLARATION BEHIND EACH KEY — the ANSWERING KEY's witness. */
const declWitness = new Map<string, { file: string; line: number; kind: string; name: string; qualifiedName: string }[]>()

type Pending = { label: string; tgt: string; claim: any; owner: string | null; repo: string; srcFile: string; line: number | null }
const pending: Pending[] = []

const disc = discover()
console.log(`THE JOIN's DISCRIMINATING COLUMN — the gate's own population rule, over ${CR}`)
console.log(`  population: ${disc.files.length} file(s) · ${disc.repos.size} repo(s) · by extension ${JSON.stringify(Object.fromEntries([...disc.byExt].sort()))}`)

const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0])
}

let parsed = 0
let failed = 0
for (const f of disc.files) {
  let r: any
  try {
    r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any)
  } catch {
    failed++
    continue
  }
  if (!r) { failed++; continue }
  parsed++
  const repo = repoOf(f)
  let pDecl = projectDecl.get(repo)
  if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo)
  if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  const countKey = (key: string, kind: string, file: string, line: number | null, witness: { name: string; qualifiedName: string }) => {
    const at = declPos.get(key)
    const pos = { file, line: line ?? -1 }
    if (!at) declPos.set(key, [pos])
    else if (!at.some((d) => d.file === file && d.line === pos.line)) at.push(pos)
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    let qs = pKinds!.get(key)
    if (!qs) pKinds!.set(key, (qs = new Set()))
    qs.add(kind)
    const w = declWitness.get(key) ?? []
    if (!w.some((x) => x.file === file && x.line === (line ?? -1))) {
      w.push({ file, line: line ?? -1, kind, name: witness.name, qualifiedName: witness.qualifiedName })
      declWitness.set(key, w)
    }
  }
  const moduleNames: string[] = []
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const symKind = String(s?.kind ?? "")
    const symLine = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line_start ?? (s as any)?.lineStart ?? (s as any)?.startLine ?? (s as any)?.line ?? 0) || null
    const symQual = String((s as any)?.qualifiedName ?? "")
    const genuineQual = symQual && symQual !== name ? symQual : ""
    countKey(name, symKind, f, symLine, { name, qualifiedName: symQual })
    if (symKind.toLowerCase() === "module" && !nsByFile.has(f)) nsByFile.set(f, name)
    if (symKind.toLowerCase() === "module") moduleNames.push(name)
    if (genuineQual.length > 0) countKey(genuineQual, symKind, f, symLine, { name, qualifiedName: symQual })
  }
  moduleNamesByFile.set(f, moduleNames)
  // THE PRODUCTION's NAMESPACE SOURCE — the production's own function, over the production's own tree.
  let prodNs = ""
  let inNs = false
  try {
    const content = readFileSync(f, "utf8")
    const tree = parser.parse(content)
    prodNs = clojureFileNamespace(tree.rootNode as any)
    inNs = hasInNsForm(tree.rootNode)
  } catch { /* the namespace stays unknown; the row is priced by the gate's source alone */ }
  prodNsByFile.set(f, prodNs)
  nsProvenanceByFile.set(f, prodNs !== "" ? "ns-form" : inNs ? "in-ns" : "user-default")

  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgt.length === 0) continue
    const claim = externalClaimOf(rel)
    const ownerRaw = (rel as any)?.metadata?.owner
    const owner = typeof ownerRaw === "string" && ownerRaw.length > 0 ? ownerRaw : null
    const line = Number((rel as any)?.line_number ?? (rel as any)?.lineNumber ?? (rel as any)?.line ?? 0) || null
    pending.push({ label, tgt, claim, owner, repo, srcFile: f, line })
  }
}

/* ───────────────────────────────── THE JOIN, UNDER TWO NAMESPACE SOURCES ── */
/** THE GATE's OWN JOIN LOOKUP, transcribed from `incoming-gate.ts`'s `qualifiedJoinFor` — and the
 *  transcription is PARITY-CHECKED against the Lead's file above (the branch test, the key
 *  spelling, and the count read are all asserted present in the Lead's source). */
const qjFor = (repo: string, target: string, file: string, nsSource: Map<string, string>) => {
  const branch: "slash" | "namespace" = target.includes("/") ? "slash" : "namespace"
  let qualified: string
  if (branch === "slash") {
    qualified = target
  } else {
    const ns = nsSource.get(file)
    if (ns === undefined || ns === "") return undefined
    qualified = `${ns}/${target}`
  }
  const count = projectDecl.get(repo)?.get(qualified) ?? 0
  return { qualified, count, branch }
}

type Joined = {
  label: string
  target: string
  file: string
  line: number | null
  namespaceUsed: string
  namespaceProvenance: string
  answeringKey: string
  keyCount: number
  witness: { file: string; line: number; kind: string; name: string; qualifiedName: string } | null
  verdict: "RIGHT" | "GUESSED"
  verdictWhy: string
  pricedByProductionNamespace: boolean
  productionNamespace: string
  productionAnsweringKey: string
  productionKeyCount: number
}
const joined: Joined[] = []
let askedSlash = 0
let askedNamespace = 0
let resolvedSlash = 0
let resolvedNamespace = 0
let gateResolved = 0
/** THE OWN-FILE TIE-BREAK's REACH — MEASURED, NOT ASSUMED. The tie-break (production's own rule,
 *  commit e1e2f7a19) resolves a row when the edge's OWN FILE declares the target. Inside
 *  `classifyEdge` it is the ONLY rule that returns `resolved` inside the AMBIGUOUS branch besides
 *  the join itself ⇒ ⇒ a row that is AMBIGUOUS by the name model, RESOLVED, and NOT joined was
 *  resolved BY THE TIE-BREAK ⇒ ⇒ this measures the tie-break's reach without copying its rule. */
let tieBreakRows = 0
let ambiguousRows = 0
let ambiguousCeiling = 0
/** THE SAME ROWS, PRICED UNDER THE PRODUCTION's NAMESPACE SOURCE. */
let prodPriced = 0
let prodPricedSlash = 0
let prodPricedNamespace = 0

for (const e of pending) {
  const ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
  const isContains = isContainsEdge(e.label)
  const qj = qjFor(e.repo, e.tgt, e.srcFile, nsByFile)
  const pc = classifyEdge(
    projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, undefined, isContains, ownFileDeclares,
    undefined, undefined, qj,
  )
  if (qj !== undefined) {
    if (qj.branch === "slash") askedSlash++
    else askedNamespace++
  }
  // THE NAME MODEL's VERDICT FOR THIS ROW, AND THE TIE-BREAK's REACH ✓✓.
  const decls = projectDecl.get(e.repo)?.get(e.tgt) ?? 0
  if (decls > 1) {
    ambiguousCeiling++
    if (pc.joined) {
      // the join's row — counted below
    } else if (pc.outcome === "resolved") {
      tieBreakRows++
    } else {
      ambiguousRows++
    }
  }
  if (!pc.joined) continue
  gateResolved++
  if (qj?.branch === "slash") resolvedSlash++
  else resolvedNamespace++
  // THE SAME ROW UNDER THE PRODUCTION's NAMESPACE SOURCE.
  const qjProd = qjFor(e.repo, e.tgt, e.srcFile, prodNsByFile)
  if (qjProd !== undefined) {
    if (qjProd.branch === "slash") prodPricedSlash++
    else prodPricedNamespace++
    if (qjProd.count === 1) prodPriced++
  }
  const nsUsed = nsByFile.get(e.srcFile) ?? ""
  const prov = nsProvenanceByFile.get(e.srcFile) ?? "unknown"
  const witness = (declWitness.get(qj!.qualified) ?? [])[0] ?? null
  // THE VERDICT — what tells the join which rows it got RIGHT and which it GUESSED.
  //   RIGHT   — the answering key IS the declaration's own qualified name (`ns/name`): the key
  //             names a declaration the project publishes, qualified exactly that way.
  //   GUESSED — the key was answered by a declaration whose BARE NAME happens to spell it, or the
  //             namespace it was built from is not the file's declared namespace.
  const qualifiedWitness = witness !== null && witness.qualifiedName === qj!.qualified
  const verdict = qualifiedWitness && prov === "ns-form" ? "RIGHT" : "GUESSED"
  const why = !qualifiedWitness
    ? "the answering key is held by a declaration whose NAME spells it, not by a qualified name — a spelling coincidence"
    : prov !== "ns-form"
      ? `the namespace was qualified by the ${prov} source, not by the file's declared (ns …) namespace`
      : "the key is the declaration's own qualified name, qualified by the file's declared (ns …) namespace"
  joined.push({
    label: e.label,
    target: e.tgt,
    file: e.srcFile,
    line: e.line,
    namespaceUsed: nsUsed,
    namespaceProvenance: prov,
    answeringKey: qj!.qualified,
    keyCount: qj!.count,
    witness,
    verdict,
    verdictWhy: why,
    pricedByProductionNamespace: qjProd !== undefined && qjProd.count === 1,
    productionNamespace: prodNsByFile.get(e.srcFile) ?? "",
    productionAnsweringKey: qjProd?.qualified ?? "",
    productionKeyCount: qjProd?.count ?? 0,
  })
}

/* ───────────────────────────────── THE GATE's OWN COUNTER — the check that CAN FAIL ── */
let gateCounter: number | null = null
let gateCounterSlash: number | null = null
let gateCounterNamespace: number | null = null
if (GATE_ARM && readFileSync(GATE_ARM, "utf8").includes("qualified-name join")) {
  const txt = readFileSync(GATE_ARM, "utf8")
  const m = txt.match(/qualified-name join: (\d+) row\(s\) resolved by the qualified-name join[^—]*— slash branch: (\d+) of (\d+) row\(s\) asked · namespace branch: (\d+) of (\d+) row\(s\) asked/)
  if (m) {
    gateCounter = Number(m[1])
    gateCounterSlash = Number(m[2])
    gateCounterNamespace = Number(m[4])
  }
}

/* ───────────────────────────────── THE DECOMPOSITION ── */
const right = joined.filter((j) => j.verdict === "RIGHT")
const guessed = joined.filter((j) => j.verdict === "GUESSED")
const byProvenance = new Map<string, number>()
for (const j of joined) byProvenance.set(j.namespaceProvenance, (byProvenance.get(j.namespaceProvenance) ?? 0) + 1)
const byVerdictProvenance = new Map<string, number>()
for (const j of joined) {
  const k = `${j.verdict} · ${j.namespaceProvenance}`
  byVerdictProvenance.set(k, (byVerdictProvenance.get(k) ?? 0) + 1)
}
const notPricedByProduction = joined.filter((j) => !j.pricedByProductionNamespace)
const byReason = new Map<string, number>()
for (const j of notPricedByProduction) {
  const reason = j.productionNamespace === ""
    ? `the production's namespace source yields NO namespace for this file (${j.namespaceProvenance}) — the row cannot be priced under it`
    : `the two namespace sources disagree: the gate's "${j.namespaceUsed}" vs the production's "${j.productionNamespace}"`
  byReason.set(reason, (byReason.get(reason) ?? 0) + 1)
}

const report = {
  instrument: "script/m14/clojure-join-discriminating-column.ts",
  lane: "clojure",
  author: "Muhammad Ishaq Khan",
  command: `BB_CORPUS_ROOT=${CR} bun run script/m14/clojure-join-discriminating-column.ts --out ${OUT}${GATE_ARM ? ` --gate-arm ${GATE_ARM}` : ""}`,
  corpusRoot: path.resolve(CR),
  view: {
    gateSha256: sha(GATE_SRC),
    arbiterSha256: sha(RULE_SRC),
    analyzerSha256: sha(path.join(ROOT, "src", "ast", "real-clojure-analyzer.ts")),
    specSha256: sha(path.join(ROOT, "script", "m14", "spec", "clojure-completeness.json")),
    treeCommit: "81cc4aea9b23f3fb608f61f449e67710e1ef3a05",
    readerParity: parity,
  },
  population: { files: disc.files.length, repos: disc.repos.size, parsed, failed, byExtension: Object.fromEntries([...disc.byExt].sort()), byRepository: Object.fromEntries([...disc.repos].sort()) },
  gateCounter: { joined: gateCounter, slashResolved: gateCounterSlash, namespaceResolved: gateCounterNamespace, arm: GATE_ARM },
  reproduced: {
    joined: gateResolved,
    slashResolved: resolvedSlash,
    namespaceResolved: resolvedNamespace,
    slashAsked: askedSlash,
    namespaceAsked: askedNamespace,
    matchesTheGate: gateCounter === null ? null : gateResolved === gateCounter,
  },
  pricedUnderTheProductionNamespaceSource: { priced: prodPriced, slashAsked: prodPricedSlash, namespaceAsked: prodPricedNamespace },
  theOwnFileTieBreak: {
    question: "does the cell include the shared OWN-FILE TIE-BREAK's movement (e1e2f7a19) — PER ROW OR PER COLUMN?",
    answer: "PER ROW — the tie-break is a PER-ROW rule (the edge's OWN FILE declares the target ⇒ that row resolves), and the COLUMN movement is exactly the number of rows it resolved. It is never a column-wide reclassification.",
    rowsResolvedByTheTieBreak: tieBreakRows,
    rowsResolvedByTheJoin: gateResolved,
    rowsStillAmbiguous: ambiguousRows,
    theAmbiguousCeiling: ambiguousCeiling,
    theSumCloses: tieBreakRows + gateResolved + ambiguousRows === ambiguousCeiling,
  },
  difference: {
    rows: notPricedByProduction.length,
    theProbeRecordedPrice: 841,
    theProbePriceSource: "validation/m14/fixtures/clojure/lane-logs/index-effect.json (joinPrice.inGateKeySpace)",
    byReason: Object.fromEntries([...byReason].sort()),
  },
  verdict: {
    RIGHT: right.length,
    GUESSED: guessed.length,
    byNamespaceProvenance: Object.fromEntries([...byProvenance].sort()),
    byVerdictAndProvenance: Object.fromEntries([...byVerdictProvenance].sort()),
  },
  rows: joined,
}

console.log("")
console.log(`THE JOIN — reproduced: ${gateResolved} row(s) resolved · slash ${resolvedSlash} of ${askedSlash} asked · namespace ${resolvedNamespace} of ${askedNamespace} asked`)
if (gateCounter !== null) {
  console.log(`  THE GATE's OWN COUNTER: ${gateCounter} · slash ${gateCounterSlash} · namespace ${gateCounterNamespace} ⇒ ${report.reproduced.matchesTheGate ? "MATCH ✓✓" : "MISMATCH ✗✗ — THE REPRODUCTION IS WRONG ✓✓"}`)
}
console.log(`  THE SAME ROWS PRICED UNDER THE PRODUCTION's NAMESPACE SOURCE: ${prodPriced} ⇒ the namespace source's effect: ${notPricedByProduction.length} row(s)`)
console.log(`  THE VERDICT: RIGHT ${right.length} · GUESSED ${guessed.length} · by provenance ${JSON.stringify(Object.fromEntries([...byProvenance].sort()))}`)
console.log(`  THE OWN-FILE TIE-BREAK (e1e2f7a19): PER ROW — ${tieBreakRows} row(s) resolved by it · the join ${gateResolved} · still ambiguous ${ambiguousRows} · the ceiling ${ambiguousCeiling} ⇒ the sum closes: ${tieBreakRows + gateResolved + ambiguousRows === ambiguousCeiling}`)
console.log(`  THE ${notPricedByProduction.length} NOT PRICED UNDER THE PRODUCTION's SOURCE — by reason:`)
for (const [k, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${k}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
  console.log(`JSON: ${OUT}`)
}
