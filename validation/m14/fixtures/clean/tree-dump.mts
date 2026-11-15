/** Dump the tree-sitter s-expression for one Clean file, to navigate the AST the way an
 *  oracle must. Probes in this lane read the tree; none of them regex. */
import { readFileSync } from "node:fs"
const f = process.argv[2]!
const { getParser } = await import("../../../../src/ast/engine")
const parser = await getParser("clean")
const pr: any = await parser.parse(readFileSync(f, "utf8"), f)
const FIELDS = ["name","module","alias","field","constructor","function","argument","type","value"]
const show = (n: any, d: number) => {
  const txt = n.namedChildCount === 0 ? ` ${JSON.stringify(n.text.slice(0, 70))}` : ""
  const fs: string[] = []
  for (const k of FIELDS) {
    let c = null
    try { c = n.childForFieldName?.(k) } catch {}
    if (c) fs.push(`${k}=${JSON.stringify(String(c.text).slice(0, 40))}`)
  }
  console.log(`${"  ".repeat(d)}${n.type} [${n.startPosition.row + 1}]${txt}${fs.length ? "  {" + fs.join(", ") + "}" : ""}`)
  for (let i = 0; i < n.namedChildCount; i++) show(n.namedChild(i), d + 1)
}
show(pr.rootNode, 0)
