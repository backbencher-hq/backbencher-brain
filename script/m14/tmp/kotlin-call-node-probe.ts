// M59 (#825): what does tree-sitter-kotlin call a call's callee, and which node
// carries the NAME? Measured from the pinned wasm, so the line rule can be read
// off the grammar instead of assumed.
import * as fs from "fs"
import * as path from "path"

const SRC = `package lines

class Chains {
  fun chained(s: String): String {
    return s
      .trim()
      .toUpperCase()
  }

  fun built(n: Int): StringBuilder {
    return StringBuilder()
      .append(n)
  }
}
`

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const wasm = fs.readdirSync(path.join(ROOT_CONST, "wasm")).find((f) => f.includes("kotlin"))
  if (!wasm) throw new Error("no kotlin wasm found")
  const lang = await L.load(fs.readFileSync(path.join(ROOT_CONST, "wasm", wasm)))
  const parser = new P()
  parser.setLanguage(lang)
  const tree = parser.parse(SRC)

  const lines = SRC.split("\n")
  const visit = (n: any, depth: number): void => {
    if (n.type === "call_expression") {
      const at = `${n.startPosition.row + 1}:${n.startPosition.column}`
      console.log(`${"  ".repeat(depth)}call_expression ${at} :: ${JSON.stringify(n.text.split("\n")[0].slice(0, 40))}`)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        console.log(`${"  ".repeat(depth + 1)}named[${i}] ${c.type} @${c.startPosition.row + 1} :: ${JSON.stringify(c.text.split("\n")[0].slice(0, 40))}`)
      }
      // field names, if the grammar exposes any
      for (const f of ["callee", "function", "name", "navigation", "arguments", "value_arguments"]) {
        try {
          const node = n.childForFieldName?.(f)
          if (node) console.log(`${"  ".repeat(depth + 1)}field ${f} -> ${node.type} @${node.startPosition.row + 1}`)
        } catch {
          /* field absent */
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) visit(c, depth + 1)
    }
  }
  visit(tree.rootNode, 0)
  console.log("=== source, for reference ===")
  for (let i = 0; i < lines.length; i++) console.log(`${i + 1}| ${lines[i]}`)
}

const ROOT_CONST = "<corpus-root>/mcp/backbencher-brain"
main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
