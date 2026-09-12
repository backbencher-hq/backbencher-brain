// script/m55/t1-fixture.ts — M55.T1 (issue #770) fixture, authored BEFORE the
// assertions that read it (the F7 fixture-first rule).
//
// What the fixture must be able to prove about member identity:
//
//   member target    `constructor` on `Store` — the type the traversal
//                    engine's whitelist excludes, so the only honest root is
//                    the OWNING declaration. This is the shape the owner hit
//                    live: a constructor graph that opened titled `Store`
//                    with nothing said about the substitution.
//   ambiguous name   a SECOND `constructor`, on `Cache` — a name-only lookup
//                    must stay a declared error; only the caller's defining
//                    file disambiguates (every real repo has one constructor
//                    per class).
//   accessor         `count` (a TypeScript getter) — the fixture declares it so
//                    the gate can assert the "declared iff substituted"
//                    invariant for whichever stored type the analyzer gives an
//                    accessor, instead of assuming one.
//   absent target    a name no analyzer ever stores — must stay a declared
//                    error, never an empty result and never a guessed owner.
//   direct target    `main` — a traversable root, so the gate can prove the
//                    resolver does not hijack the direct path.
//
// The expectations are exported as data so the verifier reads them from one
// place. Positions are 1-based lines as the index stores them.

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

export const T1_ROOT = path.resolve(import.meta.dirname, "../../validation/m55/fixtures/t1-workspace")

export const T1_EXPECT = {
  /** The member target: name, defining file, and its owning declaration. */
  member: { name: "constructor", file: "src/store.ts", owner: "Store", ownerFile: "src/store.ts" },
  /** The same member name on another class: ambiguity the hint must break. */
  ambiguous: { name: "constructor", file: "src/cache.ts", owner: "Cache" },
  /** The accessor: the gate derives the expected outcome from the stored type. */
  accessor: { name: "count", file: "src/store.ts", owner: "Store" },
  /** Never stored by any analyzer — a genuine absence. */
  absent: "t1_absent_symbol_zzz",
  /** A traversable root: the direct path must keep handling it. */
  direct: { name: "main", file: "src/app.ts" },
} as const

const FILES: Record<string, string> = {
  "src/store.ts": `// A store with a constructor (the member target), a getter (the accessor)
// and one plain method.
export class Store {
  private items: Map<string, number>

  constructor(initial: Array<[string, number]>) {
    this.items = new Map(initial)
  }

  get count(): number {
    return this.items.size
  }

  add(key: string, value: number): void {
    this.items.set(key, value)
  }
}
`,
  "src/cache.ts": `// A SECOND \`constructor\` in the same project: a name-only lookup cannot
// choose between it and Store's, so it must stay a declared error.
export class Cache {
  private entries: string[]

  constructor(entries: string[]) {
    this.entries = entries
  }

  size(): number {
    return this.entries.length
  }
}
`,
  "src/app.ts": `// The call sites: Store is instantiated here, so the owner-rooted impact of
// its constructor must come back as this function.
import { Store } from "./store"

export function main(): number {
  const s = new Store([["a", 1]])
  s.add("b", 2)
  return s.count
}
`,
  "package.json": `{
  "name": "bb-m55-t1-fixture",
  "private": true,
  "version": "0.0.0"
}
`,
}

/** Write the fixture workspace (idempotent). */
export function writeT1Fixture(): void {
  for (const [rel, body] of Object.entries(FILES)) {
    const abs = path.join(T1_ROOT, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
}
