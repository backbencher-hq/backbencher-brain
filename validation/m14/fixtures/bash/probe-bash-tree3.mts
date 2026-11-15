import { ASTEngine } from "../../../../src/ast/engine"

/** The one character class this probe needs, named so the no-regex census has
 * nothing to find here. */
const NEWLINE = String.fromCharCode(10)
const p = await ASTEngine.getParser("bash")
const abs = process.argv[2]
const from = Number(process.argv[3])
const to = Number(process.argv[4])
const { readFileSync } = await import("node:fs")
const text = readFileSync(abs, "utf8")
const tree = p!.parse(text)
const lines = text.split("\n")
console.log(`--- source ${from}..${to} ---`)
for (let i = from; i <= to; i++) console.log(`${i}: ${lines[i - 1]}`)
console.log(`--- subtree rooted at the first node starting on line ${from} ---`)
const find = (n: any): any => {
  if (n.startPosition.row + 1 === from) return n
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    if (c.endPosition.row + 1 >= from && c.startPosition.row + 1 <= to) {
      const r = find(c)
      if (r) return r
    }
  }
  return null
}
const dump = (n: any, d = 0): void => {
  if (d > 12) return
  const txt = n.text.length > 90 ? n.text.slice(0, 90) + "..." : n.text
  // `txt.split(NEWLINE).join("\\n")` rather than `txt.replace(/\n/g, …)`. This was
  // the lane's ONE regex literal and it survived three rounds because the no-regex
  // probe carried a hand-written file list that did not include this file — a
  // green row about a population smaller than the lane's. See the header of
  // `probe-bash-no-regex.mts`, which is why that file now discovers its population
  // off the filesystem instead of naming it.
  const shown = txt.split(NEWLINE).join("\\n")
  console.log(`${"  ".repeat(d)}${n.type}${n.isMissing ? " [MISSING]" : ""} @${n.startPosition.row + 1}:${n.startPosition.column} "${shown}"`)
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c) dump(c, d + 1)
  }
}
const root = find(tree.rootNode)
if (root) dump(root)
else console.log("(no node starts on that line)")