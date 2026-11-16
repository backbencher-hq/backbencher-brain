// script/m14/tmp/cs-u2331-probe.ts — the 900-file depth draw's ONE unexplained
// edge: `calls StartSSHProcess -> false` at
// powershell/src/System.Management.Automation/engine/remoting/common/RunspaceConnectionInfo.cs:2331.
// What is that line, what does the analyzer think the callee expression is, and
// what does the grammar actually say the node is?
import * as fs from "fs"
import * as path from "path"

const F = "<corpus-root>/bb_tests/repositories/powershell/src/System.Management.Automation/engine/remoting/common/RunspaceConnectionInfo.cs"

async function main() {
  const ROOT = process.cwd()
  const src = fs.readFileSync(F, "utf8")
  const lines = src.split("\n")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const res: any = await ASTEngine.parseFile(F, src)
  const hits = (res.relationships ?? []).filter((r: any) => String(r.target) === "false")
  console.log(`edges targeting "false": ${hits.length}`)
  for (const r of hits) {
    console.log(`  ${r.type} ${r.source} -> ${r.target} line=${r.line_number ?? "-"} meta=${JSON.stringify(r.metadata)}`)
  }
  for (const ln of [2330, 2331, 2332]) console.log(`  src ${ln}: ${JSON.stringify(lines[ln - 1]?.trim())}`)

  // The grammar's view of that line.
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P()
  p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  const dump = (n: any, dp: number, max: number) => {
    if (!n || dp > max) return
    console.log(
      "  ".repeat(dp) +
        `${n.type} [${n.startPosition.row + 1}:${n.startPosition.column}..${n.endPosition.row + 1}:${n.endPosition.column}] :: ${JSON.stringify((n.text ?? "").slice(0, 40))}`,
    )
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), dp + 1, max)
  }
  const walk = (n: any) => {
    if (n.startPosition.row + 1 <= 2333 && n.endPosition.row + 1 >= 2330 && n.type === "invocation_expression") {
      console.log(`\ninvocation_expression at ${n.startPosition.row + 1}:`)
      dump(n, 2, 3)
      console.log(`  field function = ${n.childForFieldName("function")?.type} ${JSON.stringify(n.childForFieldName("function")?.text)}`)
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
}

main()
