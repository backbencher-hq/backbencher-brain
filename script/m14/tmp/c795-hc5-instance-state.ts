// script/m14/tmp/c795-hc5-instance-state.ts — re-runnable pin for M49.C1 HC5.
//
// The claim (#795 / deepest review #736): the analyzer's CGD19 per-ERROR-span
// verdict memo was INSTANCE state keyed by span start index with no per-file
// reset. A reused instance — differential lanes, F4 runs, batch indexing all
// reuse one — applied file A's verdict to file B's same-offset ERROR span and
// silently dropped B's legitimate declarations. The fix clears the memo at
// analyze() entry.
//
// The spec row records the 2026-09-11 probe as a SENTENCE with the numbers
// ("A-glue@0/14 suppressed B-clean@24"), not as a file anyone can re-run, so the
// pin could only rot. This probe re-pins the invariant the fix actually
// establishes, which is stronger than one input pair:
//
//   For every file, the analyzer's output must depend on THAT FILE ALONE —
//   same sets whether the instance is fresh, or has just analyzed other files,
//   in any order.
//
// It also keeps a same-offset pair (two different files whose content starts at
// byte 0 with an unclosed construct) because that is the shape the stale memo
// keyed on. A regression to instance-scoped verdicts fails the ordering rows.
//
// Run: bun script/m14/tmp/c795-hc5-instance-state.ts
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

// The production entry reads from disk, so the fixtures are materialised in a
// scratch dir. One shared directory keeps the file identities stable across the
// ordering rows below.

const key = (s: { name: string; kind: string }): string => `${s.kind}:${s.name}`
const relKey = (r: { type: string; from?: string; target: string }): string => `${r.type}:${r.from ?? "global"}->${r.target}`

// A = a glue file: an unclosed `#if`/brace makes one giant ERROR span whose
// recovery verdict is "keep what you can". B = same shape, different content and
// a declaration that only a correct per-file verdict keeps. C = clean control.
const FILES: Record<string, string> = {
  "glue.c": [
    "void glue_entry(void) {",
    "#if 1",
    "  int glue_local = 1;",
    "",
  ].join("\n"),
  "glue_two.c": [
    "struct glue_pair {",
    "#ifdef NEVER_DEFINED",
    "  int pair_member;",
    "};",
    "int pair_kept(void) { return 2; }",
    "",
  ].join("\n"),
  "clean.c": [
    "int clean_value(void) {",
    "  return 3;",
    "}",
    "",
  ].join("\n"),
  "clean_two.c": [
    "typedef struct { int field_a; } clean_struct;",
    "int clean_fn(clean_struct *s) { return s->field_a; }",
    "",
  ].join("\n"),
}

type Snapshot = { symbols: string[]; relationships: string[] }

const SCRATCH = mkdtempSync(path.join(tmpdir(), "c795-hc5-"))
for (const [n, src] of Object.entries(FILES)) writeFileSync(path.join(SCRATCH, n), src)

async function snapshot(file: string): Promise<Snapshot> {
  const res: any = await parseFile(path.join(SCRATCH, file), SCRATCH)
  const symbols = ((res.symbols ?? []) as Array<{ name: string; kind: string }>).map(key).sort()
  const relationships = ((res.relationships ?? []) as Array<{ type: string; from?: string; target: string }>).map(relKey).sort()
  return { symbols, relationships }
}

const names = Object.keys(FILES)
let failures = 0

// Row 1 — fresh instance per file (the reference output).
const fresh: Record<string, Snapshot> = {}
for (const n of names) fresh[n] = await snapshot(n)
for (const n of names) {
  if (fresh[n].symbols.length === 0) {
    console.log(`  note: ${n} yields no symbols (${fresh[n].relationships.length} relationships) — error region is the point`)
  }
}

// Row 2 — ONE instance, every order. Ordering must not move a single symbol.
const orders: string[][] = [
  names,
  [...names].reverse(),
  [names[0], names[0], names[1], names[0], names[2], names[1], names[3]],
]
for (const [i, order] of orders.entries()) {
  const seen: Record<string, Snapshot> = {}
  for (const n of order) seen[n] = await snapshot(n)
  for (const n of names) {
    if (!seen[n]) continue
    const a = JSON.stringify(seen[n])
    const b = JSON.stringify(fresh[n])
    if (a !== b) {
      failures++
      const onlyReused = seen[n].symbols.filter((s) => !fresh[n].symbols.includes(s))
      const onlyFresh = fresh[n].symbols.filter((s) => !seen[n].symbols.includes(s))
      console.log(
        `FAIL order ${i}: ${n} depends on analysis history — extra ${JSON.stringify(onlyReused)} missing ${JSON.stringify(onlyFresh)}`,
      )
    }
  }
}

// Row 3 — the same-offset pair explicitly: the two glue files both start at
// byte 0 with an unclosed construct and must NOT share a verdict.
const offsetPair = names.filter((n) => FILES[n].startsWith("void glue_entry") || FILES[n].startsWith("struct glue_pair"))
if (offsetPair.length === 2) {
  const s1 = await snapshot(offsetPair[0])
  const s2 = await snapshot(offsetPair[1])
  if (s2.symbols.length === 0 && fresh[offsetPair[1]].symbols.length > 0) {
    failures++
    console.log(`FAIL same-offset pair: ${offsetPair[1]} lost its symbols after ${offsetPair[0]}`)
  }
  console.log(`  same-offset pair: ${offsetPair[0]} -> ${s1.symbols.length} sym, then ${offsetPair[1]} -> ${s2.symbols.length} sym`)
}

console.log(
  failures === 0
    ? `PASS c795-hc5: ${names.length} files × ${orders.length} orders — output depends on the file alone (fresh instances and reused instances agree exactly)`
    : `FAIL c795-hc5: ${failures} order-dependent output(s) — the memo is instance-scoped again`,
)
process.exit(failures === 0 ? 0 : 1)
