// Line ACCURACY, not line presence.
//
// A present-but-wrong line is worse than an absent one, so this samples rows per
// label and asks a mechanical question: does the edge's TARGET text actually
// appear on the line the edge claims? For `contains` the contract is the MEMBER's
// own declaration line (M59 #925); for `references` it is the line the TYPE NAME
// is written on; for `uses` the line the NAME is written on.
//
// The check is deliberately loose — a target may be a synthetic name, a
// normalised type, or a receiver that is not written as a bare word — so a miss is
// a CANDIDATE, adjudicated by reading the source, not a verdict.

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "cats-effect"
const drawFile = process.argv[3]

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}
// A target is "written" if any of its leaf forms appears on the line.
const forms = (t: string): string[] => {
  const out = new Set<string>()
  const s0 = String(t)
  out.add(s0)
  out.add(s0.replace(/`/g, ""))
  const seg = s0.split(".")
  if (seg.length > 1) { out.add(seg[seg.length - 1]); out.add(seg[0]) }
  if (s0.startsWith("anonymous_")) {
    const tail = s0.slice("anonymous_".length)
    if (tail && tail !== "object") { out.add(tail); out.add(tail.split(".").pop()!) }
    else out.add("new")
  }
  if (s0 === "constructor") out.add("class")
  if (/^given_\d+$/.test(s0)) out.add("given")
  return [...out].filter((x) => x.length > 0)
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()
  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)

  const ok: Record<string, number> = {}
  const miss: Record<string, number> = {}
  const samples: Record<string, string[]> = {}
  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    const src = fs.readFileSync(fp, "utf8")
    const lines = src.split("\n")
    const res: any = analyzer.analyze(parser.parse(src).rootNode, src, fp)
    for (const r of res.relationships ?? []) {
      const t = String(r.type)
      const ln = r.line_number
      if (!ln || ln < 1 || ln > lines.length) { miss[t] = (miss[t] ?? 0) + 1; continue }
      const line = lines[ln - 1]
      const hit = forms(r.target).some((f) => line.includes(f))
      if (hit) ok[t] = (ok[t] ?? 0) + 1
      else {
        miss[t] = (miss[t] ?? 0) + 1
        samples[t] = samples[t] ?? []
        if (samples[t].length < 5) {
          samples[t].push(`    ${f}:${ln}  ${t} ${r.source} -> ${r.target}  | ${line.trim().slice(0, 90)}`)
        }
      }
    }
  }
  console.log(`# ${repo}: ${files.length} files — target-text-on-claimed-line, per label`)
  for (const t of [...new Set([...Object.keys(ok), ...Object.keys(miss)])].sort()) {
    const a = ok[t] ?? 0
    const b = miss[t] ?? 0
    console.log(`   ${t.padEnd(13)} on-line ${String(a).padStart(7)}   NOT-on-line ${String(b).padStart(6)}   ${((a / Math.max(1, a + b)) * 100).toFixed(1)}%`)
  }
  for (const [t, arr] of Object.entries(samples)) {
    console.log(`--- ${t}: the not-on-line rows are CANDIDATES, adjudicate by reading the source ---`)
    for (const s of arr) console.log(s)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
