/**
 * READ-ONLY PROBE — F5 over the surface the shebang rule just OPENED.
 *
 * The routing change admitted 339 extensionless files whose extraction had never
 * been through the differential. Shipping a wider lens without measuring what is
 * behind it is the same unverified-surface mistake in a new place, so the
 * independent oracle runs here over EXACTLY the set the new rule admits — the
 * extensionless files with a shell shebang — and not over the .sh files that
 * were already covered.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, lstatSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"
import { deriveBashEdges } from "../differential"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = ["nvm", "rbenv", "ohmyzsh", "otp", "fsharp"]

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(process.cwd(), "wasm/tree-sitter-bash.wasm"))))

let files = 0, truth = 0, covered = 0, symbols = 0, rels = 0, unlined = 0, srcNotSymbol = 0
const dis: { kind: string; label: string; from: string; target: string; file: string }[] = []
const all: { kind: string; label: string; target: string }[] = []

for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .trim().split("\n").filter(Boolean)
  } catch { continue }
  let rFiles = 0, rTruth = 0, rCovered = 0, rRels = 0
  for (const rel of tracked) {
    const base = rel.slice(rel.lastIndexOf("/") + 1)
    if (base.includes(".") && !process.env.BB_ALL) continue // extensionless-only unless BB_ALL
    const abs = path.join(dir, rel)
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    if (text.length > 512 * 1024) continue
    files++; rFiles++
    const tree = parser.parse(text)
    if (!tree) continue
    const truthEdges = deriveBashEdges(tree.rootNode as any, base)
    tree.delete?.()
    let relsOut: any[] = []
    let symsOut: any[] = []
    try {
      const r: any = await parseFile(abs, dir)
      relsOut = r.relationships ?? []
      symsOut = r.symbols ?? []
    } catch { /* empty analyzer side */ }
    symbols += symsOut.length
    rels += relsOut.length
    rRels += relsOut.length
    const declared = new Set(symsOut.map((s: any) => s.name))
    for (const x of relsOut) {
      if (!(typeof x.line_number === "number" && x.line_number > 0)) unlined++
      if (!declared.has(String(x.source ?? ""))) srcNotSymbol++
    }
    const norm = relsOut.map((x: any) => ({ label: String(x.type ?? x.relationshipType ?? ""), target: String(x.target ?? x.to ?? "") }))
    truth += truthEdges.length; rTruth += truthEdges.length
    for (const te of truthEdges) {
      if (norm.some((r) => r.label === te.label && r.target === te.target)) { covered++; rCovered++ }
      else { all.push({ kind: "MISSING", label: te.label, target: te.target }); if (dis.length < 60) dis.push({ kind: "MISSING", label: te.label, from: te.from, target: te.target, file: `${repo}/${rel}` }) }
    }
    for (const r of norm) {
      if (truthEdges.some((te) => te.label === r.label && te.target === r.target)) continue
      { all.push({ kind: "UNEXPLAINED", label: r.label, target: r.target }); if (dis.length < 60) dis.push({ kind: "UNEXPLAINED", label: r.label, from: "(analyzer)", target: r.target, file: `${repo}/${rel}` }) }
    }
  }
  console.log(`${repo.padEnd(9)} admitted=${String(rFiles).padStart(4)}  truth=${String(rTruth).padStart(5)}  covered=${String(rCovered).padStart(5)} (${rTruth ? ((100 * rCovered) / rTruth).toFixed(1) : "0"}%)  rels=${rRels}`)
}

console.log(`\n=== the newly-admitted surface, through production parseFile ===`)
console.log(`files=${files} truth=${truth} covered=${covered} (${truth ? ((100 * covered) / truth).toFixed(1) : "0"}%)`)
console.log(`MISSING=${truth - covered}  UNEXPLAINED=${dis.filter((d) => d.kind === "UNEXPLAINED").length}`)
console.log(`symbols=${symbols} relationships=${rels} unlined=${unlined} edgeSourcesNotASymbol=${srcNotSymbol}`)
const byLabel = new Map<string, { m: number; u: number; s: string[] }>()
for (const d of dis) {
  const k = `${d.kind} ${d.label}`
  const row = byLabel.get(k) ?? { m: 0, u: 0, s: [] }
  if (d.kind === "MISSING") row.m++; else row.u++
  if (row.s.length < 4) row.s.push(`${d.file} ${d.from} -> ${d.target}`)
  byLabel.set(k, row)
}
console.log("\n=== EVERY disagreement class, counted (sampling only the first few) ===")
const full = new Map<string, { m: number; u: number; s: string[] }>()
for (const d of all) {
  const k = `${d.kind} ${d.label}`
  const row = full.get(k) ?? { m: 0, u: 0, s: [] }
  if (d.kind === "MISSING") row.m++; else row.u++
  if (row.s.length < 5) row.s.push(d.target)
  full.set(k, row)
}
for (const [k, row] of [...full.entries()].sort()) console.log(`  ${k.padEnd(24)} missing=${String(row.m).padStart(4)} unexplained=${String(row.u).padStart(4)}  targets: ${row.s.join(" | ")}`)
for (const [k, row] of [...byLabel.entries()].sort()) {
  console.log(`--- ${k}: missing=${row.m} unexplained=${row.u}`)
  for (const s of row.s) console.log(`      ${s}`)
}
