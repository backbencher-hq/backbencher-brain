/**
 * OBJC — THE CAUSE CENSUS BEHIND `OBJC-FIX.md` (Step 1 of the lane brief).
 *
 * WHY IT EXISTS. `incoming-gate.ts` prints the residual per TYPE and the not-resolved edges
 * grouped by MARKER SET — up to five marker sets per type, so the full partition is not in its
 * output. This probe reproduces the gate's own partition EXACTLY (same discovered population,
 * same `parseFile` call, same key space, the RULE imported from `script/m14/incoming-rule.ts`)
 * and then answers the one question the report needs: for every unresolved edge, WHICH NAMED
 * CONSTRUCT produced it, and how many edges each construct holds.
 *
 * THE POPULATION IS THE GATE'S, NOT A COPY OF IT. `BB_LIST_FILES=1 bun run
 * script/m14/incoming-gate.ts objc m,mm 400` makes the gate print its own discovered file set
 * (`measurements/population-objc-400.txt`); this probe reads that list. A hard-coded file array
 * is a defect the moment a file is added beside it, and a re-implemented discovery rule is a
 * second rule.
 *
 * IT IS A CENSUS, NOT AN ARBITER. The gate's TABLE 1 is the verdict; this probe CROSS-CHECKS
 * itself against it and refuses to print a bucket table if the totals disagree (`EXIT 3`), so a
 * cause bucket can never be read off a key space that is not the gate's.
 *
 * Run:  bun run validation/m14/fixtures/objc/binding-census.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, isContainsEdge, type ProjectFacts, type ExternalClaim } from "../../../../script/m14/incoming-rule"
// The separator is the FAMILY constant (`src/ast/types.ts`), imported rather than re-spelled: the
// analyzer writes it and the gate checks it, and a local copy would be a second spelling.
import { BINDING_SEP } from "../../../../src/ast/types"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const POP = path.join(import.meta.dir, "measurements", "population-objc-400.txt")

/** The gate's own label aliases (`incoming-gate.ts` LABEL_ALIASES), which map relationship
 *  spellings onto the ten ontology names its columns are keyed by. */
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls", uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

type Pending = {
  label: string
  tgt: string
  /** the edge's SOURCE half — the enclosing callable, and the `<callable>` half of the family binding spelling */
  source: string
  claim: ExternalClaim | null
  sig: string
  repo: string
  srcFile: string
  reasonCode: string | null
  isBareRead: boolean
  isFieldRead: boolean
  isMessageArgument: boolean
  outcome: string
  /** the target is a symbol the EDGE'S OWN FILE publishes (not a unit-local binding) */
  ownFileDeclares: boolean
  /** the target is a symbol ANY file of the project publishes */
  projectDeclares: boolean
}

const files = fs.readFileSync(POP, "utf8").split("\n")
  .filter((l) => l.startsWith("BB_LIST_FILES_FILE:"))
  .map((l) => l.slice("BB_LIST_FILES_FILE:".length).trim())
if (files.length === 0) { console.error("no population: run BB_LIST_FILES=1 first"); process.exit(2) }
const header = fs.readFileSync(POP, "utf8").split("\n").find((l) => l.startsWith("BB_LIST_FILES:")) ?? ""
console.log(`population: ${files.length} file(s) — ${header.trim()}`)

const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0])
}

// ── the key space, built the gate's way: `name`, plus the `qualifiedName` alias when it differs ──
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const declPos = new Map<string, { file: string; line: number }[]>()
const fileSymbols = new Map<string, Set<string>>()
const admittedByRepo = new Map<string, string[]>()
for (const f of files) {
  const repo = repoOf(f)
  const list = admittedByRepo.get(repo)
  if (list) list.push(f); else admittedByRepo.set(repo, [f])
}
const countKey = (repo: string, key: string, kind: string, file: string, line: number | null) => {
  let d = projectDecl.get(repo)
  if (!d) projectDecl.set(repo, (d = new Map()))
  let k = projectKinds.get(repo)
  if (!k) projectKinds.set(repo, (k = new Map()))
  d.set(key, (d.get(key) ?? 0) + 1)
  let ks = k.get(key)
  if (!ks) k.set(key, (ks = new Set()))
  ks.add(kind)
  const at = declPos.get(key)
  const pos = { file, line: line ?? -1 }
  if (!at) declPos.set(key, [pos])
  else if (!at.some((x) => x.file === file && x.line === pos.line)) at.push(pos)
}

const pending: Pending[] = []
let parsed = 0
for (const f of files) {
  const repo = repoOf(f)
  const r: any = await parseFile(f, repo, { projectRoot: repo } as any)
  if (!r) continue
  parsed++
  const names = new Set<string>()
  fileSymbols.set(f, names)
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    names.add(name)
    const kind = String(s?.kind ?? "")
    const line = Number(s?.range?.startLine ?? s?.range?.start_line ?? 0) || null
    countKey(repo, name, kind, f, line)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) countKey(repo, q, kind, f, line)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = LABEL_ALIASES[String(rel?.type ?? rel?.relationshipType ?? "")]
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgt.length === 0) continue
    const md: any = rel?.metadata ?? {}
    const sig = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null).sort().join("+")
    pending.push({
      label, tgt, source: String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? ""), claim: externalClaimOf(rel), sig, repo, srcFile: f,
      reasonCode: typeof md.reasonCode === "string" ? md.reasonCode : null,
      isBareRead: md.isBareRead === true, isFieldRead: md.isFieldRead === true, isMessageArgument: md.isMessageArgument === true,
      outcome: "", ownFileDeclares: false, projectDeclares: false,
    })
  }
}

const factsOf = (repo: string): ProjectFacts => ({
  packages: new Set<string>(), sdkLib: false,
  files: new Set((admittedByRepo.get(repo) ?? []).map((f) => path.relative(repo, f).split(path.sep).join("/"))),
})

const rows = new Map<string, { edges: number; resolved: number; amb: number; unres: number }>()
for (const t of TYPES) rows.set(t, { edges: 0, resolved: 0, amb: 0, unres: 0 })
for (const e of pending) {
  const row = rows.get(e.label)!
  row.edges++
  e.ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
  e.projectDeclares = (projectDecl.get(e.repo)?.get(e.tgt) ?? 0) > 0
  const c = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, factsOf(e.repo), isContainsEdge(e.label), e.ownFileDeclares)
  e.outcome = c.outcome
  if (c.outcome === "resolved") row.resolved++
  else if (c.outcome === "ambBoth" || c.outcome === "ambDeclOnly") row.amb++
  else if (c.outcome === "unresolved") row.unres++
}

// ── CROSS-CHECK AGAINST THE GATE'S OWN TABLE 1 ────────────────────────────────────────────────
// TWO TABLES, because the instrument is run on both sides of the fix: `before` is the gate's
// `OBJC-FIX-baseline.txt` TABLE 1, `after` is `OBJC-FIX-after.txt` TABLE 1. The cross-check is what
// makes a cause bucket trustworthy — a bucket table read off a key space that is not the gate's is
// a second opinion about a different question — so the table is selected by `BB_CENSUS_TABLE` and a
// disagreement on ANY row stops the run (exit 3) rather than printing buckets.
const TABLES: Record<string, Record<string, { edges: number; resolved: number; amb: number; unres: number }>> = {
  before: {
    calls: { edges: 13189, resolved: 4234, amb: 1435, unres: 7520 },
    uses: { edges: 15965, resolved: 3043, amb: 2366, unres: 10556 },
    contains: { edges: 4169, resolved: 4169, amb: 0, unres: 0 },
    imports: { edges: 851, resolved: 0, amb: 0, unres: 851 },
    references: { edges: 851, resolved: 0, amb: 0, unres: 851 },
    exports: { edges: 772, resolved: 492, amb: 280, unres: 0 },
    extends: { edges: 135, resolved: 53, amb: 4, unres: 78 },
    implements: { edges: 36, resolved: 0, amb: 0, unres: 36 },
    overrides: { edges: 754, resolved: 0, amb: 0, unres: 754 },
    instantiates: { edges: 1240, resolved: 354, amb: 602, unres: 284 },
  },
  after: {
    calls: { edges: 13189, resolved: 4234, amb: 1435, unres: 7520 },
    uses: { edges: 15965, resolved: 1834, amb: 1573, unres: 3617 },
    contains: { edges: 4169, resolved: 4169, amb: 0, unres: 0 },
    imports: { edges: 851, resolved: 0, amb: 0, unres: 851 },
    references: { edges: 851, resolved: 0, amb: 0, unres: 851 },
    exports: { edges: 772, resolved: 492, amb: 280, unres: 0 },
    extends: { edges: 135, resolved: 53, amb: 4, unres: 78 },
    implements: { edges: 36, resolved: 0, amb: 0, unres: 36 },
    overrides: { edges: 754, resolved: 0, amb: 0, unres: 754 },
    instantiates: { edges: 1240, resolved: 354, amb: 602, unres: 284 },
  },
}
const WHICH = process.env.BB_CENSUS_TABLE === "after" ? "after" : "before"
const GATE = TABLES[WHICH]
console.log(`cross-checking against the gate's ${WHICH.toUpperCase()} TABLE 1`)
let mismatch = 0
for (const t of TYPES) {
  const a = rows.get(t)!, b = GATE[t]
  if (a.edges !== b.edges || a.resolved !== b.resolved || a.amb !== b.amb || a.unres !== b.unres) {
    mismatch++
    console.log(`MISMATCH ${t}: probe ${a.edges}/${a.resolved}/${a.amb}/${a.unres} vs gate ${b.edges}/${b.resolved}/${b.amb}/${b.unres}`)
  }
}
const tot = TYPES.reduce((s, t) => { const a = rows.get(t)!; return { e: s.e + a.edges, r: s.r + a.resolved, a: s.a + a.amb, u: s.u + a.unres } }, { e: 0, r: 0, a: 0, u: 0 })
console.log(`CROSS-CHECK vs gate TABLE 1: edges ${tot.e} resolved ${tot.r} amb(decl) ${tot.a} unresolved ${tot.u}` +
  (mismatch === 0 ? " — EVERY ROW MATCHES" : ` — ${mismatch} ROW(S) DISAGREE`))
if (mismatch > 0) process.exit(3)

// ── BUCKET 1: every unresolved edge, by NAMED CONSTRUCT (type + marker set + reason code) ──
const buckets = new Map<string, { n: number; reasons: Map<string, number>; targets: Set<string>; example: string }>()
for (const e of pending) {
  if (e.outcome !== "unresolved") continue
  const key = `${e.label} | ${e.sig}`
  let b = buckets.get(key)
  if (!b) buckets.set(key, (b = { n: 0, reasons: new Map(), targets: new Set(), example: "" }))
  b.n++
  if (e.reasonCode) b.reasons.set(e.reasonCode, (b.reasons.get(e.reasonCode) ?? 0) + 1)
  b.targets.add(e.tgt)
  if (!b.example) b.example = e.tgt
}
console.log(`\nUNRESOLVED BY NAMED CONSTRUCT (${tot.u} edges total, ${buckets.size} bucket(s)):`)
for (const [k, b] of [...buckets].sort((x, y) => y[1].n - x[1].n)) {
  const reasons = [...b.reasons].map(([r, n]) => `${r} ${n}`).join(" · ") || "(no reasonCode)"
  console.log(`  ${String(b.n).padStart(6)}  ${k}`)
  console.log(`          reasonCode: ${reasons} · ${b.targets.size} distinct target(s) · e.g. ${JSON.stringify(b.example)}`)
}

// ── BUCKET 2: the `uses` value reads, split by whether the NAME is a declaration the file publishes ──
const readSplit = new Map<string, number>()
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
for (const e of pending) {
  if (!e.isBareRead && !e.isFieldRead) continue
  const shape = e.isBareRead && e.isFieldRead ? "bare+field" : e.isBareRead ? "bare" : "field"
  bump(readSplit, `${e.label}/${shape}/${e.outcome === "ambBoth" || e.outcome === "ambDeclOnly" ? "amb" : e.outcome}/ownFile=${e.ownFileDeclares}/project=${e.projectDeclares}`)
}
console.log(`\nVALUE-READ SPLIT (uses, isBareRead/isFieldRead), by outcome and declaration presence:`)
for (const [k, n] of [...readSplit].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`)

// ── BUCKET 3: THE COUNTERFACTUAL — what a BINDING claim on the unit-local bare reads would do ──
// The predicate the analyzer can apply from its own state: `isBareRead` (isBoundValue already
// proved the name is bound in scope) AND the file publishes NO symbol of that name (so the name
// denotes a parameter/local, which the store never publishes — DARTD8).
const cf = { claimed: 0, verified: 0, refuted: 0, unverified: 0, wasResolved: 0, wasUnresolved: 0, wasAmb: 0, wasExtOrBind: 0 }
const resolvedByClaim = new Map<string, number>()
for (const e of pending) {
  if (!e.isBareRead || e.isFieldRead) continue
  if (e.ownFileDeclares) continue
  cf.claimed++
  if (e.outcome === "resolved") cf.wasResolved++
  else if (e.outcome === "unresolved") cf.wasUnresolved++
  else if (e.outcome === "ambBoth" || e.outcome === "ambDeclOnly") cf.wasAmb++
  else cf.wasExtOrBind++
  const probeTgt = `${e.source}${BINDING_SEP}${e.tgt}`
  const c = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, probeTgt, { kind: "binding" }, factsOf(e.repo), false, false)
  if (c.outcome === "bindingVerified") { cf.verified++; resolvedByClaim.set(e.label, (resolvedByClaim.get(e.label) ?? 0) + 1) }
  else if (c.outcome === "bindingRefuted") cf.refuted++
  else cf.unverified++
}
console.log(`\nCOUNTERFACTUAL — BINDING claim on unit-local bare reads (isBareRead, not isFieldRead, name NOT published by its own file):`)
console.log(`  claimable edges                      ${cf.claimed}`)
console.log(`  -> bindingVerified under the spelling ${cf.verified}`)
console.log(`  -> bindingRefuted (clause-4 defect)   ${cf.refuted}`)
console.log(`  -> bindingUnverified                  ${cf.unverified}`)
console.log(`  current outcome of those edges: resolved ${cf.wasResolved} · unresolved ${cf.wasUnresolved} · amb ${cf.wasAmb} · ext/bind ${cf.wasExtOrBind}`)
console.log(`  by type: ${[...resolvedByClaim].map(([t, n]) => `${t} ${n}`).join(" · ")}`)
console.log(`\nparsed ${parsed}/${files.length} file(s)`)
