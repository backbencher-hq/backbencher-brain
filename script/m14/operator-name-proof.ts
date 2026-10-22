/**
 * script/m14/operator-name-proof.ts
 *
 * THE PROOF FOR THE OPERATOR-NAME PATCH in `src/ast/pool-worker.ts`.
 *
 * The ruby lane (2026-10-21) measured that `filterNoiseRelationships` DROPPED 12 rows over 8 files
 * in 4 repos whose target was Ruby's `<=>` comparison operator — because the garbage-character test
 * banned angle brackets in a target. `Comparable#<=>` is a real method name in real code, so the
 * loss was silent and total for that class: the analyzer emitted the rows and the shared filter ate
 * them on the way to the index.
 *
 * THE PATCH IS THE OPERATOR SHAPE, NOT A RUBY EXEMPTION: a leaf made SOLELY of operator characters
 * is an OPERATOR NAME (legal in several languages), while a leaf MIXING operator characters with
 * letters (`Array<T>`, `<div>`) is a FRAGMENT and is still banned. The snippet ban itself is
 * unchanged — braces, backtick, newline and tab remain unconditional.
 *
 * THE THREE CLAIMS, EACH WITH ITS OWN FALSIFIER, AND THE PATCH FAILS LOUDLY (exit 5):
 *   1 · A RUBY OPERATOR NAME (`<=>`) IS KEPT — it was silently deleted before.
 *   2 · EVERY SNIPPET IS STILL REFUSED (`<div>`, `Array<T>`, `${x}`, braces, backtick).
 *   3 · AN OPERATOR NAME IN ANOTHER LANGUAGE IS KEPT (`===`), so the exemption is a SHAPE and not a
 *       ruby special case.
 *
 * RUN: bun script/m14/operator-name-proof.ts
 */
import { filterNoiseRelationships } from "../src/ast/pool-worker"

const ruby = [{ type: "contains", source: "EarlyTime", target: "<=>" }]
const kept = filterNoiseRelationships(ruby, "ruby", new Set(["EarlyTime"]))
console.log("ruby '<=>' rows kept:", kept.length, JSON.stringify(kept))

// A SNIPPET must still be refused — the exemption is for operator NAMES, not fragments.
const snippets: [string, string][] = [
  ["<div>", "html-ish fragment"],
  ["Array<T>", "generic fragment"],
  ["${x}", "template fragment"],
  ["a {b}", "brace fragment"],
  ["a`b", "backtick fragment"],
]
let failures = 0
for (const [tgt, why] of snippets) {
  const n = filterNoiseRelationships([{ type: "calls", source: "s", target: tgt }], "javascript", new Set(["s"])).length
  const ok = n === 0
  if (!ok) failures++
  console.log(`  snippet refused: ${ok ? "YES" : "NO"}  ${why} (${tgt}) -> ${n} rows`)
}

// A REAL operator name in another language must be kept too — the exemption is a SHAPE.
const opKept = filterNoiseRelationships([{ type: "calls", source: "s", target: "===" }], "javascript", new Set(["s"])).length
console.log("  operator name kept (===):", opKept === 1 ? "YES" : "NO", `-> ${opKept} rows`)
if (opKept !== 1) failures++

if (kept.length !== 1) { console.error("FAIL: the operator row is still dropped"); failures++ }
if (failures > 0) process.exit(5)
console.log("PASS: the operator name is kept, and every snippet is still refused.")
