/**
 * OBJC — READ THE SPELLED TARGETS OFF THE ANALYZER, never off a guess.
 *
 * The family binding spelling (`<callable>\u0000<binding>`) changed the TARGET of every unit-local
 * read the lane publishes, so the three fixtures that pinned the old bare spelling have to be
 * re-pinned to strings the analyzer actually emits. This dump is the evidence for those pins: it
 * runs the same `parseFile` production runs, over the fixture sources the pins name, and prints
 * every `uses` edge whose target carries the separator, JSON-escaped, with its metadata flags.
 *
 * Run:  bun run validation/m14/fixtures/objc/binding-spelling-dump.ts
 */
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const FIX = import.meta.dir
const FILES = ["bare-value-reads.m", "generics-and-reason-codes.m", "second-review.m", "edges-and-patterns.m", "field-invocation.m"]
for (const f of FILES) {
  const abs = path.join(FIX, f)
  const r: any = await parseFile(abs, FIX, { projectRoot: FIX } as any)
  if (!r) { console.log(`${f}: NO RESULT`); continue }
  const spelled = (r.relationships ?? []).filter((x: any) => String(x.target ?? "").includes("\u0000"))
  console.log(`\n=== ${f} — ${spelled.length} spelled target(s) of ${(r.relationships ?? []).length} edge(s) ===`)
  for (const x of spelled) {
    const md: any = x.metadata ?? {}
    console.log(`  ${x.type} ${JSON.stringify(String(x.source))} -> ${JSON.stringify(String(x.target))}` +
      ` line=${x.line_number} isBareRead=${!!md.isBareRead} isFieldRead=${!!md.isFieldRead} localBinding=${!!md.localBinding} reasonCode=${JSON.stringify(md.reasonCode ?? null)}`)
  }
}
