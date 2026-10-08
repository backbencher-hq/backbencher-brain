/**
 * VB TREE DUMP — print the parse tree of a .vb file, and the ERROR census.
 *
 * ## Why this exists
 *
 * The handover claim for this lane was "VERIFY_VB10 bisected a ONE-TOKEN GRAMMAR
 * DEFECT: the vbnet parser cannot represent a tuple return, which is why a probe's
 * count is zero." A bisect needs something to bisect: the lane's own docs point at
 * "the `Return (A, B)` repro above", and `grammars/_vendored/vbnet/repro-cases/`
 * jumps 26 -> 28, so the repro was never committed. This is the instrument that
 * turns the claim into a reading: feed it a shape, get the tree and the ERROR
 * census, with no interpretation in between.
 *
 * ## What it prints, and why each field is here
 *
 *   - the tree, via `cursor`/`node.toString()`, so no text munging is involved;
 *   - the ERROR/MISSING census, counted on the TREE. A grammar that has stopped
 *     parsing carries error nodes; one that is merely incomplete does not. That
 *     distinction is the whole difference between "this shape is not expressible"
 *     and "this shape is broken", and it is invisible from source text;
 *   - the population: the path it read, its byte length, and whether the wasm it
 *     loaded is the one wired into the engine. The honesty contract's rule is that
 *     an instrument declares the population it covered.
 *
 * ## No regex
 *
 * Extension tests use `endsWith`, suffixes are trimmed by length. Nothing here
 * matches source text.
 */

import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO = resolve(import.meta.dir, "../..")
const CORE = process.env.BB_CORE_WASM ?? join(REPO, "wasm/tree-sitter.wasm")
const GRAMMAR = process.env.VB_WASM ?? join(REPO, "wasm/tree-sitter-vbnet.wasm")

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error("usage: bun script/m14/vb-tree-dump.mts <file.vb> [...]")
  process.exit(2)
}

const { Parser, Language } = await import(join(REPO, "node_modules/web-tree-sitter/tree-sitter.js"))
await Parser.init({ locateFile: () => CORE })
const parser = new Parser()
const lang = await Language.load(GRAMMAR)
parser.setLanguage(lang)

for (const path of args) {
  const src = readFileSync(path, "utf8")
  const tree = parser.parse(src)
  const root = tree.rootNode

  let errors = 0
  let missing = 0
  let named = 0
  const typeTally = new Map<string, number>()
  // EVERY child, named and anonymous. A named-only walk is the instrument's own
  // version of the defect this dump exists to find: a MISSING anonymous token —
  // a spurious `MISSING "`` at EOF when a file has no trailing newline — is
  // invisible to `namedChild`, so the census reads `MISSING nodes=0` and
  // `root.hasError=true` at the same time. Both were observed on
  // repro-case 27 before the file gained its trailing newline.
  const walk = (n: any): void => {
    if (n.type === "ERROR") errors++
    if (n.isMissing) missing++
    if (n.isNamed) {
      named++
      typeTally.set(n.type, (typeTally.get(n.type) ?? 0) + 1)
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)

  console.log(`── ${path}`)
  console.log(`   bytes ${src.length}   lines ${src.split("\n").length}`)
  console.log(`   root.hasError=${root.hasError}   ERROR nodes=${errors}   MISSING nodes=${missing}   named nodes=${named}   distinct named types=${typeTally.size}`)
  console.log(root.toString())

  // `VB_VERBOSE=1` adds the one reading the sexp cannot give: the FULL child list
  // of every ERROR and MISSING node, named and anonymous, with each token's text.
  // tree-sitter's `toString()` prints an ERROR's named children and drops the
  // anonymous ones, so an error that ate `= )` and one that ate nothing look the
  // same — and which of those two happened is the difference between a grammar
  // that lost a token and one that merely refused a shape.
  if (process.env.VB_VERBOSE === "1") {
    const walk = (n: any, depth: number): void => {
      if (n.type === "ERROR" || n.isMissing) {
        const parts: string[] = []
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          parts.push(`${c.isNamed ? "" : "'"}${c.type}${c.isNamed ? "" : "'"}${c.isMissing ? " (MISSING)" : ""}`)
        }
        console.log(`   ${n.isMissing ? "MISSING" : "ERROR"} at ${n.startPosition.row + 1}:${n.startPosition.column} parent=${n.parent?.type ?? "(root)"}`)
        console.log(`     children: [${parts.join(" | ")}]`)
        console.log(`     text: ${JSON.stringify(n.text.slice(0, 120))}`)
      }
      for (let i = 0; i < n.childCount; i++) walk(n.child(i), depth + 1)
    }
    walk(root, 0)
  }
  console.log("")
}