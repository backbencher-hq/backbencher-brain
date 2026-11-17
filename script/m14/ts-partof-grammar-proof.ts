// TYPESCRIPT LANE — THE TWO-BUILD BEHAVIOURAL PROOF FOR THE `part_of` GRAMMAR PATCH (R2).
//
// ⇒⇒⇒ THE LADDER'S RULE: a rung is proven by MEASUREMENT, never by a node list. This file parses ONE
// source string with TWO builds and prints what each build makes of the same bytes:
//
//   · the STOCK build (8515404d…, preserved at script/m14/ts-grammar-patch/tree-sitter-typescript-
//     served.wasm) — the directive is a `comment`, which is why no relation can be read from it;
//   · the SERVED build (b75fa34c…, the repository's own committed wasm/tree-sitter-typescript.wasm)
//     — the directive is a `reference_directive` NODE, which is what makes `part_of` readable from
//     the tree instead of from the text.
//
// THE PROOF WAS RED AT HEAD UNTIL 2026-11-17, and the reason is a measured lesson rather than a
// typo: after the R2 rung was TAKEN, the patched build became the build the resolver SERVES — so a
// proof that still called `wasm/tree-sitter-typescript.wasm` "the served (stock) build" compared the
// patched build with itself, printed two identical digests, and exited 1. A proof that hard-codes
// which side of the swap the tree is on goes red the moment the swap lands. The sides are now named
// by ROLE (stock / served), the stock bytes are kept as a committed artifact, and the pin is checked
// against the ENGINE'S OWN TABLE rather than against a second copy of the intended digest.
//
// WHY IT LOADS GRAMMARS THROUGH `web-tree-sitter` DIRECTLY: under Bun the engine's
// `loadWebTreeSitter()` route dies with `C.loadWebAssemblyModule` undefined, and the fixture
// runner's own route — `import("web-tree-sitter")` plus `Parser.init({ locateFile })` — works. This
// is the same harness the suite uses, so the proof runs where the fixtures run.
//
// Usage:
//   bun run script/m14/ts-partof-grammar-proof.ts                # stock artifact vs served wasm
//   bun run script/m14/ts-partof-grammar-proof.ts <before> <after>   # explicit builds (pin checks skipped)
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const STOCK_COPY = join(REPO, "script/m14/ts-grammar-patch/tree-sitter-typescript-served.wasm")
const PATCHED_COPY = join(REPO, "script/m14/ts-grammar-patch/tree-sitter-typescript-patched.wasm")
const SERVED = join(REPO, "wasm/tree-sitter-typescript.wasm")
const ENGINE = join(REPO, "src/ast/engine.ts")

/** The digests the rung was taken with, recorded in `script/m14/ts-grammar-patch/README.md`. */
const STOCK_SHA = "8515404dceed38e1ed86aa34b09fcf3379fff1b4ff9dd3967bcd6d1eb5ac3d8f"
const PATCHED_SHA = "b75fa34cfde954d15429b39062d217e6fa99b425a0c3f1aaedd082116dd20335"

const BEFORE = process.argv[2] ?? STOCK_COPY
const AFTER = process.argv[3] ?? SERVED
const CUSTOM_BUILDS = process.argv.length > 2

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

const beforeSha = sha(BEFORE)
const afterSha = sha(AFTER)
const beforeLang = await mod.Language.load(BEFORE)
const afterLang = await mod.Language.load(AFTER)

const beforeTypes = topTypes(beforeLang, SOURCE)
const afterTypes = topTypes(afterLang, SOURCE)

const count = (xs: string[], t: string) => xs.filter((x) => x === t).length
const beforeDirectives = count(beforeTypes, "reference_directive")
const afterDirectives = count(afterTypes, "reference_directive")
const beforeComments = count(beforeTypes, "comment")
const afterComments = count(afterTypes, "comment")

console.log("SOURCE: 3 reference directives + 1 ordinary comment + 1 lexical declaration\n")
console.log(`BEFORE  ${beforeSha}  (${CUSTOM_BUILDS ? "explicit build" : "stock artifact"})`)
console.log(`        top-level node types: ${JSON.stringify(beforeTypes)}`)
console.log(`        reference_directive ${beforeDirectives} · comment ${beforeComments}`)
console.log(`AFTER   ${afterSha}  (${CUSTOM_BUILDS ? "explicit build" : "the build the resolver serves"})`)
console.log(`        top-level node types: ${JSON.stringify(afterTypes)}`)
console.log(`        reference_directive ${afterDirectives} · comment ${afterComments}`)
console.log()

// ⇒ THE PIN, READ FROM THE ENGINE'S OWN TABLE. The resolver serves the repository copy only when the
// digest matches this table (engine.ts:790 reads it), so the table is the right thing to check — a
// second copy of the intended digest here would be an assertion that can drift from the enforcement.
let enginePin: string | null = null
try {
  const engine = readFileSync(ENGINE, "utf8")
  const key = `"tree-sitter-typescript.wasm": "${afterSha}"`
  enginePin = engine.includes(key) ? afterSha : null
} catch {
  enginePin = null
}
let patchedCopySha: string | null = null
try {
  patchedCopySha = sha(PATCHED_COPY)
} catch {
  patchedCopySha = null
}

// ⇒ THE PROOF'S OWN CONDITIONS, each named so a failure says WHICH one failed.
const checks: [string, boolean][] = [
  ["the BEFORE build makes the directives COMMENTS (that is the defect the patch addresses)", beforeDirectives === 0 && beforeComments >= 3],
  ["the AFTER build makes them NODES named reference_directive (the relation becomes readable)", afterDirectives === 3],
  ["the AFTER build still makes an ORDINARY comment a comment (the patch does not eat comments)", afterComments === 1],
  ["the two builds are DIFFERENT BYTES (a rebuild that changed nothing proves nothing)", beforeSha !== afterSha],
]
if (!CUSTOM_BUILDS) {
  checks.push(
    ["the AFTER build is the patched digest the rung was taken with", afterSha === PATCHED_SHA],
    ["the BEFORE build is the stock digest the rung was taken with", beforeSha === STOCK_SHA],
    ["the ENGINE'S per-file digest table records tree-sitter-typescript.wasm -> the served build (the pin is enforced, not asserted)", enginePin !== null],
    ["the committed patched copy hashes to the served build (the artifact is reproducible)", patchedCopySha === afterSha],
  )
}
let red = false
for (const [what, ok] of checks) {
  console.log(`${ok ? "GREEN" : "RED  "} — ${what}`)
  if (!ok) red = true
}
if (!CUSTOM_BUILDS) {
  console.log(`\npin table: engine.ts ${enginePin ? `records ${enginePin}` : "does NOT record the served digest"}`)
  console.log(`patched copy: ${patchedCopySha ?? "(absent)"}`)
}
console.log()
console.log(red
  ? "RED: THE PATCH IS NOT PROVEN. The build exists but does not change what the parser makes of the bytes, or the bytes are not the ones the resolver serves."
  : "GREEN: THE PATCH IS PROVEN BY BEHAVIOUR — the same bytes become a `part_of` node under the served (patched) build and stay a comment under the stock one, and the resolver's digest table names the served build.")
process.exit(red ? 1 : 0)
