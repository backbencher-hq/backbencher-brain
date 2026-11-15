/**
 * script/m14/tmp/fs-override-probe.ts
 *
 * Why did the fsharp lane's first F5 row report `overrides` edges the oracle did
 * not derive? Dump the exact subtree around the first `override` tokens of one
 * corpus file, and walk up to the enclosing type, so the rule can be written
 * against the measured shape instead of a remembered one.
 *
 * Run: bun script/m14/tmp/fs-override-probe.ts [file] [maxDumps]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun.main), "..", "..", "..")
const FILE = process.argv[2] ?? "/home/ishaq2321/bb_tests/repositories/fsharp/src/Compiler/Service/FSharpProjectSnapshot.fs"
const MAX = Number(process.argv[3] ?? 4)

const shape = (n: any, depth = 0, maxDepth = 8): string[] => {
  const out: string[] = []
  const field = (() => {
    const p = n.parent
    if (!p) return ""
    for (let i = 0; i < p.childCount; i++) {
      if (p.child(i)?.id !== n.id) continue
      const f = typeof p.fieldNameForChild === "function" ? p.fieldNameForChild(i) : null
      return f ? `${f}:` : ""
    }
    return ""
  })()
  const t = (n.childCount === 0 ? n.text ?? "" : "").replace(/\s+/g, " ").slice(0, 40)
  out.push(`${"  ".repeat(depth)}${field}${n.type}${t ? ` "${t}"` : ""}${n.isNamed ? "" : " (anon)"}`)
  if (depth >= maxDepth) return out
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && (c.isNamed || depth < 4)) out.push(...shape(c, depth + 1, maxDepth))
  }
  return out
}

async function main() {
  const { Parser, Language } = await import("web-tree-sitter")
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new Uint8Array(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm")))))
  const content = fs.readFileSync(FILE, "utf8")
  const tree = parser.parse(content)!
  const stack: any[] = [tree.rootNode]
  let dumped = 0
  while (stack.length && dumped < MAX) {
    const n = stack.pop()
    let hasOverrideToken = false
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === "override") hasOverrideToken = true }
    if (hasOverrideToken && n.type === "member_defn") {
      dumped++
      // enclosing type + ancestors
      const chain: string[] = []
      let cur = n.parent
      let typeDef: any = undefined
      while (cur) { chain.push(cur.type); if (cur.type === "type_definition") typeDef = cur; cur = cur.parent }
      console.log(`\n===== override #${dumped} at line ${n.startPosition.row + 1} — ancestors: ${chain.slice(0, 6).join(" < ")}`)
      if (typeDef) {
        const named: string[] = []
        for (let i = 0; i < typeDef.namedChildCount; i++) named.push(typeDef.namedChild(i)!.type)
        console.log(`  [type_definition named children: ${named.join(", ")}]`)
        const tn = (() => { for (let i = 0; i < typeDef.namedChildCount; i++) { const c = typeDef.namedChild(i)!; if (c.type === "type_name") return c } return undefined })()
        console.log(`  [type_name present: ${!!tn}${tn ? ` text="${String(tn.text).slice(0, 40)}"` : ""}]`)
      }
      console.log(shape(n).slice(0, 22).join("\n"))
    }
    for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) }
  }
  if (dumped === 0) console.log("no member_defn carried an `override` token as a DIRECT child — check member_defn / method_or_prop_defn shapes above")
}

await main()
