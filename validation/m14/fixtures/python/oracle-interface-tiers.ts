/**
 * Does the ORACLE derive the `implements` tiers the interface fixtures pin on the ANALYZER?
 *
 * WHY THIS FILE EXISTS. `script/m14/differential.ts` compares the analyzer against the lane
 * oracle on a 60-file draw, which proves the two AGREE on the corpus and says nothing about
 * whether either matches the RULING. The ruling lives in five fixtures —
 * `interface-implements`, `implements-interface-bases`, `interface-qualified-subscript-head`,
 * `implements-proof-requires-binding`, `interface-declaration-needs-abc-meta` — and every one
 * of them was authored against the ANALYZER. So this reads each fixture's
 * `expectRelationships`/`forbidRelationships`, runs `derivePythonTruth` over the same source,
 * and asserts every `implements`/`extends` row in BOTH directions:
 *
 *   an `expect` row the oracle does not derive   -> FAIL (the oracle has a missing tier)
 *   a `forbid` row the oracle DOES derive        -> FAIL (the oracle fabricates)
 *
 * It found a real gap on its first run: `implements RowLike -> Sequence`, the
 * `SomeABC.register(SomeConcrete)` tier — conformance with NO inheritance, which the base-list
 * derivation cannot see. That tier is now derived (see the `implements` TIER 3 block in
 * `script/m14/oracles/python-truth.ts`), and this file is what proved it was missing rather
 * than assumed it was there.
 *
 * The fixture rows are read from the fixture's own JSON, never restated here: a hand-copied
 * expectation is a stale list read as a current one.
 *
 * Usage: npx tsx validation/m14/fixtures/python/oracle-interface-tiers.ts
 * Exits non-zero on any disagreement.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.cwd()
const FX = join(REPO, "validation/m14/fixtures/python")
const wts: any = await import("web-tree-sitter")
await wts.Parser.init({ locateFile: () => join(REPO, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new wts.Parser()
parser.setLanguage(await wts.Language.load(readFileSync(join(REPO, "wasm/tree-sitter-python.wasm"))))
const { derivePythonTruth } = await import(join(REPO, "script/m14/oracles/python-truth.ts"))

const FIXTURES = [
  "interface-implements",
  "implements-interface-bases",
  "interface-qualified-subscript-head",
  "implements-proof-requires-binding",
  "interface-declaration-needs-abc-meta",
]

let fails = 0
console.log("oracle-interface-tiers — the ORACLE vs the interface fixtures' own rows")
for (const f of FIXTURES) {
  const src = readFileSync(join(FX, `${f}.py`), "utf8")
  const exp = JSON.parse(readFileSync(join(FX, `${f}.expectation.json`), "utf8"))
  const root = parser.parse(src).rootNode
  const edges = derivePythonTruth(root, f)
  const got = new Set(edges.map((e: any) => `${e.type}\u0000${e.from}\u0000${e.to}`))
  // Fixture rows are keyed `source` in some files and `from` in others; read both rather
  // than normalising the fixtures, which are analyzer-owned.
  const check = (rows: any[], want: boolean, label: string): void => {
    for (const r of rows ?? []) {
      if (r.type !== "implements" && r.type !== "extends") continue
      const k = `${r.type}\u0000${r.source ?? r.from}\u0000${r.target}`
      if (got.has(k) !== want) {
        console.log(`   FAIL ${f} [${label}] ${want ? "ORACLE MISSING" : "ORACLE PUBLISHED A FORBIDDEN EDGE"}: ${k.replace(/\u0000/g, " ")}`)
        fails++
      }
    }
  }
  check(exp.expectRelationships, true, "expect")
  check(exp.forbidRelationships, false, "forbid")
  const imp = edges.filter((e: any) => e.type === "implements").length
  const ext = edges.filter((e: any) => e.type === "extends").length
  console.log(`   ${f.padEnd(44)} implements=${imp} extends=${ext}`)
}
console.log()
if (fails === 0) {
  console.log("PASS — the oracle's implements/extends tiers match every interface fixture row, both directions.")
  process.exit(0)
}
console.log(`FAIL — ${fails} row(s) disagree. The oracle and the ruling fixtures must be reconciled.`)
process.exit(1)
