// #912 part 1 census, corrected: adjacency is "same line, whitespace-only gap"
// (the jq site has one space between `)` and `{`). For every candidate, run the
// PRODUCTION entry on the file and report whether the callee name is published
// as a function — i.e. classify by outcome, not by tree shape alone.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))
const parser = new P(); parser.setLanguage(lang)
const { parseFile } = await import(path.join(ROOT, "src/ast/engine.ts"))

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e)
    let st: any; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith(".c") || e.endsWith(".h")) out.push(p)
  }
  return out
}
const REPOS = [
  ["jq", "/home/ishaq2321/bb_tests/repositories/jq"],
  ["sqlite", "/home/ishaq2321/bb_tests/repositories/sqlite"],
]
let total = 0
for (const [name, repo] of REPOS) {
  const files = walk(repo)
  let sites = 0
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    const root = parser.parse(src).rootNode
    const hits: any[] = []
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()!
      if (n.type === "ERROR") {
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i))
        const last = kids[kids.length - 1]
        if (last && last.type === "call_expression" && !last.isMissing) {
          const after = n.nextNamedSibling
          const gap = after && after.type === "compound_statement" && after.startPosition.row === last.endPosition.row
            ? src.slice(last.endIndex, after.startIndex) : null
          if (gap !== null && gap.trim() === "") {
            const before: any[] = []
            let s = last.previousNamedSibling
            while (s && before.length < 3) { before.push(s); s = s.previousNamedSibling }
            hits.push({ row: last.startPosition.row + 1, call: last.text.slice(0, 60), callee: last.childForFieldName("function")?.text ?? last.children?.[0]?.text ?? "", before: before.map((b: any) => `${b.type}:${JSON.stringify(b.text.slice(0, 14))}`).join(" ") })
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
    if (!hits.length) continue
    sites += hits.length; total += hits.length
    console.log(`[${name}] ${f.replace(repo + "/", "")} (${hits.length})`)
    for (const h of hits) console.log(`    L${h.row} callee=${h.callee} call=${JSON.stringify(h.call)} before=<${h.before}>`)
    // production outcome at these sites
    try {
      const res: any = await parseFile(f, src, { language: "c" } as any)
      for (const h of hits) {
        const pub = (res.symbols ?? []).filter((s: any) => s.name === h.callee && s.kind === "function")
        const anyNamed = (res.symbols ?? []).filter((s: any) => s.name === h.callee)
        console.log(`      -> published function ${h.callee}: ${pub.length ? `YES @${pub[0].range?.startLine} owner=${pub[0].ownerName ?? "-"}` : "NO"}${anyNamed.length && !pub.length ? ` (other kinds: ${anyNamed.map((s: any) => s.kind).join(",")})` : ""}`)
      }
    } catch (e: any) { console.log(`      parseFile failed: ${e?.message}`) }
  }
  console.log(`[${name}] candidate sites=${sites}`)
}
console.log(`TOTAL sites=${total}`)
