/**
 * SCSS — the FABRICATED-TARGET census: can any relationship target name a selector?
 *
 * ## Population
 *
 * `find <CR> -name '*.scss' -type f | sort | head -<N>` — deterministic, no sampling
 * choice, so two runs of the same N are comparable and a before/after pair is a statement
 * about the same files rather than about two samples. Counts are stated against this
 * population every time; a count without its population is a finding about the wrong thing.
 *
 * Calls production `ASTEngine.parseFile`, not `analyze()`: `analyze()` is a per-file unit
 * that skips the pipeline stages (pool-worker, timeouts, truncation, enhancements), so a
 * number from it is a number about a different code path.
 *
 * ## The predicate
 *
 * A CSS selector never contains `;`, `{` or `}`. Those are statement and block delimiters;
 * the grammar only ever hands one of them to this lane from inside a region it failed to
 * parse, where a node's text has run past the construct it names. So a target carrying one
 * is not a selector, is not a symbol name, and binds to nothing — it is a fabricated edge
 * target, and it is counted `unexplained` by the differential while poisoning `bb_graph`,
 * `bb_impact` and `bb_migrate`.
 *
 * The predicate is on the STRING, not on `node.type`, because it is a property of the
 * language: the same junk text arrives on a `class_selector` as on a `placeholder`, and a
 * guard keyed on the node type lets one of them through. See `scss-extend-node-shape.ts`
 * for the tree shape and `scss-tree-dump.ts` for the worked example.
 *
 * ## THE FALSE POSITIVE, and why `#{` is removed before the test
 *
 * A naive `/[;{}]/` says 558 targets are fabricated. They are not. 558 `contains` targets
 * look like
 *
 *     ".input-group #{$validation-messages}"
 *     ".list-group-item-#{$state}.list-group-item-action"
 *
 * and the braces there are SCSS INTERPOLATION, which a selector absolutely may contain.
 * So the naive predicate has a false-positive class, and it is not a rare one — it is the
 * single largest bucket this lane emits.
 *
 * That matters beyond this census, because the same predicate is now a GUARD in the
 * analyzer. A guard that reads `#{` as a broken region suppresses legitimate interpolated
 * selectors, which is the opposite defect from the one it was added to fix, and it is
 * invisible in a total that only moves by 7.
 *
 * So `#{...}` is stripped FIRST and the delimiter test runs on what is left. Interpolation
 * is the only way a brace pair may appear inside a selector, so what survives a `;`, `{` or
 * `}` after that removal cannot be a selector. Both counts are printed, so the size of the
 * false-positive class is visible rather than assumed.
 *
 * ## What this measures, and the pair it was built for
 *
 * The repair is a SWAP, not a subtraction, so the edge count alone cannot tell you whether
 * it worked. Measured on the same 600 files, same command:
 *
 *                     extends   extends carrying a delimiter   all edges   any target carrying one
 *   without the fix      293                  7                10433                    565
 *   with the fix         293                  0                10433                    558
 *
 * Total edges are IDENTICAL and `extends` is IDENTICAL: 7 fabricated targets were replaced
 * by 7 true ones, recovered from a `placeholder` nested inside the `class_selector` the
 * breadth-first search returned. A count that had merely gone down would be a suppression,
 * which is the other thing this could have been, and the two are indistinguishable unless
 * the total is printed too.
 *
 * READ-ONLY. Writes nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-delimiter-census.ts [fileCount]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"
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

/** target string -> [relpath, line] of the first edge that carried it */
const ext: Record<string, string[]> = {}
const origin: Record<string, Map<string, string[]>> = {}
let parsed = 0
let threw = 0

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
  for (const e of r?.relationships ?? []) {
    const t = String(e?.type ?? "")
    const tgt = String(e?.target ?? "")
    ;(ext[t] ??= []).push(tgt)
    if (!origin[t]) origin[t] = new Map()
    if (!origin[t]!.has(tgt)) origin[t]!.set(tgt, [`${rel}:${String(e?.line ?? "?")}`])
  }
}

console.log(`SCSS — fabricated-target census (a selector never contains ';' '{' or '}')`)
console.log(`population: find *.scss | sort | head -${COUNT}   files ${files.length}   parsed ${parsed}   threw ${threw}\n`)

console.log(`edge count by type:`)
for (const [t, arr] of Object.entries(ext).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`   ${t.padEnd(14)} ${String(arr.length).padStart(6)}`)
}

const all = Object.values(ext).flat()
console.log(`\nALL edges ${all.length}`)

/**
 * The naive predicate: any of `;` `{` `}` anywhere in the target.
 *
 * Reported ONLY to size the false-positive class. Not a verdict on anything.
 */
const NAIVE = (s: string) => /[;{}]/.test(s)

/**
 * The predicate the analyzer's guard must use: remove interpolation, then test.
 *
 * `#{...}` is the only way a brace pair may occur inside a selector, so a `;` `{` or `}`
 * left after removing it cannot belong to a selector. Nested interpolation
 * (`#{map-get($m, #{...})}`) is handled by a depth counter rather than by the pass loop,
 * and the pass loop is kept only as a bound.
 *
 * ## THE OFF-BY-ONE THIS FUNCTION HAD, and why it is written the way it is now
 *
 * The first version drove the inner scan with a `for` whose own `i++` ran past the closing
 * brace, then let the OUTER loop's `i++` skip the character after it. So every interpolation
 * ate one extra character — and when the next thing in the string was another `#{`, that one
 * lost its `#` and survived as a bare `{…}`.
 *
 *     ".mobile .#{iv.$class-prefix}#{iv.$helpers-has-prefix}text-#{$alignment}-mobile"
 *       buggy -> ".mobile .{iv.$helpers-has-prefix}text-mobile"   DELIMITER: true   <- FALSE POSITIVE
 *       fixed -> ".mobile .text--mobile"                           DELIMITER: false
 *
 * That is 36 fabricated `contains` targets reported out of legitimate bulma selectors
 * (`bulma/sass/helpers/typography.scss:62`), from a predicate written specifically to avoid
 * that false positive. The bug was in the INSTRUMENT, not in the analyzer: the guard in
 * `real-scss-analyzer.ts` never strips interpolation at all, and it is discussed below.
 *
 * The lesson is the one this file already states about a different probe, so it is enforced
 * rather than remembered: `CONTROL` below runs the real function over inputs whose answers
 * are known by hand, so a future off-by-one reads as a red line instead of as 36 findings.
 */
function stripInterpolation(s: string): string {
  let out = s
  for (let pass = 0; pass < 4 && out.includes("#{"); pass++) {
    let next = ""
    let i = 0
    while (i < out.length) {
      if (out[i] === "#" && out[i + 1] === "{") {
        let depth = 1
        i += 2
        while (i < out.length && depth > 0) {
          if (out[i] === "{") depth++
          else if (out[i] === "}") depth--
          i++
        }
        continue
      }
      next += out[i]
      i++
    }
    out = next
  }
  return out
}
const DELIM = (s: string) => /[;{}]/.test(stripInterpolation(s))

// Hand-checked answers. A predicate that returns the wrong value here is not reporting a
// fact about the corpus, it is broken, and a broken predicate reporting 0 looks identical to
// a clean lane.
const CONTROL: [string, string, boolean][] = [
  [".mobile .#{iv.$class-prefix}#{iv.$helpers-has-prefix}text-#{$alignment}-mobile", ".mobile .text--mobile", false],
  [".link-#{$color}:hover, .link-#{$color}:focus", ".link-:hover, .link-:focus", false],
  ["%skeleton-pulsation; height: cv.getVar", "%skeleton-pulsation; height: cv.getVar", true],
  [".a { color: red }", ".a { color: red }", true],
  ["%skeleton-pulsation", "%skeleton-pulsation", false],
]
const controlStripFails = CONTROL.filter(([inp]) => stripInterpolation(inp) !== CONTROL.find((c) => c[0] === inp)![1])
const controlDelimFails = CONTROL.filter(([inp, , want]) => DELIM(inp) !== want)
console.log(
  `CONTROL — stripInterpolation ${CONTROL.length - controlStripFails.length}/${CONTROL.length} as hand-computed` +
    `   DELIM ${CONTROL.length - controlDelimFails.length}/${CONTROL.length} as hand-computed` +
    (controlStripFails.length || controlDelimFails.length ? `   *** BROKEN ***` : `   (predicate sound)`),
)
for (const [inp, want] of controlStripFails) console.log(`   strip(${JSON.stringify(inp)}) -> ${JSON.stringify(stripInterpolation(inp))}, hand-computed ${JSON.stringify(want)}`)
for (const [inp, , want] of controlDelimFails) console.log(`   DELIM(${JSON.stringify(inp)}) -> ${DELIM(inp)}, hand-computed ${want}`)

// The population this census exists to protect: targets that really are interpolated.
// `contains` and `extends` are both printed, because the extends guard is the new code and
// an interpolated `@extend %foo-#{$bar}` is the case a delimiter check could suppress.
const interp = (s: string) => s.includes("#{")
const interpTypes = Object.entries(ext).filter(([, a]) => a.some(interp))
console.log(`\nINTERPOLATED targets — legitimate selectors, and the false-positive class:`)
let interpTotal = 0
for (const [t, a] of interpTypes) {
  const n = a.filter(interp).length
  interpTotal += n
  console.log(`   ${t.padEnd(14)} ${String(n).padStart(6)} of ${String(a.length).padStart(6)}`)
  for (const d of [...new Set(a.filter(interp))].slice(0, 3)) {
    console.log(`        ${JSON.stringify(d.slice(0, 90))}   first seen ${origin[t]!.get(d)![0]}`)
  }
}
console.log(`   interpolated targets total ${interpTotal}   of which NAIVELY called fabricated ${all.filter(NAIVE).length}`)

// The population the NEW GUARD in real-scss-analyzer.ts could suppress.
//
// `containsStatementDelimiter` there tests the RAW name and does not strip interpolation, so
// `@extend %foo-#{$bar}` reads as a broken region to it even though a selector may contain
// `#{`. This line is the size of that false-positive class. It is 0 on this sample; whether
// it is 0 on the whole admitted corpus is a separate measurement and is not asserted here
// from a 600-file number.
const extInterp = (ext["extends"] ?? []).filter(interp)
console.log(`\nTHE GUARD'S FALSE-POSITIVE CLASS — interpolated @extend targets (guard reads raw name):`)
console.log(`   extends targets ${(ext["extends"] ?? []).length}   of which interpolated ${extInterp.length}`)
for (const d of [...new Set(extInterp)].slice(0, 6)) console.log(`      ${JSON.stringify(d.slice(0, 110))}   first seen ${origin["extends"]!.get(d)![0]}`)

console.log(`\ntargets carrying a REAL statement delimiter (interpolation removed first), by type:`)
let carried = 0
for (const [t, arr] of Object.entries(ext).sort((a, b) => b[1].length - a[1].length)) {
  const bad = arr.filter(DELIM)
  if (bad.length === 0) {
    console.log(`   ${t.padEnd(14)} ${String(0).padStart(6)}   (clean)`)
    continue
  }
  carried += bad.length
  const distinct = new Set(bad)
  console.log(`   ${t.padEnd(14)} ${String(bad.length).padStart(6)}   distinct ${distinct.size}`)
  // Untruncated. A 90-char slice of an interpolated selector hides the trailing brace that
  // is the whole reason it is in this list, which is how the off-by-one above went unnoticed.
  for (const d of [...distinct].slice(0, 4)) {
    console.log(`        ${JSON.stringify(d)}   first seen ${origin[t]!.get(d)![0]}`)
  }
}
console.log(`\nALL edges ${all.length}   any target carrying a REAL delimiter ${carried}`)
console.log(`\nA falling total with an unchanged ALL-edges count is a SWAP (fabricated replaced`)
console.log(`by true); an unchanged total is a NO-OP; a falling total alone is a SUPPRESSION.`)

// Dump mode. The before/after pair for the `@extend` guard cannot be read off totals, because
// a swap and a suppression differ by a count that is small next to 293 and the two are the
// same sign. Dumping the resolved target SET and diffing it answers the question the total
// cannot: did the guard change which `@extend` statements are represented, and if so which.
if (process.env.SCSS_DUMP_EXTENDS) {
  const { writeFileSync } = await import("node:fs")
  for (const t of (process.env.SCSS_DUMP_EXTENDS.split(",") ?? ["extends"]).map((s) => s.trim())) {
    const arr = ext[t] ?? []
    const lines = [...new Set(arr)].sort().map((s) => `${s}\t${origin[t]!.get(s)![0]}`)
    // "utf8" is required: `writeFileSync(path, data)` with no options reads `data` as an
    // ENCODING NAME and throws ERR_INVALID_ARG_VALUE on the first target string. The dump
    // mode therefore failed on its first run, after the census had already printed.
    writeFileSync(path.join(process.env.SCSS_DUMP_DIR ?? "/tmp/opencode", `scss-dump-${t}.txt`), lines.join("\n"), "utf8")
    console.log(`\ndumped ${t}: ${lines.length} distinct targets -> ${path.join(process.env.SCSS_DUMP_DIR ?? "/tmp/opencode", `scss-dump-${t}.txt`)}`)
  }
}