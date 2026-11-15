// script/m14/tmp/dt-calls-as-shape.ts — WHERE does the oracle get `calls -> as`?
//
// The isolated rewrite of the redirect shape (`C() : this.as(1)`) does NOT
// reproduce it, so this probe finds the shape by walking the real file with the
// oracle's OWN chain logic (copied) and printing every argument-carrying
// selector whose resolved callee is the token `as`.
//
// Usage: bun script/m14/tmp/dt-calls-as-shape.ts <file.dart>
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

async function main() {
  const file = process.argv[2]
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync(file, "utf8")
  const root: any = p.parse(src).rootNode

  const linkMember = (sel: any): string | null => {
    const kids: any[] = sel.type === "selector" ? sel.namedChildren : [sel]
    for (const c of kids) {
      if (c.type === "unconditional_assignable_selector" || c.type === "conditional_assignable_selector" || c.type === "cascade_selector") {
        const id = c.namedChildren.find((x: any) => x.type === "identifier") ?? c.namedChildren.find((x: any) => x.type === "type_identifier")
        if (id) return id.text
      }
    }
    return null
  }
  const chain = (argsSel: any): { head: any; links: string[] } => {
    const links: string[] = []
    let c: any = argsSel.previousNamedSibling
    while (c) {
      if (c.type === "selector") { const m = linkMember(c); if (!m) break; links.unshift(m); c = c.previousNamedSibling }
      else if (c.type === "unconditional_assignable_selector" || c.type === "conditional_assignable_selector") {
        const id = c.namedChildren.find((x: any) => x.type === "identifier") ?? c.namedChildren.find((x: any) => x.type === "type_identifier")
        if (!id) break
        links.unshift(id.text); c = c.previousNamedSibling
      } else break
    }
    return { head: c, links }
  }

  const stack: any[] = [root]
  let hits = 0
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "selector" && n.namedChildren.some((c: any) => c.type === "argument_part")) {
      const { head, links } = chain(n)
      const method = links[links.length - 1]
      const headText = head && (head.type === "identifier" || head.type === "type_identifier") ? head.text : null
      if (method === "as" || headText === "as") {
        hits++
        const line = n.startPosition.row + 1
        const text = String(src.slice(n.parent?.startIndex ?? n.startIndex, n.parent?.endIndex ?? n.endIndex)).replace(/\s+/g, " ").slice(0, 130)
        console.log(`line ${line}: method=${method} head=${headText} headType=${head?.type} parent=${n.parent?.type} :: ${text}`)
      }
    }
    for (let k = n.namedChildCount - 1; k >= 0; k--) { const c = n.namedChild(k); if (c) stack.push(c) }
  }
  console.log(`hits=${hits}`)
}
main().then(() => process.exit(0))
