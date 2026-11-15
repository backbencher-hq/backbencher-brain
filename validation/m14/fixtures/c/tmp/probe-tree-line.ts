import * as path from "node:path"
import { readFileSync } from "node:fs"
import { getParser } from "../../../../../src/ast/engine"
const CR = path.resolve(import.meta.dirname, "../../../../../.corpus")
const [rel, lineStr] = process.argv.slice(2)
const parser: any = await getParser("c")
const src = readFileSync(path.join(CR, rel), "utf8")
const tree = parser.parse(src)
const target = Number(lineStr)
const walk = (n: any, depth: number): void => {
  const r = n.startPosition.row + 1
  const rend = n.endPosition.row + 1
  if (r <= target && target <= rend) {
    console.log(`${"  ".repeat(depth)}${n.type}${n.isNamed ? "" : "(anon)"} [${r}-${rend}] ${JSON.stringify(n.text.slice(0, 60))} fields:${JSON.stringify(Object.keys((n.constructor as any) ?? {}))}`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), depth + 1)
  }
}
walk(tree.rootNode, 0)
