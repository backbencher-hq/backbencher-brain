import * as fs from "fs"
import * as path from "path"
import { RealErlangAnalyzer } from "../../../src/ast/real-erlang-analyzer"
const ROOT = "/home/sano/ishaq/backbencher-brain"
const D = "/home/sano/ishaq/bb_tests/er3-perf"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))
  const REPO = "/home/sano/ishaq/bb_tests/repositories"
  const files: string[] = []
  for (const d of ["otp", "rebar3", "cowboy"]) {
    const base = path.join(REPO, d); if (!fs.existsSync(base)) continue
    const st = [base]
    while (st.length) { const cur = st.pop()!; let es: fs.Dirent[]; try { es = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
      for (const e of es) { if (e.name === ".git") continue; const p = path.join(cur, e.name); if (e.isDirectory()) st.push(p); else if (e.name.endsWith(".erl")) files.push(p) } }
  }
  files.sort()
  const stride = Math.max(1, Math.floor(files.length / 120))
  const sample = files.filter((_, i) => i % stride === 0).slice(0, 120)
  const parsed: any[] = []
  for (const f of sample) { const c = fs.readFileSync(f, "utf8"); parsed.push({ f, c, root: parser.parse(c)!.rootNode }) }
  const variants: [string, any][] = [["ER3 (current)", new RealErlangAnalyzer()]]
  for (const [n, f] of [["minus type-refs", "ablate-notype.ts"], ["minus pattern-climb", "ablate-nopat.ts"], ["minus param payload", "ablate-noparam.ts"]] as [string, string][]) {
    const m: any = await import(path.join(D, f))
    variants.push([n, new m.RealErlangAnalyzer()])
  }
  const old: any = await import(path.join(D, "old-erlang-analyzer.ts"))
  variants.push(["pre-ER3", new old.RealErlangAnalyzer()])
  for (const [name, a] of variants) {
    a.analyze(parser.parse("f() -> ok.\n")!.rootNode, "f() -> ok.\n", "w.erl")
    let best = Number.POSITIVE_INFINITY
    for (let rep = 0; rep < 3; rep++) {
      const t0 = Date.now()
      for (const { f, c, root } of parsed) a.analyze(root, c, f)
      best = Math.min(best, Date.now() - t0)
    }
    let rels = 0
    for (const { f, c, root } of parsed) rels += (a.analyze(root, c, f) as any).relationships.length
    console.log(`${name.padEnd(22)} best-of-3 ${String(best).padStart(6)} ms   ${String(rels).padStart(6)} relationships   ${(best / rels).toFixed(4)} ms/rel`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
