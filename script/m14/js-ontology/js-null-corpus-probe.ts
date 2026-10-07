// Probe: lodash test/test.js yields `uses -> null` and `uses -> undefined` per the
// census. Neither is reachable from a bare `return null` (js-null-probe.ts), so the
// construct that produces them is something else. This prints every AST node whose
// TEXT is `null` or `undefined` together with its node type and its parent chain, so
// the finding is attributed to a grammar shape rather than guessed at.
import { readFileSync } from "node:fs"
import { getParser } from "../../../src/ast/engine"

const file = "$HOME/fixtures/repositories/lodash/test/test.js"
const parser = await getParser("javascript")
const src = readFileSync(file, "utf8")
const tree = await parser.parse(src, file)
const stack: any[] = [tree.rootNode]
let hits = 0
while (stack.length) {
  const n = stack.pop()
  if (!n) continue
  if (n.text === "null" || n.text === "undefined") {
    const chain: string[] = []
    let p = n.parent
    let d = 0
    while (p && d < 4) { chain.push(p.type); p = p.parent; d++ }
    const line = n.startPosition.row + 1
    const ctx = src.split("\n")[line - 1] ?? ""
    console.log(`line ${line}  type=${n.type}  parent-chain=${chain.join(" < ")}`)
    console.log(`    ${ctx.trim().slice(0, 110)}`)
    hits++
    if (hits > 24) { console.log("... stopping"); break }
  }
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) stack.push(c)
  }
}
console.log(`total nodes whose text is exactly null/undefined: ${hits}${hits > 24 ? "+" : ""}`)