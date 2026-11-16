import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
// Independent uses-recall census (Java): dumb-walk member reads, check analyzer coverage.
// Deliberately independent of analyzer internals: raw grammar walk vs emitted uses edges.
function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const pth = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) filesUnder(pth, out) }
    else if (e.name.endsWith(".java")) out.push(pth)
  }
  return out
}
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-java.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-java-analyzer"))
  const files = filesUnder("<corpus-root>/bb_tests/repositories/grails-core").slice(0, 25)
  let reads = 0, covered = 0
  const misses: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    // collect reads: field_access object.name where parent is not an assignment LHS
    const found: Array<{ recv: string; name: string; line: number; write: boolean }> = []
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "field_access") {
        const obj = n.childForFieldName("object")
        const fld = n.childForFieldName("field")
        if (obj && fld && fld.type === "identifier") {
          let par = n.parent, write = false, guard = 0
          while (par && guard++ < 4) {
            if (par.type === "assignment_expression" && par.namedChild(0)?.id === n.id) { write = true; break }
            par = par.parent
          }
          found.push({ recv: obj.text.split(".").pop() ?? obj.text, name: fld.text, line: n.startPosition.row + 1, write })
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
    }
    let r: any
    try { r = await new mod.RealJavaAnalyzer().analyze(root, src, path.basename(f)) } catch { continue }
    const usesTargets = new Set((r.relationships ?? []).filter((e: any) => e.type === "uses").map((e: any) => String(e.target)))
    for (const rd of found) {
      if (rd.write) continue
      reads++
      if (usesTargets.has(rd.name)) covered++
      else if (misses.length < 15) misses.push(`${path.basename(f)}:${rd.line} ${rd.recv}.${rd.name}`)
    }
  }
  console.log(`member-reads=${reads} covered=${covered} miss-rate=${((1 - covered / Math.max(1, reads)) * 100).toFixed(1)}%`)
  for (const m of misses) console.log("  MISS", m)
}
main()
