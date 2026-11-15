import * as fs from "fs"
import * as path from "path"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
function filesUnder(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|target|vendor)/.test(e.name)) filesUnder(p, exts, out) }
    else if (exts.some((x) => e.name.endsWith("." + x))) out.push(p)
  }
  return out
}
function seededPick<T>(items: T[], n: number, seedStr: string): T[] {
  let h = 2166136261
  for (const c of seedStr) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  const idx = items.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h + i), 2246822519)
    const j = Math.abs(h) % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx.slice(0, n).map(i => items[i])
}
function lastSegment(t: string): string {
  const parts = String(t).replace(/^<\s*/, "").split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? t
}
function normTarget(t: string): string {
  return lastSegment(String(t).replace(/<.*$/, "").replace(/\[.*$/, "").trim())
}
const COMPARED = new Set(["extends", "implements", "instantiates", "overrides", "calls", "uses"])
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm")))
  const mod: any = await import("../../../script/m14/differential")
  const repoDir = process.argv[2]
  const seedTag = process.argv[3] ?? "m14-f5"
  const sampleN = Number(process.argv[4] ?? 60)
  const sample = seededPick(filesUnder(repoDir, ["rb"]), sampleN, `${path.basename(repoDir)}:ruby:${seedTag}`)
  let missing = 0, unexplained = 0
  for (const f of sample) {
    const content = fs.readFileSync(f, "utf8")
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(content).rootNode
    const r: any = await new RealRubyAnalyzer().analyze(root, content, path.relative(repoDir, f))
    const seen = new Set<string>()
    const rels = (r.relationships ?? [])
      .map((x: any) => ({ label: String(x.type).toLowerCase(), target: String(x.target), confidence: typeof x.confidence === "number" ? x.confidence : 1 }))
      .filter((x: any) => COMPARED.has(x.label))
      .filter((x: any) => { const k = x.label + "|" + x.target; if (seen.has(k)) return false; seen.add(k); return true })
    const truth = mod.deriveRubyEdges(root)
    for (const te of truth) {
      if (!rels.some((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))) {
        missing++
        if (missing <= 10) console.log("MISSING", path.relative(repoDir, f), te.label, "->", te.target)
      }
    }
    for (const r of rels) {
      const hit = truth.some((te: any) => te.label === r.label && (normTarget(te.target) === normTarget(r.target) || String(te.target).includes(normTarget(r.target))))
      if (hit) continue
      if (r.confidence < 0.7) continue
      unexplained++
      if (unexplained <= 15) console.log("UNEXPLAINED", path.relative(repoDir, f), r.label, "->", r.target)
    }
  }
  console.log(`totals missing=${missing} unexplained=${unexplained}`);
}
main()
