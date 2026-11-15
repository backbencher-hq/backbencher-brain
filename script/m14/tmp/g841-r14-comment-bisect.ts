// #841 round 14: which comment block participates in the degradation?
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice("--file=".length) ?? "/home/ishaq2321/bb_tests/repositories/grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/TestTaskShardingPlugin.groovy"

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

function degraded(src: string): boolean {
  const tree = parser.parse(src)
  const kids: string[] = []
  for (const c of tree.rootNode.children) if (c) kids.push(c.type)
  return kids.includes("ERROR") && kids.includes("class")
}

const full = readFileSync(FILE, "utf8")
const lines = full.split("\n")
console.log(`full degraded: ${degraded(full)}`)

// find comment blocks
const blocks: Array<{ start: number; end: number; kind: string }> = []
let i = 0
while (i < lines.length) {
  const l = lines[i]
  if (/^\s*\/\*/.test(l)) {
    let j = i
    while (j < lines.length && !/\*\//.test(lines[j])) j++
    blocks.push({ start: i, end: Math.min(j, lines.length - 1), kind: "block" })
    i = j + 1
    continue
  }
  if (/^\s*\/\//.test(l)) {
    let j = i
    while (j + 1 < lines.length && /^\s*\/\//.test(lines[j + 1])) j++
    blocks.push({ start: i, end: j, kind: "line" })
    i = j + 1
    continue
  }
  i++
}
console.log(`comment blocks: ${blocks.length}`)
for (const b of blocks) {
  const without = lines.filter((_, k) => k < b.start || k > b.end).join("\n")
  console.log(`  block ${b.kind} L${b.start + 1}-${b.end + 1} removed -> degraded=${degraded(without)}  first="${lines[b.start].slice(0, 50)}"`)
}
// remove ALL comments at once
const all = lines.filter((_, k) => !blocks.some((b) => k >= b.start && k <= b.end)).join("\n")
console.log(`all comments removed -> degraded=${degraded(all)}`)
