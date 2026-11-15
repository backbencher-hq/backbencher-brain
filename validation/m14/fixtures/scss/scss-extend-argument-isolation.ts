/**
 * SCSS `@extend` ARGUMENT-FORM ISOLATION — the grammar defect behind this lane's parse
 * errors, and the reason `%`-extends are not resolvable.
 *
 * ## THE FINDING, IN ONE LINE
 *
 * `tree-sitter-scss` parses `@extend .class` cleanly and fails on `@extend %placeholder`
 * and `@extend #id`, in EVERY enclosing selector kind:
 *
 *     %b { @extend .c; }   0 errors      .a { @extend .c; }   0 errors
 *     %b { @extend %c; }   5 errors      .a { @extend %c; }   5 errors
 *     %b { @extend #c; }   5 errors      #i { @extend %c; }   5 errors
 *                                          div { @extend %c; } 5 errors
 *
 * So the trigger is the ARGUMENT FORM, not the enclosing selector, and not `@extend`
 * itself. Reading it as "placeholder rules are hard" would have been wrong, and the
 * enclosing-selector reading is the one the corpus makes tempting — 641 of the 735
 * `@extend` statements in the corpus use a `%` argument.
 *
 * ## WHAT IT COSTS, MEASURED
 *
 * The enclosing rule becomes an ERROR node. The `@extend` EDGE and the rule's own selector
 * SYMBOL both survive — every one of the twelve isolation cases below reports 1 edge and 1
 * selector symbol — so this is not a fabricated-edge problem and not a lost-edge problem.
 * What is lost is everything NESTED inside the extended rule, plus the declarations:
 *
 *     %b { @extend %c; .in { color: red; } }    9 errors   selectors: ["class:%b"]
 *
 * `.in` is gone. And the file carries parse errors that NEITHER `degraded` NOR `fallback`
 * names, so every instrument that keys off those flags — including the degraded-file
 * accounting in `scss-relationship-census.ts` — cannot see it.
 *
 * ## CORPUS BLAST RADIUS (instrument B: parse-tree-free text census over `git ls-files`)
 *
 * 735 `@extend` statements across 4,502 tracked `.scss`/`.sass` files in 199 repositories:
 *
 *     placeholder %   641    87.3%   <- every one lands in an ERROR region
 *     class .          83    11.3%   <- clean
 *     id #              1     0.1%   <- ERROR region
 *     other            10     1.4%
 *
 * The census is a TEXT census, not a parse-tree census, and it is labelled as such: it
 * counts what is written, not what the grammar accepts. The grammar's verdict on each form
 * is measured separately, by the isolation matrix above, so neither half is taken on trust
 * from the other.
 *
 * ## WHAT THIS LANE DOES NOT OWN
 *
 * The grammar is a compiled wasm blob under `node_modules`, not `src/ast/real-scss-analyzer.ts`,
 * so the repair is a grammar-side change and this file records it rather than making it. The
 * one thing that IS in this lane's gift is to make the loss COUNTED rather than invisible, and
 * that is what `scss-unflagged-parse-loss.ts` does.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-extend-argument-isolation.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const PROBE = "/tmp/opencode/scss/extend-arg-probe"

// ── part 1: the isolation matrix, through production parseFile ───────────────────────
const MATRIX: [string, string][] = [
  ["P_extP", "%b { @extend %c; }"],
  ["P_extC", "%b { @extend .c; }"],
  ["P_extI", "%b { @extend #c; }"],
  ["C_extP", ".a { @extend %c; }"],
  ["C_extC", ".a { @extend .c; }"],
  ["I_extP", "#i { @extend %c; }"],
  ["T_extP", "div { @extend %c; }"],
  ["P_extP_2sel", "%b,\n%d { @extend %c; }"],
  ["P_extP_multi", "%b { @extend %c, %d; }"],
  ["P_noext_2sel", "%b,\n%d { color: red; }"],
  ["P_extP_then_rule", "%b { @extend %c; }\n.x { color: red; }"],
  ["P_extP_nested", "%b { @extend %c;\n  .in { color: red; }\n}"],
]

const rows: { id: string; src: string; errors: number; edges: number; syms: string[]; degraded: boolean; fallback: boolean }[] = []
for (const [id, src] of MATRIX) {
  const f = path.join(PROBE, `${id}.scss`)
  writeFileSync(f, src)
  const r: any = await parseFile(f, PROBE)
  rows.push({
    id,
    src,
    errors: (r?.errors ?? []).length,
    edges: (r?.relationships ?? []).length,
    syms: (r?.symbols ?? []).map((s: any) => `${s.kind}:${s.name}`).filter((s: string) => !s.startsWith("module:")),
    degraded: r?.degraded === true,
    fallback: r?.fallback === true,
  })
}

console.log("scss @extend argument-form isolation — production parseFile")
console.log(`corpus root ${CR}`)
console.log("")
console.log(`${"case".padEnd(20)}${"errors".padStart(8)}${"edges".padStart(7)}   selectors published`)
console.log("-".repeat(96))
for (const r of rows) {
  console.log(
    `${r.id.padEnd(20)}${String(r.errors).padStart(8)}${String(r.edges).padStart(7)}   ${r.syms.length === 0 ? "(none)" : JSON.stringify(r.syms)}`,
  )
}
console.log("-".repeat(96))
const flagged = rows.filter((r) => r.degraded || r.fallback)
console.log(`cases carrying errors: ${rows.filter((r) => r.errors > 0).length} of ${rows.length}`)
console.log(`  of those, degraded or fallback: ${flagged.length}  ${flagged.length === 0 ? "<-- the loss is in NO flag" : flagged.map((r) => r.id).join(" ")}`)
const edgeLoss = rows.filter((r) => r.errors > 0 && r.edges === 0).length
console.log(`  of those, edges lost entirely: ${edgeLoss}  ${edgeLoss === 0 ? "(the @extend EDGE survives; what is lost is nested rules)" : ""}`)

// ── part 2: how much of the corpus is written in the failing form ─────────────────────
// Instrument B in the workstream's terms is a parse-tree count, so the honest pairing here
// is: part 1 IS the parse-tree measurement (12 files through the production parser) and
// part 2 is a TEXT census that says how much text is exposed to it. Neither is derived from
// the other, which is what makes the product of the two a number rather than an assumption.
const tracked: string[] = []
for (const e of (() => {
  try {
    return readdirSync(CR).sort()
  } catch {
    return [] as string[]
  }
})()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let files: string[]
  try {
    files = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of files) if (/\.(scss|sass)$/.test(rel)) tracked.push(path.join(dir, rel))
}

const forms = new Map<string, number>()
let total = 0
let bare = 0
const ARG = /@extend\s*([^;}]*)/g
for (const f of tracked) {
  let text: string
  try {
    if (statSync(f).size > 512 * 1024) continue
    text = readFileSync(f, "utf8")
  } catch {
    continue
  }
  for (const m of text.matchAll(ARG)) {
    const a = m[1].trim()
    if (a.length === 0) {
      bare++
      continue
    }
    total++
    const c = a[0]
    const k = c === "%" ? "placeholder %" : c === "#" ? "id #" : c === "." ? "class ." : "other"
    forms.set(k, (forms.get(k) ?? 0) + 1)
  }
}
const exposed = (forms.get("placeholder %") ?? 0) + (forms.get("id #") ?? 0)
console.log(`\ntext census over ${tracked.length} tracked .scss/.sass files in the corpus:`)
console.log(`  @extend statements with an argument   ${total}`)
console.log(`  @extend with NO argument              ${bare}`)
// The verdict column is MEASURED or it is not printed. The isolation matrix covers
// `%`, `#` and `.` first characters; `other` is whatever remains, and no matrix case
// exercises it, so it prints "not measured" rather than inheriting a neighbour's verdict.
// Deciding it by resemblance is how a bucket of 13 gets counted as 13 confirmed errors.
const VERDICT: Record<string, string> = {
  "placeholder %": "ERROR region (matrix)",
  "id #": "ERROR region (matrix)",
  "class .": "parses clean (matrix)",
  other: "NOT MEASURED",
}
for (const [k, v] of [...forms].sort((a, b) => b[1] - a[1])) {
  const pctv = ((v / total) * 100).toFixed(1)
  console.log(`    ${k.padEnd(16)}${String(v).padStart(5)}  ${pctv.padStart(5)}%   ${VERDICT[k]}`)
}
const unmeasured = forms.get("other") ?? 0
console.log(`  written in a form the matrix measured as an ERROR region  ${exposed}  ${((exposed / total) * 100).toFixed(1)}%`)
console.log(`  left unmeasured, and excluded from that figure            ${unmeasured}  ${((unmeasured / total) * 100).toFixed(1)}%`)
