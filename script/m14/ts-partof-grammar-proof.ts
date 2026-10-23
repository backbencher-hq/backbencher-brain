// TYPESCRIPT LANE — THE TWO-BUILD BEHAVIOURAL PROOF FOR THE `part_of` GRAMMAR PATCH (R2).
//
// ⇒⇒⇒ THE LADDER'S RULE: a rung is proven by MEASUREMENT, never by a node list. So this file parses
// ONE source string with TWO builds and prints what each build makes of the same bytes:
//
//   · the SERVED build  (8515404d…, what production and the fixtures load) — the directive should be
//     a `comment`, which is why no relation can be read from it;
//   · the PATCHED build (b75fa34c…, generated here from a one-rule patch to the derived grammar) —
//     the directive should be a `reference_directive` NODE, which is what makes `part_of` readable
//     from the tree instead of from the text.
//
// THE FIXTURE IS RED-ABLE: if the patched build does NOT produce the node, this program prints
// `RED` and exits 1. A proof that cannot fail is not a proof.
//
// WHY IT LOADS GRAMMARS THROUGH `web-tree-sitter` DIRECTLY: under Bun the engine's
// `loadWebTreeSitter()` route dies with `C.loadWebAssemblyModule` undefined, and the fixture
// runner's own route — `import("web-tree-sitter")` plus `Parser.init({ locateFile })` — works. This
// is the same harness the suite uses, so the proof runs where the fixtures run.
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const SERVED = join(REPO, "wasm/tree-sitter-typescript.wasm")
const PATCHED = process.argv[2] ?? join(REPO, ".tmp-ts/r2patch/typescript/tree-sitter-typescript.wasm")

const SOURCE = [
  '/// <reference types="vite/client" />',
  '/// <reference path="./ambient.d.ts" />',
  '/// <reference lib="dom" />',
  '// an ordinary comment, which must stay a comment',
  'const x: number = 1',
  '',
].join("\n")

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex")

const mod: any = await import("web-tree-sitter")
const ParserCls = mod.Parser ?? mod.default?.Parser ?? mod.default
await ParserCls.init({ locateFile: () => join(REPO, "node_modules/web-tree-sitter/tree-sitter.wasm") })

function topTypes(lang: any, src: string): string[] {
  const parser = new ParserCls()
  parser.setLanguage(lang)
  const tree = parser.parse(src)
  const out = (tree.rootNode.namedChildren ?? []).map((n: any) => n.type)
  parser.delete?.()
  return out
}

const servedSha = sha(SERVED)
const patchedSha = sha(PATCHED)
const servedLang = await mod.Language.load(SERVED)
const patchedLang = await mod.Language.load(PATCHED)

const servedTypes = topTypes(servedLang, SOURCE)
const patchedTypes = topTypes(patchedLang, SOURCE)

const count = (xs: string[], t: string) => xs.filter((x) => x === t).length
const servedDirectives = count(servedTypes, "reference_directive")
const patchedDirectives = count(patchedTypes, "reference_directive")
const servedComments = count(servedTypes, "comment")
const patchedComments = count(patchedTypes, "comment")

console.log("SOURCE: 3 reference directives + 1 ordinary comment + 1 lexical declaration\n")
console.log(`SERVED   ${servedSha}`)
console.log(`         top-level node types: ${JSON.stringify(servedTypes)}`)
console.log(`         reference_directive ${servedDirectives} · comment ${servedComments}`)
console.log(`PATCHED  ${patchedSha}`)
console.log(`         top-level node types: ${JSON.stringify(patchedTypes)}`)
console.log(`         reference_directive ${patchedDirectives} · comment ${patchedComments}`)
console.log()

// ⇒ THE PROOF'S OWN CONDITIONS, each named so a failure says WHICH one failed.
const checks: [string, boolean][] = [
  ["the served build makes the directives COMMENTS (that is the defect the patch addresses)", servedDirectives === 0 && servedComments >= 3],
  ["the patched build makes them NODES named reference_directive (the relation becomes readable)", patchedDirectives === 3],
  ["the patched build still makes an ORDINARY comment a comment (the patch does not eat comments)", patchedComments === 1],
  ["the two builds are DIFFERENT BYTES (a rebuild that changed nothing proves nothing)", servedSha !== patchedSha],
  ["the patched build is NOT the served build (identity, not just inequality)", patchedSha !== servedSha],
]
let red = false
for (const [what, ok] of checks) {
  console.log(`${ok ? "GREEN" : "RED  "} — ${what}`)
  if (!ok) red = true
}
console.log()
console.log(red
  ? "RED: THE PATCH IS NOT PROVEN. The build exists but does not change what the parser makes of the bytes, and a node list is not a measurement."
  : "GREEN: THE PATCH IS PROVEN BY BEHAVIOUR — the same bytes become a `part_of` node under the patched build and stay a comment under the served one.")
process.exit(red ? 1 : 0)
