/**
 * SCSS — `extends` RESOLUTION, before and after a change, on one population.
 *
 * ## Why this instrument exists
 *
 * `scss-delimiter-census.ts` reports edge COUNTS and the target SET. Neither settles whether
 * a change helped. A repair that swaps 7 fabricated targets for 7 true ones keeps the count
 * at 293, and a repair that suppresses a statement and one that re-attributes it to a
 * different real placeholder both move the distinct count by a few. The only number that
 * separates them is: does the edge now BIND to a symbol?
 *
 * ## The measurement
 *
 * For every `extends` edge, resolve `target` against the symbol names published by the SAME
 * file, and report the rate. Same-file is the strict test — `extends` resolution is a
 * within-file question for the overwhelming majority of real `@extend`s, and a cross-file
 * count would let a window artefact read as a fix.
 *
 * ## Why same-file is not the whole story, stated rather than implied
 *
 * A real corpus separates them: `bulma/sass/components/breadcrumb.scss` writes
 * `@extend %block;` and `%block` is declared in `bulma/sass/utilities/extends.scss`, a
 * different file. Those edges are TRUE and they do not resolve same-file. So a same-file rate
 * is a LOWER bound on resolution and a rise in it is real, while a flat rate does not prove
 * the change did nothing — a change that re-attributes an edge from one real placeholder to
 * another real placeholder in another file moves the cross-file count and not the same-file
 * one. `cssSpecific` is reported alongside because a selector-synthesised name
 * (`.bd-tabs-nav button`) is a name this lane publishes itself, and a consumer resolving an
 * edge has to be able to reproduce that spelling.
 *
 * READ-ONLY. Writes nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-extends-resolution.ts [fileCount] > before.txt
 *   # swap the analyzer, re-run to the same fileCount > after.txt, diff the RATE lines
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"

const COUNT = Number(process.argv[2] ?? 600)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const files = execFileSync("bash", ["-lc", `find ${CR} -name '*.scss' -type f | sort | head -${COUNT}`], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .trim()
  .split("\n")
  .filter(Boolean)

let edges = 0
let srcOk = 0
let tgtOk = 0
let bothOk = 0
const unresolved = new Map<string, string>()
const byKind = new Map<string, { n: number; ok: number }>()
let parsed = 0
let threw = 0
/** one line per extends edge: file, line, target, whether it resolved */
const rows: string[] = []
/** "relpath:line" -> emitted target, for the text oracle below */
const oraclePairs: [string, string][] = []

for (const f of files) {
  let r: any
  try {
    r = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
  } catch {
    threw++
    continue
  }
  parsed++
  const rel = f.replace(`${CR}/`, "")
  const names = new Set<string>((r?.symbols ?? []).map((s: any) => String(s?.name ?? "")))
  for (const e of r?.relationships ?? []) {
    if (String(e?.type) !== "extends") continue
    const src = String(e?.source ?? "")
    const tgt = String(e?.target ?? "")
    edges++
    const s = names.has(src)
    const t = names.has(tgt)
    const key = `${rel}:${String(e?.line_number ?? "?")}`
    rows.push(`${key}\t${tgt}\t${t ? "RESOLVED" : "unresolved"}`)
    oraclePairs.push([key, tgt])
    if (s) srcOk++
    if (t) tgtOk++
    if (s && t) bothOk++
    if (!t && !unresolved.has(tgt)) unresolved.set(tgt, rel)
    // is the target a name the lane SYNTHESISED from a compound selector, or one the file wrote?
    const k = String((e?.metadata ?? {}).cssSpecific === true ? "cssSpecific" : "plain")
    const cur = byKind.get(k) ?? { n: 0, ok: 0 }
    cur.n++
    if (t) cur.ok++
    byKind.set(k, cur)
  }
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`)
console.log(`SCSS — \`extends\` resolution, same-file, production parseFile`)
console.log(`population: find *.scss | sort | head -${COUNT}   files ${files.length}   parsed ${parsed}   threw ${threw}`)
console.log(`RATE extends edges ${edges}   source resolves ${srcOk} (${pct(srcOk, edges)})   TARGET resolves ${tgtOk} (${pct(tgtOk, edges)})   both ${bothOk} (${pct(bothOk, edges)})`)
console.log(`distinct unresolved targets ${unresolved.size}`)
for (const [t, f] of [...unresolved].slice(0, 12)) console.log(`   ${JSON.stringify(t.slice(0, 80))}   ${f}`)
for (const [k, v] of byKind) console.log(`   metadata ${k.padEnd(14)} edges ${String(v.n).padStart(4)}   target resolves ${v.ok} (${pct(v.ok, v.n)})`)

// Dump mode. The rate answers "did it get better"; this answers "WHICH EDGE", which is the
// only way to tell a re-attribution that costs a real binding from one that costs nothing.
// Without it a −1 is a number to report and not a defect to locate.
if (process.env.SCSS_DUMP_RESOLUTION) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(process.env.SCSS_DUMP_RESOLUTION, rows.join("\n"), "utf8")
  console.log(`\ndumped ${rows.length} edges -> ${process.env.SCSS_DUMP_RESOLUTION}`)
}

// ── AN INDEPENDENT ORACLE, because the same-file rate cannot be read as correctness ────
//
// Same-file resolution went DOWN by one when the byte bound landed, and reading that as a
// regression would be reading a metric as a verdict. The case is
// `consul/ui/packages/consul-ui/app/components/consul/health-check/list/skin.scss:22`:
//
//     %healthcheck-output pre,
//     %healthcheck-output pre code {
//       @extend %body-200-regular;        <- line 22, the file's own text
//
// The statement names `%body-200-regular`, which is declared in an `@use`d module. The
// pre-bound analyzer emitted `%healthcheck-output` — the enclosing rule's own name, declared
// in THIS file, therefore RESOLVING and therefore WRONG. So the bound lost a same-file
// resolution by replacing a wrong answer with a right one that happens to bind elsewhere.
//
// That is a claim about one line, and a claim about one line is not a measurement. So this
// compares EVERY emitted `extends` target against the `@extend` text on its own source line:
// an oracle over the raw characters, with no parse tree and no shared code with the analyzer.
//
// STATED LIMITATION, and it is the one that matters: this oracle is a TEXT reader, so a
// construct it cannot see in the text is invisible to it, and it inherits nothing from the
// grammar — which also means it cannot be fooled by a grammar bug, and cannot catch a bug in
// which statements are RECOGNISED at all (an `@extend` the analyzer never emits is simply
// absent from both sides). It audits labelling, not recall. Recall is the edge count above.
let oracleSeen = 0
let oracleMatch = 0
let oracleMissing = 0
const oracleMisses: string[] = []
for (const [key, target] of oraclePairs) {
  const [rel, line] = key.split(":")
  const src = readFileSync(`${CR}/${rel}`, "utf8").split("\n")[Number(line) - 1] ?? ""
  // the text between `@extend` and the next `;` — the statement's own argument, verbatim
  const at = src.indexOf("@extend")
  if (at < 0) {
    oracleMissing++
    continue
  }
  const arg = src
    .slice(at + "@extend".length)
    .split(";")[0]
    .replace(/\s+/g, " ")
    .trim()
  oracleSeen++
  // a comma-separated `@extend %a, %b` is one statement the lane can represent with one edge,
  // so a target that is one of the comma-separated parts is a match, not a near-miss
  const wanted = arg.split(",").map((s) => s.trim()).filter(Boolean)
  if (wanted.includes(target)) oracleMatch++
  else if (oracleMisses.length < 14) oracleMisses.push(`${rel}:${line}   emitted ${JSON.stringify(target)}   source @extend ${JSON.stringify(arg)}`)
}
console.log(`\nORACLE — emitted target vs the \`@extend\` text on its own line, no parse tree:`)
console.log(`   edges audited ${oracleSeen}   target IS what the source writes ${oracleMatch} (${oracleSeen ? ((100 * oracleMatch) / oracleSeen).toFixed(1) : "n/a"}%)`)
console.log(`   edges whose source line carries no \`@extend\` (line number disagrees with the text): ${oracleMissing}`)
for (const m of oracleMisses) console.log(`   MISS ${m}`)
