import * as fs from "fs"
import * as path from "path"
import { RealCppAnalyzer } from "../../../src/ast/real-cpp-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
function filesUnder(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) filesUnder(p, exts, out) }
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
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
  const mod: any = await import("../../../script/m14/differential")
  const repoDir = process.argv[2]
  const sample = seededPick(filesUnder(repoDir, ["cc", "h"]), 60, `${path.basename(repoDir)}:cpp:m14-f5`)
  const normTarget = (t: string) => t
  let missing = 0, unexplained = 0
  for (const f of sample) {
    const content = fs.readFileSync(f, "utf8")
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(content).rootNode
    const r: any = await new RealCppAnalyzer().analyze(root, content, path.relative(repoDir, f))
    const rels = (r.relationships ?? []).map((x: any) => ({ label: String(x.type).toLowerCase(), target: x.target }))
    const truth = [...mod.deriveTreeEdges(root, "cpp"), ...mod.deriveCppEdges(root), ...mod.deriveCppBareUses(root)]
    for (const te of truth) {
      if (!rels.some((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))) {
        missing++
        if (missing <= 10) console.log("MISSING", path.relative(repoDir, f), te.label, "->", te.target)
      }
    }
    for (const r of rels) {
      const hit = truth.some((te: any) => te.label === r.label && (normTarget(te.target) === normTarget(r.target) || String(te.target).includes(normTarget(r.target))))
      if (!hit) {
        // only report calls/uses like the lane's compared sets? lane compares all rels; print uses/calls only
        if (r.label === "uses" || r.label === "calls") {
          unexplained++
          if (unexplained <= 15) console.log("UNEXPLAINED", path.relative(repoDir, f), r.label, "->", r.target)
        }
      }
    }
  }
  console.log(`totals missing=${missing} unexplained=${unexplained}`);
}
main()
