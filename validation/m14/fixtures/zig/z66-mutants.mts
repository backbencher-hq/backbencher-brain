/**
 * Z66 MUTANTS — the fixture must be able to FAIL.
 *
 * A fixture that passes is evidence only if some plausible wrong implementation
 * would not pass it. Each mutant below is one such implementation, applied to the
 * working tree, measured, and reverted; the lane is green only when every mutant
 * is caught by `validation/m14/fixtures/zig/alias-receiver.expectation.json` (or,
 * for M1, by the four fixtures that changed spelling with it).
 *
 * Run: npx tsx validation/m14/fixtures/zig/z66-mutants.mts
 * Exit 0 = every mutant caught. Exit 1 = a mutant survived, which means the
 * fixture is not falsifiable and the fix is untested in the direction that matters.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "../../../..")
const ANALYZER = resolve(ROOT, "src/ast/real-zig-analyzer.ts")

const MUTANTS: { id: string; find: string; replace: string; why: string }[] = [
  {
    id: "M1",
    find: "    if (!hit || !hit.external) return null",
    replace: "    if (!hit) return null",
    why: "remove the external/local distinction so a LOCAL module alias is qualified too \u2014 the over-correction. `c.COUNT` becomes `c.COUNT` as a target and the local-half forbid fires.",
  },
  {
    id: "M2",
    find: "for (const s of shadowed) imports.delete(s)",
    replace: "for (const s of shadowed) void s",
    why: "drop the shadow guard, so a name bound by @import AND by a struct literal is still treated as an alias \u2014 the fabrication the guard exists to prevent. The shadowed-print forbid fires.",
  },
  {
    id: "M3",
    find: "      if (base.type === \"identifier\") { root = stripZigQuoting(String(base.text ?? \"\")); break }",
    replace: "      if (base.type === \"identifier\") { root = stripZigQuoting(String(base.text ?? \"\")); segments.length = 1; break }",
    why: "keep only the LAST segment when the base is a plain name, which is the bare-leaf behaviour for every two-or-more-segment path. `std.debug.assert` and `std.io.getStdOut` become `assert` / `getStdOut` and their forbids fire.",
  },
  {
    id: "M4",
    find: "    return { target: `${root}.${segments.join(\".\")}`, alias: root, module: hit.module }",
    replace: "    return { target: `${hit.module}.${segments.join(\".\")}`, alias: root, module: hit.module }",
    why: "publish the MODULE name where the source writes the ALIAS (`gobject.Object.new` for `g.Object.new`). Every other row in the fixture binds an alias whose name equals its module path, so this is the only mutant that can tell the two apart \u2014 which is why the fixture carries the `g`/`gobject` rows.",
  },
  {
    id: "M5",
    find: "    if (!leaf) return undefined\n    const parent = leaf.parent",
    replace: "    if (!leaf) return undefined\n    return undefined\n    const parent = leaf.parent",
    why: "zigTrailingFieldExpr always refuses, so NO declared-type read is qualified \u2014 a half-finished fix that wires only the two code-relationship passes. The declared-type positive row for std.ArrayList fails.",
  },
]

function run(cmd: string): { code: number; out: string } {
  try {
    const out = execFileSync("bash", ["-lc", cmd], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] })
    return { code: 0, out }
  } catch (e: any) {
    return { code: typeof e.status === "number" ? e.status : 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }
  }
}

const original = readFileSync(ANALYZER, "utf8")
const survivors: string[] = []
const noop: string[] = []

try {
  for (const m of MUTANTS) {
    if (!original.includes(m.find)) {
      survivors.push(`${m.id}: ANCHOR NOT FOUND \u2014 the mutant was not applied, so the fixture was never tested against it. find=${JSON.stringify(m.find.slice(0, 60))}`)
      continue
    }
    const mutated = original.replace(m.find, m.replace)
    if (mutated === original) {
      noop.push(m.id)
      continue
    }
    writeFileSync(ANALYZER, mutated)
    const r = run("timeout 900 bun run script/m14/run-fixtures.ts --lang zig 2>&1")
    // The runner's EXIT CODE is not the verdict: a scoped `--lang` run exits 0 with
    // failing fixtures in its output, so the verdict is read from the report. Measured,
    // not assumed — the first version of this file gated on `r.code !== 0` and
    // reported five survivors that the same run reports as caught.
    const caught = /FAIL\s+zig\//.test(r.out)
    writeFileSync(ANALYZER, original)
    if (!caught) survivors.push(`${m.id}: SURVIVED (exit ${r.code}) \u2014 ${m.why}`)
    else console.log(`caught  ${m.id}  ${m.why.split(" \u2014 ")[0]}`)
  }
} finally {
  writeFileSync(ANALYZER, original)
}

console.log()
if (noop.length > 0) console.log(`no-op mutants (a mutation that changes nothing, reported rather than skipped): ${noop.join(", ")}`)
if (survivors.length > 0) {
  console.log(`SURVIVORS (${survivors.length}):`)
  for (const s of survivors) console.log(`  ${s}`)
  process.exit(1)
}
console.log(`all ${MUTANTS.length - noop.length} applied mutants caught; the analyzer is restored`)