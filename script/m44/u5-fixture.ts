// script/m44/u5-fixture.ts — M44.U5 fixture (F7: authored BEFORE the fix).
//
// The owner-session defect (issue #692): clicking "Impact analysis" on a
// constructor hover answered `bb/impact: symbol "constructor" is not in the
// index` although the constructor IS indexed. Root cause: the graph engine's
// root resolver whitelists symbol_type IN ('function','method','class',...) —
// 'constructor' is excluded, so the hover's server-resolved identity (correct
// per H4) dies at the impact door.
//
// This module owns the fixture text AND the index shape the fix is proven
// against. The seeded rows mirror what the REAL indexer writes for this
// source (R0 in the gate re-proves that equality against a live index, so
// the seed can never drift from reality):
//   - `constructor` symbol, symbol_type "constructor", owner = Greeter
//   - a `contains` row Greeter → constructor (the indexer's universal
//     containment row — the ONLY relationship the constructor has)
//   - an `instantiates` row main → Greeter (the real analyzer vocabulary
//     for `new Greeter()`)
//
// Layout (1-based lines) — the constructor sits AFTER greet so every
// pre-U5 position (greet's seeds, FIXTURE_HOVER_POS) stays byte-stable:
//   1 class Greeter {
//   2   greet(): string {
//   3     return "hello"
//   4   }
//   5   constructor() {}
//   6 }
//   7 (blank)
//   8 function main(): void {
//   9   const g = new Greeter()
//  10   g.greet()
//  11 }

export const U5_ROOT = pathResolve(import.meta.dirname, "../../.tools/m44-u5-fixture")

export const U5_MAIN_TS = `class Greeter {
  greet(): string {
    return "hello"
  }
  constructor() {}
}

function main(): void {
  const g = new Greeter()
  g.greet()
}
`

/** Content-derived expectations — never hand-picked constants (the M42
 *  lesson: a hand-picked line once pointed where the symbol does not occur). */
const lines = U5_MAIN_TS.split("\n")
function lineOf(fragment: string): number {
  const idx = lines.findIndex((l) => l.includes(fragment))
  if (idx < 0) throw new Error(`U5 fixture drift: fragment not found: ${fragment}`)
  return idx + 1 // 1-based
}

export const U5_EXPECT = {
  greeterLine: lineOf("class Greeter {"),
  greetLine: lineOf("greet(): string {"),
  ctorLine: lineOf("constructor() {}"),
  mainLine: lineOf("function main(): void {"),
  newExprLine: lineOf("new Greeter()"),
  /** The member target the hover resolves and impact must accept. */
  memberName: "constructor",
  /** The owning declaration the impact set must root at. */
  ownerName: "Greeter",
  /** The reverse dependency the owning class's impact set must contain. */
  impactNames: ["main"],
} as const

export function writeU5Fixture(): string {
  mkdirSync(U5_ROOT, { recursive: true })
  writeFileSync(U5_ROOT + "/main.ts", U5_MAIN_TS)
  return U5_ROOT
}

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
function pathResolve(...segments: string[]): string {
  return path.resolve(...segments)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("fixture written:", writeU5Fixture())
  console.log("expectations:", JSON.stringify(U5_EXPECT))
}
