// M13 handoff, MEASURED (M14 #286 yaml lane, 2026-09-27).
//
// The M13 defect register claimed bb_edit's codeMask "understands only `' " \` // /* */`".
// This probe is the measurement that refutes it for yaml: it asks the grammar for every
// `comment` node in a yaml file chosen to be hostile (a trailing comment, a `# TODO:`
// comment that NAMES the symbol a rename would target, a comment with no space after `#`,
// and a comment ending mid-token) and then checks, byte by byte, whether the mask leaks any
// of them as live code. A leak would mean a rename reaches comment text.
//
// Result: 4 comment nodes, 100% of comment bytes masked, 0 live bytes leaked. The register
// bullet is amended rather than deleted, because the claim is unmeasured for every other
// language and that is the tool owner's claim to make.
//
// Run: bun run script/m60/yaml-m13-codemask-probe.ts
// See also yaml-m13-occurrence-probe.ts, which is the half that DID find a defect.
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const grammar = await L.load(fs.readFileSync(`${ROOT}/wasm/tree-sitter-yaml.wasm`))
const parser = new P()
parser.setLanguage(grammar)

const { buildSyntaxMask } = await import(`${ROOT}/src/ast/safety-primitives.ts`)

const src = [
  "replicas: 3            # live code: replicas",
  "# TODO: rename replicas to replicaCount in deploy.yaml",
  "image: registry:5000/app:1.2  # pinned, do not bump replicas",
  'quoted: "replicas is a word, not code"',
  "#replicas",
  "replicas: 4",
  "",
].join("\n")

const tree = parser.parse(src)
const mask = buildSyntaxMask(tree, src.length)
const at = (i: number) => (mask[i] === 1 ? "CODE" : mask[i] === 0 ? "mask" : "?")
console.log("byte   char  mask    context")
for (let i = 0; i < src.length; i++) {
  const c = src[i]
  if (c === "\n") continue
  console.log(`${String(i).padStart(4)}  ${JSON.stringify(c).padEnd(6)} ${at(i).padEnd(6)}  ${JSON.stringify(src.slice(Math.max(0, i - 12), i + 14))}`)
}
// the decisive measurement: is every byte of every `#` comment masked?
const commentRanges: Array<[number, number]> = []
const walk = (n: any): void => {
  if (n.type === "comment") commentRanges.push([n.startIndex, n.endIndex])
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
}
walk(tree.rootNode)
console.log(`\ncomment nodes found by the grammar: ${commentRanges.length}`)
let bad = 0
for (const [a, b] of commentRanges) {
  const live: number[] = []
  for (let i = a; i < b; i++) if (mask[i] === 1) live.push(i)
  if (live.length) {
    bad++
    console.log(`  LEAK  bytes ${a}-${b}: ${JSON.stringify(src.slice(a, b))}`)
    console.log(`        ${live.length} byte(s) marked CODE inside a comment, e.g. ${JSON.stringify(src.slice(live[0], live[0] + 12))}`)
  }
}
console.log(bad === 0 ? "\nRESULT: mask covers every comment byte — the stale register claim does NOT reproduce for yaml" : `\nRESULT: ${bad}/${commentRanges.length} comment(s) leak live bytes`)
