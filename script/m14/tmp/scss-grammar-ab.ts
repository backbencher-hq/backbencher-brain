/**
 * M14 grammar A/B for the SCSS lane.
 *
 *   bun script/m14/tmp/scss-grammar-ab.ts --before <wasm> --after <wasm> [--out <json>]
 *
 * WHY A SEPARATE INSTRUMENT AND NOT css-grammar-ab.ts
 *
 * The CSS instrument walks 13 repositories for `.css`. This one walks 4 for `.scss`,
 * because that is where the dialect actually is: measured over all 13 corpora there
 * are 254 `.scss` files and **0** `.sass` and **0** `.less`, so a 13-repo walk would
 * report the same numbers more slowly. It also reports PER-REPO clean counts, which
 * turned out to matter: the aggregate said 17.6% and the per-repo view said
 * element-plus was 16/160 while phpmyadmin was 50/74, and an aggregate that averages a
 * hard corpus with an easy one is how a lane looks healthier than it is.
 *
 * WHAT IT CLAIMS
 *
 * Three questions, in the order they were asked:
 *
 *   1. Did anything that parsed cleanly before now fail? (`REGRESSED`) This is the
 *      only question that can invalidate a patch on its own. A grammar patch that
 *      fixes 70 files and breaks 1 is not a net win, it is a trade, and a trade needs
 *      to be named rather than netted.
 *   2. How many files went from failing to clean, per corpus.
 *   3. Is the LOCAL build the same parser as the package's SHIPPED one? For the base
 *      measurement that is a provenance question, not a quality one: it is how
 *      `tree-sitter-css@0.20.0` was identified as the dependency the base was built
 *      against, rather than assumed. A local generate that matched the shipped
 *      parser.c byte-for-byte in BEHAVIOUR (73/244 clean, 5,624 ERROR nodes, both)
 *      is the evidence that the dep version is the right one — a wrong version would
 *      have produced a different parser and different numbers.
 *
 * ERRORS ARE COUNTED AS NODES, NOT FILES, ON PURPOSE
 *
 * A file can be "clean" by error count alone and still be badly damaged, and the
 * reverse is what actually happened: patch 1/1 took element-plus from 16 to 86 clean
 * while ERROR nodes across the corpus fell 5,624 -> far lower. A gate that only
 * counted error FILES would have seen 17.6% -> 58.6% and learned nothing about how
 * much better the surviving parses are. Both are reported.
 */

import { Parser as TSParser, Language } from "web-tree-sitter"
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs"
import { join } from "path"

const ROOT = "<corpus-root>/bb_tests/repositories"
const CORPORA = ["element-plus", "phpmyadmin", "vue-core", "vue-element-admin"]
const SKIP = new Set(["node_modules", ".git", "target", "vendor", "dist", "build"])

const argv = process.argv.slice(2)
const arg = (k: string) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : undefined)
const BEFORE = arg("--before")!
const AFTER = arg("--after")!
const OUT = arg("--out")

/**
 * The minimal reproductions, one per patch, so `--after` can be shown to fix the
 * construct and not merely to change some aggregate. A patch measured only by corpus
 * counts is a patch nobody can check by hand.
 */
const CLASS_REPRO: { id: string; patch: string; src: string }[] = [
  { id: "use-namespace", patch: "1/2", src: "@use 'sass:map' as map;\n" },
  { id: "use-star", patch: "1/2", src: "@use './vars' as *;\n" },
  { id: "use-plain", patch: "unpatched-forms-this-must-not-regress", src: "@use 'sass:map';\n" },
  { id: "use-with-config", patch: "1/2", src: "@use 'x' as y with ($a: 1);\n" },
  { id: "forward-as-namespace", patch: "1/2", src: "@forward './list' as list-gap;\n" },
  { id: "forward-as-dashed-prefix", patch: "1/2-DECLARED-NOT-SUPPORTED", src: "@forward './list' as list-gap-*;\n" },
  { id: "forward-show", patch: "1/2", src: "@forward './list' show $horizontal-list-gap;\n" },
  { id: "variable-default-flag", patch: "2/2", src: "$brand: #f00 !default;\n" },
  { id: "variable-global-flag", patch: "2/2", src: "$x: 1 !global;\n" },
  { id: "parameter-default-flag", patch: "2/2", src: "@mixin button($bg: $grey !default) { color: $bg; }\n" },
  { id: "important-still-parses", patch: "regression-control", src: ".a { color: red !important; }\n" },
  { id: "mixin-include-still-parses", patch: "regression-control", src: "@mixin m($a: 1) { color: red; }\n.b { @include m(2); }\n" },
  { id: "interpolation-still-parses", patch: "regression-control", src: "$p: a;\n.x-#{$p} { color: red; }\n" },
]

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out, depth + 1)
    else if (e.endsWith(".scss") && st.size > 0) out.push(p)
  }
}

/** ERROR and MISSING node count for one parse. */
function damage(parser: TSParser, src: string): number {
  const tree = parser.parse(src)
  let n = 0
  ;(function w(node: any) {
    if (node.type === "ERROR" || node.isMissing) n++
    for (const c of node.children ?? []) w(c)
  })(tree.rootNode)
  return n
}

await TSParser.init()
const before = new TSParser()
before.setLanguage(await Language.load(BEFORE))
const after = new TSParser()
after.setLanguage(await Language.load(AFTER))

const files: string[] = []
for (const r of CORPORA) walk(join(ROOT, r), files)
files.sort()

let cleanBefore = 0
let cleanAfter = 0
let fixed = 0
let regressed = 0
let stillFailing = 0
let errNodesBefore = 0
let errNodesAfter = 0
const fixedSample: string[] = []
const regressedSample: string[] = []
const perRepo: Record<string, { files: number; cleanBefore: number; cleanAfter: number; fixed: number; regressed: number; stillFailing: number }> = {}

for (const f of files) {
  const src = readFileSync(f, "utf8")
  const b = damage(before, src)
  const a = damage(after, src)
  const rel = f.replace(ROOT + "/", "")
  const repo = rel.split("/")[0]
  const row = (perRepo[repo] ??= { files: 0, cleanBefore: 0, cleanAfter: 0, fixed: 0, regressed: 0, stillFailing: 0 })
  row.files++
  errNodesBefore += b
  errNodesAfter += a
  if (b === 0) {
    cleanBefore++
    row.cleanBefore++
  }
  if (a === 0) {
    cleanAfter++
    row.cleanAfter++
  } else {
    // the GLOBAL counter, which the per-repo row was incrementing and this was not:
    // the summary line read `still failing 0` while 96 files were still failing,
    // because 148 clean + 0 still-failing happened to be the only two numbers
    // printed. A counter that is only ever written in one place and read in another
    // is a counter nobody has run.
    stillFailing++
    row.stillFailing++
  }
  if (b > 0 && a === 0) {
    fixed++
    row.fixed++
    if (fixedSample.length < 8) fixedSample.push(rel)
  } else if (b === 0 && a > 0) {
    regressed++
    row.regressed++
    if (regressedSample.length < 8) regressedSample.push(rel)
  }
}

const classRepro = CLASS_REPRO.map((c) => {
  const b = damage(before, c.src) > 0
  const a = damage(after, c.src) > 0
  return {
    id: c.id,
    patch: c.patch,
    src: c.src.trim(),
    before: b,
    after: a,
    verdict: b === a ? (b ? "unchanged-broken" : "unchanged-clean") : b ? "FIXED" : "REGRESSED",
  }
})

const report = {
  instrument: "script/m14/tmp/scss-grammar-ab.ts",
  purpose:
    "M14 grammar A/B for the SCSS lane: does a candidate wasm fix .scss files without breaking any that parsed cleanly, and is the local build the same parser as the package's shipped one?",
  base: "tree-sitter-scss@1.0.0, which is `grammar(require('tree-sitter-css/grammar'), {...})` over tree-sitter-css@0.20.0",
  candidateWasm: AFTER,
  q1_netWin: {
    files: files.length,
    cleanBefore,
    cleanAfter,
    pctBefore: Number(((100 * cleanBefore) / files.length).toFixed(1)),
    pctAfter: Number(((100 * cleanAfter) / files.length).toFixed(1)),
    filesFixed: fixed,
    filesRegressed: regressed,
    stillFailing,
    errNodesBefore,
    errNodesAfter,
    fixedSample,
    regressedSample,
  },
  q2_perRepo: perRepo,
  q3_classReproduction: classRepro,
  classReproFailures: classRepro.filter((c) => c.verdict === "REGRESSED"),
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`wrote ${OUT}`)
}
console.log(`files ${files.length}   clean ${cleanBefore} -> ${cleanAfter} (${report.q1_netWin.pctBefore}% -> ${report.q1_netWin.pctAfter}%)`)
console.log(`FIXED ${fixed}   REGRESSED ${regressed}   still failing ${stillFailing}`)
console.log(`ERROR nodes ${errNodesBefore} -> ${errNodesAfter}`)
if (regressedSample.length) console.log(`REGRESSED: ${regressedSample.join(", ")}`)
const brokenRepro = classRepro.filter((c) => c.after)
if (brokenRepro.length) console.log(`class repros STILL BROKEN: ${brokenRepro.map((c) => c.id).join(", ")}`)
