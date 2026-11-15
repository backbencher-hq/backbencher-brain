// go (round 3) — #889 A/B: HEAD's analyzer beside the current one, over real
// corpus files, attributed by surface.
//
// SELF-REGENERATING: the PRE side is materialized from a pinned commit into
// src/ast/zz-pre-889-go-analyzer.ts (class renamed on its declaration line, the
// only edit) and imported dynamically, so the comparison stays re-runnable after
// the working tree moves on:
//
//   bun script/m14/tmp/go-889-ab.ts <repoRoot> [limit] [preCommit]
//
// The reading recorded in reviews/go/third-review.md used the HEAD at
// measurement time (the last commit before this round's #889 fix).
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer as NOW } from "../../../src/ast/real-go-analyzer"

import { fileURLToPath } from "node:url"
const __dirname = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "")

const root = process.argv[2]
const limit = process.argv[3] ? parseInt(process.argv[3]) : 0
const preCommit = process.argv[4] ?? "HEAD"
const SNAPSHOT = path.resolve(__dirname, "..", "..", "..", "src/ast/zz-pre-889-go-analyzer.ts")
{
  const headSrc = execSync(`git show ${preCommit}:src/ast/real-go-analyzer.ts`, {
    encoding: "utf8",
    cwd: path.resolve(__dirname, "..", "..", ".."),
    maxBuffer: 64 * 1024 * 1024,
  })
  const patched = headSrc.replace(
    /^(export class RealGoAnalyzer\b.*)$/m,
    (m) => m.replace("export class RealGoAnalyzer", "export class RealGoAnalyzerPre889"),
  )
  if (patched === headSrc) throw new Error(`${preCommit} is not a PRE-fix analyzer — pin the commit before the change`)
  fs.writeFileSync(SNAPSHOT, patched)
  console.log(`PRE side materialized from ${preCommit} -> ${path.relative(process.cwd(), SNAPSHOT)}`)
}
const { RealGoAnalyzerPre889: PRE } = (await import(SNAPSHOT)) as any

const files: string[] = []
const walk = (d: string, depth = 0) => {
  if (depth > 16) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "vendor") continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith(".go")) files.push(p)
  }
}
walk(root)
files.sort()
if (limit) files.length = Math.min(files.length, limit)

const parser = await ASTEngine.getParser("go" as any)
const now = new NOW()
const pre = new PRE()

const symKey = (s: any) => `${s.name}|${s.kind}`
const relKey = (r: any) => `${r.type}|${r.source}|${r.target}|${r.line_number ?? ""}`
let filesChanged = 0
const symAdded: string[] = []
const symRemoved: string[] = []
const relAdded: { file: string; r: any }[] = []
const relRemoved: { file: string; r: any }[] = []
let groupedAdded = 0
let embeddedAdded = 0
const kindAdded: Record<string, number> = {}
// Countable rather than eyeballed: every added/removed edge is attributed by
// (a) its label, (b) the analyzer's own relationshipType, (c) whether the
// target is a raw source text (a dotted/qualified path) or a bare leaf — the
// R10 surface. This is what a review row cites.
const bump = (h: Record<string, number>, k: string) => { h[k] = (h[k] ?? 0) + 1 }
const relAddedByLabel: Record<string, number> = {}
const relRemovedByLabel: Record<string, number> = {}
const relAddedByRT: Record<string, number> = {}
const relRemovedByRT: Record<string, number> = {}
const relAddedRawTarget: Record<string, number> = {}
const relRemovedRawTarget: Record<string, number> = {}
const isRaw = (t: string) => /[.\[<>:]/.test(String(t))
// Why classify: the added-edge count must reconcile with the added-symbol
// count, or the delta contains a surface nobody named. `newTarget` = the edge
// exists because a symbol it names was just published; `newSource` = the
// source symbol is new; `other` = neither end is a new symbol and the row must
// be explained by a field rewrite (this bucket is printed, never hidden).
const relAddedClass: Record<string, number> = {}
const relAddedOther: string[] = []

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  let tree: any
  try {
    tree = parser.parse(src)
  } catch {
    continue
  }
  const rn: any = tree.rootNode
  if (!rn) continue
  const a: any = await now.analyze(rn, src, f)
  const b: any = await pre.analyze(rn, src, f)
  const rel = path.relative(root, f)
  const A = new Map((a.symbols ?? []).map((s: any) => [symKey(s), s]))
  const B = new Map((b.symbols ?? []).map((s: any) => [symKey(s), s]))
  const RA = new Set((a.relationships ?? []).map(relKey))
  const RB = new Set((b.relationships ?? []).map(relKey))
  let changed = false
  for (const [k, s] of A) {
    if (B.has(k)) continue
    symAdded.push(`${rel}: ${k}`)
    kindAdded[String(s.kind)] = (kindAdded[String(s.kind)] ?? 0) + 1
    if (s.metadata?.groupedFieldDeclaration) groupedAdded++
    if (s.metadata?.isEmbeddedField) embeddedAdded++
    changed = true
  }
  for (const k of B.keys()) {
    if (A.has(k)) continue
    symRemoved.push(`${rel}: ${k}`)
    changed = true
  }
  const newNames = new Set<string>()
  const newSources = new Set<string>()
  for (const [k, s] of A) {
    if (B.has(k)) continue
    newNames.add(String(s.name))
    newSources.add(String(s.name))
  }
  for (const r of a.relationships ?? []) {
    const k = relKey(r)
    if (RB.has(k)) continue
    relAdded.push({ file: rel, r })
    const cls = newSources.has(String(r.source))
      ? "newSource"
      : newNames.has(String(r.target))
        ? "newTarget"
        : "other"
    bump(relAddedClass, `${r.type}/${cls}`)
    if (cls === "other") relAddedOther.push(`${rel}: ${relKey(r)}  rt=${r.metadata?.relationshipType ?? "-"}`)
    bump(relAddedByLabel, String(r.type))
    bump(relAddedByRT, `${r.type}/${r.metadata?.relationshipType ?? "-"}`)
    if (isRaw(r.target)) bump(relAddedRawTarget, String(r.type))
    changed = true
  }
  for (const r of b.relationships ?? []) {
    const k = relKey(r)
    if (RA.has(k)) continue
    relRemoved.push({ file: rel, r })
    bump(relRemovedByLabel, String(r.type))
    bump(relRemovedByRT, `${r.type}/${r.metadata?.relationshipType ?? "-"}`)
    if (isRaw(r.target)) bump(relRemovedRawTarget, String(r.type))
    changed = true
  }
  if (changed) filesChanged++
}

console.log(
  JSON.stringify(
    {
      repo: root,
      files: files.length,
      filesChanged,
      symbolsAdded: symAdded.length,
      symbolsAddedByKind: kindAdded,
      groupedFieldSymbolsAdded: groupedAdded,
      embeddedFieldSymbolsAdded: embeddedAdded,
      symbolsRemoved: symRemoved.length,
      relationshipsAdded: relAdded.length,
      relationshipsRemoved: relRemoved.length,
      relAddedByLabel,
      relRemovedByLabel,
      relAddedByRelationshipType: relAddedByRT,
      relRemovedByRelationshipType: relRemovedByRT,
      relAddedWithRawTarget: relAddedRawTarget,
      relRemovedWithRawTarget: relRemovedRawTarget,
      relAddedByClass: relAddedClass,
    },
    null,
    1,
  ),
)
// The summary is ALSO written beside the probe: the console form is for reading,
// the file is what a review cites (so a `tail` on the terminal can never be the
// only copy of the round's delta).
fs.writeFileSync(
  path.resolve(__dirname, `go-889-ab.${path.basename(root)}.json`),
  JSON.stringify(
    {
      repo: root,
      files: files.length,
      filesChanged,
      symbolsAdded: symAdded.length,
      symbolsAddedByKind: kindAdded,
      groupedFieldSymbolsAdded: groupedAdded,
      embeddedFieldSymbolsAdded: embeddedAdded,
      symbolsRemoved: symRemoved.length,
      relationshipsAdded: relAdded.length,
      relationshipsRemoved: relRemoved.length,
      relAddedByLabel,
      relRemovedByLabel,
      relAddedByRelationshipType: relAddedByRT,
      relRemovedByRelationshipType: relRemovedByRT,
      relAddedWithRawTarget: relAddedRawTarget,
      relRemovedWithRawTarget: relRemovedRawTarget,
      relAddedByClass: relAddedClass,
    },
    null,
    1,
  ) + "\n",
)

const show = (name: string, arr: string[], n = 20) => {
  console.log(`\n${name} (${arr.length}, first ${n}):`)
  for (const s of arr.slice(0, n)) console.log("  " + s)
}
const showRels = (name: string, arr: { file: string; r: any }[], n = 20) => {
  console.log(`\n${name} (${arr.length}, first ${n}):`)
  for (const x of arr.slice(0, n)) {
    console.log(`  ${x.file}: ${relKey(x.r)}  rt=${x.r.metadata?.relationshipType ?? "-"}`)
  }
}
show("symbolsRemoved", symRemoved)
console.log(`\nrelAddedOther (${relAddedOther.length}, first 20):`)
for (const s of relAddedOther.slice(0, 20)) console.log("  " + s)
showRels("relationshipsAdded", relAdded)
showRels("relationshipsRemoved", relRemoved)
