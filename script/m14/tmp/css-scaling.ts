// Review instrument (NOT a gate): measure whether the CSS analyzer's cost grows
// LINEARLY with input size, or super-linearly.
//
//   bun script/m14/tmp/css-scaling.ts
//
// Why this exists: "no regression" and "correct" are both about VALUES, and
// neither says anything about how the cost GROWS. A quadratic analyzer passes
// every correctness gate this lane has and is still wrong — it just gets wrong
// slowly, and only on the files nobody happened to test. Reading the source finds
// the quadratic you can see; this finds the one you cannot, by holding the shape
// fixed and varying only the size.
//
// Method: synthetic CSS of geometrically increasing size, so the only variable is
// the number of rules. The selector shape is held CONSTANT across sizes — a
// complexity metric that is quadratic would show up here as a rising cost per
// rule, and so would a quadratic in selector LENGTH, so both axes are reported.
// Each size is run several times and the MINIMUM is taken, because the box is
// shared and a median would measure the neighbours as much as the analyzer.
//
// Reported: ms/file, ms/rule, and the ratio of successive ms/rule values. A linear
// analyzer holds ms/rule flat; a quadratic one doubles it per doubling.

import { mkdirSync, writeFileSync, rmSync } from "fs"
import { ASTEngine } from "../../../src/ast/engine"

const DIR = "/tmp/opencode/css-scaling"
rmSync(DIR, { recursive: true, force: true })
mkdirSync(DIR, { recursive: true })

/** `n` independent rules, each with the SAME selector shape, so size is the only variable. */
function makeRules(n: number, selector: (i: number) => string): string {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(`${selector(i)} { color: #${(i % 10)}${(i % 7)}${(i % 5)}${(i % 3)}; }`)
  return out.join("\n") + "\n"
}
const SHAPES: Record<string, (i: number) => string> = {
  "one class (simplest)": (i) => `.c${i}`,
  "class + descendant": (i) => `.a${i} .b${i}`,
  "class + functional pseudo": (i) => `.c${i}:not(.d${i})`,
  "comma group of 3": (i) => `.p${i}, .q${i}, .r${i}`,
}
const SIZES = [250, 500, 1000, 2000, 4000, 8000]
const REPEATS = 5

// `parseFile` is ASYNC, and the first version of this instrument did not await it:
// every point came back 0.0 ms because the timer stopped when the promise was
// created rather than when the parse finished. A scaling test that measures 0 at
// every size is not a fast analyzer, it is an unmeasured one — so the await is
// load-bearing and the first point above 0 is the one that proves it.
async function best(fn: () => Promise<unknown>): Promise<number> {
  let b = Number.POSITIVE_INFINITY
  for (let i = 0; i < REPEATS; i++) {
    const t0 = performance.now()
    await fn()
    const dt = performance.now() - t0
    if (dt < b) b = dt
  }
  return b
}

console.log(`min of ${REPEATS} runs per point; sizes ${SIZES.join(", ")} rules\n`)
for (const [name, sel] of Object.entries(SHAPES)) {
  const f = `${DIR}/scale.css`
  console.log(`shape: ${name}`)
  console.log(`  ${"rules".padStart(6)} ${"bytes".padStart(9)} ${"ms".padStart(9)} ${"ms/rule".padStart(10)} ${"x prev".padStart(8)}`)
  let prevRatio = ""
  for (const n of SIZES) {
    const src = makeRules(n, sel)
    writeFileSync(f, src)
    const bytes = Buffer.byteLength(src)
    const ms = await best(() => ASTEngine.parseFile(f, src))
    const perRule = ms / n
    const ratio = prevRatio ? (perRule / Number(prevRatio)).toFixed(2) + "x" : ""
    console.log(`  ${String(n).padStart(6)} ${String(bytes).padStart(9)} ${ms.toFixed(1).padStart(9)} ${perRule.toFixed(4).padStart(10)} ${ratio.padStart(8)}`)
    prevRatio = perRule.toFixed(6)
  }
  console.log()
}

// The other axis: one rule, a selector of growing LENGTH. A quadratic in selector
// length is a different bug from a quadratic in rule count and is not caught above.
console.log("axis 2: ONE rule, selector of growing length")
console.log(`  ${"parts".padStart(6)} ${"bytes".padStart(9)} ${"ms".padStart(9)} ${"ms/part".padStart(10)} ${"x prev".padStart(8)}`)
{
  const f = `${DIR}/len.css`
  let prev = ""
  for (const parts of [10, 20, 40, 80, 160, 320]) {
    const sel = Array.from({ length: parts }, (_, i) => `.c${i}`).join(" .d")
    const src = `${sel} { color: red; }\n`
    writeFileSync(f, src)
    const bytes = Buffer.byteLength(src)
    const ms = await best(() => ASTEngine.parseFile(f, src))
    const per = ms / parts
    const ratio = prev ? (per / Number(prev)).toFixed(2) + "x" : ""
    console.log(`  ${String(parts).padStart(6)} ${String(bytes).padStart(9)} ${ms.toFixed(1).padStart(9)} ${per.toFixed(3).padStart(10)} ${ratio.padStart(8)}`)
    prev = per.toFixed(6)
  }
}
rmSync(DIR, { recursive: true, force: true })
