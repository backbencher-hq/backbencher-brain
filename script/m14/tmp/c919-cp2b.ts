// #919: the CP2 spelling, censused with the ANALYZER'S OWN predicate (not a
// re-implementation) — each site's declared name from `getFunctionDetails`, the
// shape from `isMacroFunctionShape`, and whether the node has a BODY (a
// decorator-shaped declaration must not be counted as a macro-declared body).
//   bun script/m14/tmp/c919-cp2b.ts
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const after = JSON.parse(readFileSync("/tmp/c919-after.json", "utf8"))
const { RealCppAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-cpp-analyzer.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)
const an: any = new RealCppAnalyzer()

const files: string[] = []
for (const repo of ["fmt", "nlohmann-json"]) {
  const collect = (dir: string) => {
    let entries: any[] = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) collect(p)
      else if (/\.(cpp|cc|cxx|hpp|hh|h)$/.test(e.name)) files.push(p)
    }
  }
  collect(path.join(CORPUS, repo))
}

let sites = 0, withBody = 0, globalReads = 0
const macroCount = new Map<string, number>()
const decoratorLike: string[] = []
for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  const rel = path.relative(CORPUS, f)
  const root = parser.parse(src).rootNode
  const found: Array<{ line: number; end: number; macro: string }> = []
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()!
    if (n.type === "function_definition") {
      const det = an.getFunctionDetails(n)
      if (det && !det.isDestructor && !String(det.name).startsWith("operator") && an.isMacroFunctionShape(n, det.name)) {
        const body = n.childForFieldName("body")
        found.push({ line: n.startPosition.row + 1, end: n.endPosition.row + 1, macro: det.name })
        sites++
        if (body) withBody++
        else if (decoratorLike.length < 6) decoratorLike.push(`${rel}:${n.startPosition.row + 1} ${det.name} ${JSON.stringify(n.text.slice(0, 70))}`)
        macroCount.set(det.name, (macroCount.get(det.name) ?? 0) + 1)
      }
    }
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
  if (found.length === 0) continue
  const dump = after[rel] ?? {}
  for (const s of found) {
    globalReads += (dump.rels ?? []).filter((r: string) => {
      const i = r.lastIndexOf("|"), j = r.lastIndexOf("|", i - 1)
      const line = Number(r.slice(i + 1))
      return line >= s.line && line <= s.end && r.slice(0, i).split("|")[0] === "uses" && r.slice(i + 1) === undefined ? false : line >= s.line && line <= s.end
    }).filter((r: string) => { const i = r.lastIndexOf("|"), j = r.lastIndexOf("|", i - 1); return r.slice(0, r.indexOf("|")) === "uses" && r.slice(r.indexOf("|") + 1, j) === "global" }).length
  }
}
console.log(`CP2 sites (analyzer predicate): ${sites} — with a body: ${withBody}`)
console.log(`by macro: ${[...macroCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}×${v}`).join(", ")}`)
console.log(`relationships still sourced at \`global\` inside those spans: ${globalReads}`)
console.log(`\nbodyless (decorator-shaped) examples: ${decoratorLike.join(" || ")}`)
