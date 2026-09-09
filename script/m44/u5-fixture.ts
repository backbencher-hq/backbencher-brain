// script/m44/u5-fixture.ts — M44.U5 fixture (F7: authored BEFORE the fix).
//
// The owner-session defect (issue #692): clicking "Impact analysis" on a
// constructor hover answered `bb/impact: symbol "constructor" is not in the
// index` although the constructor IS indexed. Root cause: the graph engine's
// root resolver whitelists symbol_type IN ('function','method','class',...) —
// 'constructor' is excluded, so the hover's server-resolved identity (correct
// per H4) dies at the impact door.
//
// X1 closure extension (2026-09-09, second F7): the name-only member fix
// passed its original single-class gate but DIES ON REAL REPOS — every real
// repo has several `constructor` rows (one per class), and rule 1 ("exactly
// one name match") bails to the declared error. Found live on the owner's
// bb-demo-hub repo: Greeter + Store both define constructors; the hover's
// action link carries the file identity, but the resolver never received it.
// The fixture therefore has TWO classes with constructors in TWO files, and
// resolution must disambiguate through the hover's file identity.
//
// This module owns the fixture text AND the index shape the fix is proven
// against. The seeded rows mirror what the REAL indexer writes for this
// source (R0 in the gate re-proves that equality against a live index, so
// the seed can never drift from reality):
//   - `constructor` symbols, symbol_type "constructor", owner = their class
//   - `contains` rows class → constructor (the indexer's universal
//     containment row — the ONLY relationship each constructor has)
//   - an `instantiates` row main → Greeter and register → Registry (the real
//     analyzer vocabulary for `new Greeter()` / `new Registry()`)
//
// Layout (1-based lines) — the constructor sits AFTER greet so every
// pre-U5 position (greet's seeds, FIXTURE_HOVER_POS) stays byte-stable://
//   main.ts:
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
//
//   registry.ts:
//   1 class Registry {
//   2   count(): number {
//   3     return 0
//   4   }
//   5   constructor() {}
//   6 }
//   7 (blank)
//   8 function register(): void {
//   9   const r = new Registry()
//  10   r.count()
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

export const U5_REGISTRY_TS = `class Registry {
  count(): number {
    return 0
  }
  constructor() {}
}

function register(): void {
  const r = new Registry()
  r.count()
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
  registryLine: U5_REGISTRY_TS.split("\n").findIndex((l) => l.includes("class Registry {")) + 1,
  registryCtorLine: U5_REGISTRY_TS.split("\n").findIndex((l) => l.includes("constructor() {}")) + 1,
  /** The member target the hover resolves and impact must accept. */
  memberName: "constructor",
  /** BOTH defining files (the disambiguation identity the hover carries). */
  memberFiles: { greeter: "main.ts", registry: "registry.ts" },
  /** The owning declarations each file's member must root at. */
  ownerByFile: { "main.ts": "Greeter", "registry.ts": "Registry" },
  /** The owning declaration the impact set must root at. */
  ownerName: "Greeter",
  /** The reverse dependency the owning class's impact set must contain. */
  impactNames: ["main", "register"],
} as const

export function writeU5Fixture(): string {
  mkdirSync(U5_ROOT, { recursive: true })
  writeFileSync(U5_ROOT + "/main.ts", U5_MAIN_TS)
  writeFileSync(U5_ROOT + "/registry.ts", U5_REGISTRY_TS)
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
