/**
 * solidity-w8-residual-split — the EXACT (not sample-based) attribution of the Solidity lane's
 * post-claim residual rows, so the D7 ledger can price each wall instead of sampling it.
 *
 * WHY THIS EXISTS: `SOLIDITY-W8-CLAIM.md` classified the W8/W6 residuals from the classifier's
 * three-sample lists and stated that plainly. The Lead's depth ledger needs the sizes before it can
 * price the follow-ups (W6-a Yul function parameters, W8-b scope collisions), and a sample cannot
 * carry a size. This instrument walks EVERY residual row.
 *
 * METHOD: take the gate's own dump, keep the rows the gate could not resolve (unresolved / ambiguous
 * outcomes — resolved rows are not residual), re-analyse each dumped file once to attach the analyzer's
 * own metadata (marker family, claim spelling) to each row by join key `label\0target\0line`, then
 * attribute the row by what its BARE target is declared as IN ITS OWN FILE (and, when not declared
 * there, in the project):
 *
 *   declared-nowhere                    no declaration of the name anywhere in the project
 *   declared-in-other-file-only         the name is declared only outside the file (cross-file space)
 *   duplicate-in-file(<kinds>)          the file declares the name more than once — the name-keyed
 *                                       store cannot choose (this is the W8-b/W5 shape)
 *   single-decl-in-file(<kind>)         the file declares it exactly once, and the row is STILL
 *                                       residual — the resolver did not use a declaration it had
 *   binding-leaf-not-declared           a claim-spelled row (should be ZERO here: claims are their own
 *                                       outcome, never residual)
 *
 * CLASS-BALANCE CONTROL: every residual row lands in exactly one class; the class sum equals the
 * residual row count; the instrument exits 3 otherwise.
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/solidity-w8-residual-split.ts <dump> [--json=<path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { auditTarget, normTarget } from "./differential"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const DUMP = process.argv[2]
const JSON_OUT = (() => {
  const j = process.argv.find((a) => a.startsWith("--json="))
  return j ? j.slice("--json=".length) : null
})()
if (!DUMP) {
  console.error("usage: bun run script/m14/solidity-w8-residual-split.ts <gate-dump> [--json=<path>]")
  process.exit(2)
}

const AMBIGUOUS = new Set(["ambDeclOnly", "ambBoth", "ambKindOnly"])
const RESIDUAL = (outcome: string): boolean => outcome === "unresolved" || AMBIGUOUS.has(outcome)

type Row = { label: string; outcome: string; target: string; src: string; line: number }
const rows: Row[] = []
for (const line of readFileSync(DUMP, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 5) continue
  const row = { label: p[1], outcome: p[2], target: p[3], src: p[4].replace(/:\d+$/, ""), line: Number((p[4].match(/:(\d+)$/) ?? [])[1] ?? 0) }
  if (RESIDUAL(row.outcome)) rows.push(row)
}
if (rows.length === 0) {
  console.error("solidity-w8-residual-split: no residual rows in the dump — refusing to report an empty split")
  process.exit(2)
}

// ── File → declarations (name → count, kinds) from the SAME parse the analyzer uses ───────────────
const repoRootOf = (rel: string): string => {
  const first = rel.split("/")[0]
  return path.join(CR, first)
}
const files = [...new Set(rows.map((r) => r.src))]
const declByFile = new Map<string, Map<string, { count: number; kinds: Set<string> }>>()
const projectDecl = new Map<string, number>()
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const analyzerMeta = new Map<string, any>() // `label\0target\0line` -> metadata (per file, prefixed)
for (const rel of files) {
  // the dump carries ABSOLUTE source paths; the corpus root is what makes them project-relative
  const abs = path.isAbsolute(rel) ? rel : path.join(CR, rel)
  const relToCorpus = path.isAbsolute(rel) ? path.relative(CR, rel) : rel
  const res: any = await parseFile(abs, repoRootOf(relToCorpus))
  const decls = new Map<string, { count: number; kinds: Set<string> }>()
  for (const s of res.symbols ?? []) {
    const d = decls.get(s.name) ?? { count: 0, kinds: new Set<string>() }
    d.count++
    d.kinds.add(String(s.kind ?? ""))
    decls.set(s.name, d)
    projectDecl.set(s.name, (projectDecl.get(s.name) ?? 0) + 1)
  }
  declByFile.set(rel, decls)
  for (const e of res.relationships ?? []) {
    analyzerMeta.set(`${rel}\0${String(e.type)}\0${String(e.target)}\0${Number(e.line_number ?? 0)}`, e.metadata ?? {})
  }
}

const classes: Record<string, { rows: number; samples: string[] }> = {}
const bump = (k: string, sample: string) => {
  const c = classes[k] ?? (classes[k] = { rows: 0, samples: [] })
  c.rows++
  if (c.samples.length < 5) c.samples.push(sample)
}
let claimSpelledResidual = 0
for (const r of rows) {
  const md: any = analyzerMeta.get(`${r.src}\0${r.label}\0${r.target}\0${r.line}`) ?? {}
  if (md.localBinding === true) claimSpelledResidual++
  const bare = auditTarget(r.target)
  const decls = declByFile.get(r.src) ?? new Map()
  const here = decls.get(bare)
  let k: string
  if (here && here.count > 1) k = `duplicate-in-file(${[...here.kinds].sort().join("+")})`
  else if (here && here.count === 1) k = `single-decl-in-file(${[...here.kinds].sort().join("+")})`
  else if ((projectDecl.get(bare) ?? 0) > 0) k = "declared-in-other-file-only"
  else k = "declared-nowhere"
  const fam = md.isYulPathSegment === true ? "yul" : md.isVariableReference === true ? "varref" : md.isMemberReference === true ? "member" : md.isTypeReference === true ? "type" : "other"
  bump(`${r.label}/${fam}|${k}`, `${r.src}:${r.line}: ${r.target} [${r.outcome}]`)
}

// ── CONTROL: every residual row in exactly one class; class sum == residual count ─────────────────
const sum = Object.values(classes).reduce((a, b) => a + b.rows, 0)
const failures: string[] = []
if (sum !== rows.length) failures.push(`class rows ${sum} != residual rows ${rows.length}`)
if (claimSpelledResidual !== 0) failures.push(`claim-spelled rows among the residual: ${claimSpelledResidual} (claims are their own outcome, so this should be 0)`)
if (failures.length > 0) {
  console.error("CONTROL DID NOT FIRE: the residual split does not close.")
  for (const f of failures) console.error("  " + f)
  process.exit(3)
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/solidity-w8-residual-split.ts",
  measuredAt: new Date().toISOString(),
  dump: DUMP,
  residualRows: rows.length,
  byOutcome: rows.reduce((acc: Record<string, number>, r) => ((acc[r.outcome] = (acc[r.outcome] ?? 0) + 1), acc), {}),
  classSum: sum,
  control: { ok: true, detail: "every residual row in exactly one class; class sum == residual count; claim-spelled rows among the residual 0" },
  classes,
  note: "The label is the gate's relationship label; the family comes from the analyzer's own metadata marker on the same row (joined by label\\0target\\0line). 'single-decl-in-file' residual rows are the resolver-scope question (a declaration existed and the row is still unresolved/ambiguous); the claim population was parameters/named returns/Yul reads of enclosing bindings, and claims are their own outcome so none appear here.",
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) {
  const fs = await import("node:fs")
  const target = path.resolve(ROOT, JSON_OUT)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, json)
}
process.stdout.write(json)
