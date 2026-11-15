// R10 A/B (the #917/#918 pattern): HEAD's analyzer beside the current one, over
// real corpus files, through both analyzers' own `analyze()`. HEAD predates the
// R7, R8 AND R10 changes; R7 and R8 were already measured at 0 symbols / 0
// relationships, so every symbol-or-relationship delta here is R10's, and this
// script attributes it so the claim is checkable rather than asserted.
//
// SELF-REGENERATING: the PRE side is materialized from a pinned commit into
// src/ast/zz-pre-r10-rust-analyzer.ts (the class renamed on its declaration
// line, which is the only edit), imported dynamically and left on disk so a
// review can diff it against the current file. Nothing is hand-maintained, so
// the A/B stays re-runnable after the working tree moves on — the commit to
// mine is an ARGUMENT:
//
//   bun script/m14/tmp/rust-798-r10-ab.ts <repoRoot> [limit] [preCommit]
//
// The reading recorded in reviews/rust/fifth-review.md used `dfefae2e` (HEAD at
// measurement time, i.e. the last commit before this round's R10 fix).
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { ASTEngine } from "../../../src/ast/engine"
import { RealRustAnalyzer as NOW } from "../../../src/ast/real-rust-analyzer"

import { fileURLToPath } from "node:url"
const __dirname = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "")

const root = process.argv[2]
const preCommit = process.argv[4] ?? "HEAD"
const SNAPSHOT = path.resolve(__dirname, "..", "..", "..", "src/ast/zz-pre-r10-rust-analyzer.ts")
{
  const headSrc = execSync(`git show ${preCommit}:src/ast/real-rust-analyzer.ts`, {
    encoding: "utf8",
    cwd: path.resolve(__dirname, "..", "..", ".."),
    maxBuffer: 64 * 1024 * 1024,
  })
  const patched = headSrc.replace(
    /^(export class RealRustAnalyzer\b.*)$/m,
    (m) => m.replace("export class RealRustAnalyzer", "export class RealRustAnalyzerPreR10"),
  )
  if (patched === headSrc) {
    throw new Error(`${preCommit} is not a PRE-R10 analyzer (its class is not RealRustAnalyzer) — pin the commit before the fix`)
  }
  fs.writeFileSync(SNAPSHOT, patched)
  console.log(`PRE side materialized from ${preCommit} -> ${path.relative(process.cwd(), SNAPSHOT)}`)
}
const { RealRustAnalyzerPreR10: PRE } = (await import(SNAPSHOT)) as any
const limit = process.argv[3] ? parseInt(process.argv[3]) : 0
const files: string[] = []
const walk = (d: string, depth = 0) => {
  if (depth > 14) return
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target" || e.name === "node_modules") continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith(".rs")) files.push(p)
  }
}
walk(root)
files.sort()

const parser = await ASTEngine.getParser("rust" as any)
const now = new NOW()
const pre = new PRE()

// The delta classes this script must separate. A symbol's IDENTITY is
// (name, kind) — parameters are R7's surface (a param name is not a symbol), so
// they are keyed separately and never mixed into the name delta.
const symKey = (s: any) => `${s.name}|${s.kind}`
const paramKey = (s: any) =>
  `${s.name}|${(s.parameters ?? []).map((p: any) => `${p.name}:${p.type}`).join(",")}`
const relKey = (r: any) => `${r.type}|${r.source}|${r.target}|${r.line_number ?? ""}`

let filesChanged = 0
const symAdded: string[] = []
const symRemoved: string[] = []
const relAdded: string[] = []
const relRemoved: string[] = []
const paramChanged: string[] = []
const mdChanged: string[] = []
const fwChanged: string[] = []

for (const f of files) {
  if (limit && files.indexOf(f) >= limit) break
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
  const A = new Set((a.symbols ?? []).map(symKey))
  const B = new Set((b.symbols ?? []).map(symKey))
  const RA = new Set((a.relationships ?? []).map(relKey))
  const RB = new Set((b.relationships ?? []).map(relKey))
  let changed = false
  for (const x of A) if (!B.has(x)) { symAdded.push(`${rel}: ${x}`); changed = true }
  for (const x of B) if (!A.has(x)) { symRemoved.push(`${rel}: ${x}`); changed = true }
  for (const x of RA) if (!RB.has(x)) { relAdded.push(`${rel}: ${x}`); changed = true }
  for (const x of RB) if (!RA.has(x)) { relRemoved.push(`${rel}: ${x}`); changed = true }
  // R7's surface: the parameter list of every function/method.
  const PA = new Map((a.symbols ?? []).map((s: any) => [symKey(s), paramKey(s)]))
  const PB = new Map((b.symbols ?? []).map((s: any) => [symKey(s), paramKey(s)]))
  for (const [k, v] of PA) if (PB.has(k) && PB.get(k) !== v) { paramChanged.push(`${rel}: ${k} ${JSON.stringify(PB.get(k))} -> ${JSON.stringify(v)}`); changed = true }
  // R10's metadata surface: `implementedType`, the unnamed impl's own spelling.
  const MA = new Map((a.symbols ?? []).map((s: any) => [symKey(s), s.metadata?.implementedType]))
  const MB = new Map((b.symbols ?? []).map((s: any) => [symKey(s), s.metadata?.implementedType]))
  for (const [k, v] of MA) if (v !== undefined && MB.get(k) !== v) { mdChanged.push(`${rel}: ${k} implementedType=${JSON.stringify(v)}`); changed = true }
  const fa = a.metadata?.framework, fb = b.metadata?.framework
  if (fa !== fb) { fwChanged.push(`${rel}: ${JSON.stringify(fb)} -> ${JSON.stringify(fa)}`); changed = true }
  if (changed) filesChanged++
}

console.log(
  JSON.stringify(
    {
      repo: root,
      files: Math.min(files.length, limit || files.length),
      filesChanged,
      symbolsAdded: symAdded.length,
      symbolsRemoved: symRemoved.length,
      relationshipsAdded: relAdded.length,
      relationshipsRemoved: relRemoved.length,
      relationshipTargetsAdded: [...new Set(relAdded.map((s) => s.split("|").slice(1, 3).join("|")))].length,
      paramListsChanged: paramChanged.length,
      implementedTypeMetadataChanged: mdChanged.length,
      frameworkRawChanged: fwChanged.length,
    },
    null,
    1,
  ),
)
const show = (name: string, arr: string[], n = 40) => {
  console.log(`\n${name} (${arr.length}):`)
  for (const s of arr.slice(0, n)) console.log("  " + s)
}
show("symbolsAdded", symAdded)
show("symbolsRemoved", symRemoved)
show("relationshipsAdded", relAdded)
show("relationshipsRemoved", relRemoved)
show("implementedTypeMetadataChanged", mdChanged)
console.log(`\nparamListsChanged: ${paramChanged.length} (R7's surface, counted not listed)`)
console.log(`frameworkRawChanged: ${fwChanged.length} (R8's surface, counted not listed)`)
