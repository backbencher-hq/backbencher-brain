// script/m55/t2-fixture.ts — M55.T2 (issue #771) fixture, authored BEFORE the
// fix (F7 rule: fixture-first).
//
// The fixture reproduces, in miniature, every shape the step-zero wire probe
// found on the owner's real index — plus the shapes the contract must hold for
// but no demo symbol provides:
//
//   store.ts     a member calling a SAME-NAMED method on another receiver
//                (`this.items.get(key)` inside `get`) → the analyzer stores a
//                `get → get` row, which is NOT a call of this symbol. This is
//                the artifact the call hierarchy must drop and declare.
//   loop.ts      genuine self-recursion (`loop` calls `loop`) → must be KEPT
//                and labeled `recursive`.
//   mutual.ts    a ↔ b mutual pair → a cycle the editor must survive.
//   chain.ts     top → mid → deep (3 deep) → depth/ordering.
//   multi.ts     one caller, TWO call sites of `deep` → fromRanges must carry
//                both invocations (the engine dedupes per caller symbol).
//   store.ts     `set` is never called → declared absence must be possible.
//
// Every expectation below is authored here and asserted by
// script/m55/verify-call-hierarchy.ts against the REAL indexer, the REAL
// server and the component. Positions in the expectations are 0-based LSP.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const T2_ROOT = path.join(process.cwd(), "validation/m55/fixtures/t2-workspace");

export const T2_FILES: Record<string, string> = {
  "package.json": `{\n  "name": "t2-fixture",\n  "type": "module"\n}\n`,
  "src/store.ts": `export class Store<T> {
  private items: Map<string, T>;

  constructor(initial: Array<[string, T]>) {
    this.items = new Map(initial);
  }

  get(key: string): T | undefined {
    return this.items.get(key);
  }

  set(key: string, value: T): void {
    this.items.set(key, value);
  }
}
`,
  "src/loop.ts": `export function loop(n: number): number {
  if (n <= 0) return 0;
  return loop(n - 1) + 1;
}
`,
  "src/mutual.ts": `export function a(n: number): number {
  return b(n) + 1;
}

export function b(n: number): number {
  return a(n - 1) + 1;
}
`,
  "src/mid.ts": `import { deep } from "./deep.js";

export function mid(): number {
  return deep();
}
`,
  "src/deep.ts": `export function deep(): number {
  return 1;
}
`,
  "src/chain.ts": `import { mid } from "./mid.js";

export function top(): number {
  return mid();
}
`,
  "src/multi.ts": `import { deep } from "./deep.js";

export function many(): number {
  const first = deep();
  const second = deep();
  return first + second;
}
`,
};

/** Authored expectations (0-based LSP lines, verified against the fixture text
 *  above by the verifier — a drifting fixture fails rather than silently
 *  re-baselining). */
export const T2_EXPECT = {
  store: { rel: "src/store.ts", getLine1: 8, setLine1: 12 },
  loop: { rel: "src/loop.ts", line1: 1, recursiveCallLine1: 3 },
  mutual: { rel: "src/mutual.ts", aLine1: 1, bLine1: 5 },
  chain: { rel: "src/chain.ts", topLine1: 3, midLine1: 3, deepLine1: 1 },
  multi: { rel: "src/multi.ts", manyLine1: 3, deepCallLines1: [4, 5] },
  /** A line with no symbol on it at all (declared absence). `mutual.ts` line 4
   *  is the fixture's one truly empty line — line 2 is a call, so a position
   *  there resolves to the ENCLOSING function and is not an absence at all
   *  (the first run of this suite made that mistake). */
  blankLine: { rel: "src/mutual.ts", line1: 4 },
} as const;

export function writeT2Fixture(): void {
  rmSync(T2_ROOT, { recursive: true, force: true });
  for (const [rel, text] of Object.entries(T2_FILES)) {
    const abs = path.join(T2_ROOT, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  }
}

/** The fixture's own oracle: a line's text, 1-based — the verifier uses this to
 *  prove every position it asserts is inside the file it claims. */
export function fixtureLine(rel: string, line1: number): string {
  const text = T2_FILES[rel];
  if (text === undefined) throw new Error(`no fixture file ${rel}`);
  return text.split("\n")[line1 - 1] ?? "";
}
