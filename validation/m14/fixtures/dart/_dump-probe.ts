/**
 * EVERY EDGE ONE SOURCE EMITS — the raw dump behind `field-receiver-probe.ts`'s one-line verdicts.
 *
 * The shape probe answers "did this declaration form type its receiver"; this answers "what ELSE
 * moved when it did", which is what a change to the binding block can silently do. Run it before
 * and after such a change and diff the two outputs; the 2026-10-16 investigation used exactly this
 * to find that the wrapper fix also emits a bare second-link read of a chain
 * (`_addParameters(node.parameters.parameters)` gained a `uses -> parameters` row that HEAD did not
 * emit) — a movement the twelve-shape table could not show.
 *
 * Each case is parsed through the production entry point (`parseFile`) from a temp directory with a
 * `pubspec.yaml`, so the analyzer sees the same project-rooted invocation it sees in the corpus.
 *
 * Usage: bun run validation/m14/fixtures/dart/_dump-probe.ts
 */
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const HELPER = `class Helper { void poke() {} }\n`
const CASES: Array<{ label: string; src: string }> = [
  { label: "1 top-level fn param", src: HELPER + `void f(Helper p) { p.poke(); }\n` },
  { label: "2 method param", src: HELPER + `class A { void run(Helper p) { p.poke(); } }\n` },
  { label: "3 method local ctor", src: HELPER + `class A { void run() { final l = Helper(); l.poke(); } }\n` },
  { label: "4 top-level fn local ctor", src: HELPER + `void f() { final l = Helper(); l.poke(); }\n` },
  { label: "5 method closure param", src: HELPER + `class A { void run() { final cb = (Helper q) { q.poke(); }; cb(Helper()); } }\n` },
  { label: "6 method forin typed", src: HELPER + `class A { void run() { for (final Helper r in <Helper>[]) { r.poke(); } } }\n` },
  { label: "7 top-level fn forin typed", src: HELPER + `void f() { for (final Helper r in <Helper>[]) { r.poke(); } }\n` },
  { label: "8 chain on a typed param", src: HELPER + `class A { void run(Helper p) { p.poke(); } }\nclass B { void m(A node) { node.poke(); } }\n` },
]

for (const c of CASES) {
  const root = mkdtempSync(path.join(tmpdir(), "dart-dump-"))
  writeFileSync(path.join(root, "pubspec.yaml"), "name: probe\n")
  const file = path.join(root, "probe.dart")
  writeFileSync(file, c.src)
  const r: any = await parseFile(file, root)
  console.log(`\n### ${c.label}`)
  for (const rel of r.relationships ?? []) {
    if (rel.type === "contains") continue
    console.log(
      `  ${String(rel.line_number).padStart(2)} ${String(rel.type).padEnd(12)} ${String(rel.source).padEnd(8)} -> ` +
      `${String(rel.target).replace(/\u0000/g, "<SEP>").padEnd(20)} ${JSON.stringify(rel.metadata ?? {})}`,
    )
  }
}
