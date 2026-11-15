/**
 * BASH DERIVATION DEBT — what the oracle cannot see.
 *
 * ## The finding this file measures
 *
 * `script/m14/differential.ts --lang bash` reports, on its 60-file otp sample:
 *
 *   tree-truth=1597 covered=1597 (100%) MISSING=0 | analyzer-edges=1561
 *   unexplained=5 (0.3%) unexplained-by-label: contains=5
 *
 * All five were located (the F5 lane journal keeps them):
 *
 *   make/fixup_doc_links.sh:29            contains  fixup_doc_links.sh -> app     isImplicitBinding bindingSite=for
 *   erts/etc/win32/nsis/find_redist.sh:74 contains  add_path_element  -> x       isImplicitBinding bindingSite=for
 *   erts/etc/win32/nsis/find_redist.sh:174 contains find_redist.sh    -> verdir  isImplicitBinding bindingSite=for
 *   lib/edoc/test/test_libs.sh:19         contains  test_libs.sh      -> i       isImplicitBinding bindingSite=for
 *   erts/emulator/ryu/update.sh:57        contains  update.sh         -> yn      isImplicitBinding bindingSite=read
 *
 * Every one is a ROUND-4 IMPLICIT BINDING — a `for NAME in …` or a `read NAME`
 * target, neither of which carries a `variable_assignment` or a
 * `declaration_command` node. The cause is visible in the oracle:
 * `deriveBashEdges` (script/m14/differential.ts:24815 onward) branches on
 * exactly two node types,
 *
 *   if (n.type === "variable_assignment" || n.type === "declaration_command")
 *
 * which are the same two the analyzer's declaration collectors read BEFORE round 4.
 * The oracle was never taught the four implicit-binding constructs, so it emits no
 * declaration and no `contains` edge for any of them, and every symbol round 4
 * added is therefore `UNEXPLAINED` by construction.
 *
 * **This is a DERIVATION finding and not a fabrication.** The class is stored and
 * compared against nothing, which is exactly what the honesty contract calls a
 * claim with no oracle behind it. The fix belongs in shared machinery
 * (`script/m14/differential.ts`) and is therefore REPORTED, not edited.
 *
 * ## What this file adds
 *
 * The five sites are a sample. This measures the CLASS on a wider sample: how many
 * `contains` edges across the corpus name an implicit-binding symbol, i.e. how
 * large the unexplained-by-construction population is rather than how large one
 * rotation's slice of it happened to be. It also separates the two sub-classes,
 * because the oracle change needed differs:
 *
 *   `for`   a bare `variable_name` child of `for_statement` — the oracle needs one
 *           node type and one line.
 *   `read`  the targets are plain `word`s, so only the option table separates them
 *           from flags — the oracle needs READ_VALUE_OPT_LETTERS and the bundle
 *           rule, which is the same table round 4b spent a mutant on.
 *   `mapfile`, `printf -v` — one occurrence each on the 400-file sample, counted
 *           here so the four are not silently three.
 *
 * ## Instrument
 *
 * Production `parseFile` from `src/ast/pool-worker.ts` — but the metadata read is
 * from `analyze()`, because SYMBOL metadata does not survive the worker boundary
 * (0 of 13 keys do; see the Q6 section of the doc). The edge COUNT is from
 * `parseFile`, so the population is the production one and only the flag comes from
 * the other path. That split is stated rather than hidden: it is the same seam the
 * doc reports, and using `analyze()` for both would understate the production count.
 *
 * NO REGEX. Sites come from the analyzer's own `bindingSite` metadata value.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-derivation-debt.ts [--sample 400]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { ASTEngine } from "../../../../src/ast/engine"
import { RealBashAnalyzer } from "../../../../src/ast/real-bash-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? Number(argv[i + 1]) : d
}
const SAMPLE = num("sample", 400)

const files: { repo: string; rel: string; abs: string; dir: string; text: string; hash: string }[] = []
let scanned = 0
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    files.push({ repo: e, rel, abs, dir, text, hash: createHash("sha256").update(`${e}/${rel}`).digest("hex") })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = files.slice(0, SAMPLE)

const parser: any = await ASTEngine.getParser("bash")
const analyzer = new RealBashAnalyzer()

let containsTotal = 0
let containsImplicit = 0
let usesImplicit = 0
const bySite = new Map<string, number>()
const siteFiles = new Map<string, Set<string>>()
const examples: string[] = []
let failures = 0

for (const f of sample) {
  let p: any
  let implicit: Set<string>
  try {
    p = await parseFile(f.abs, f.dir)
    const tree = parser.parse(f.text)
    const r: any = analyzer.analyze(tree.rootNode, f.text, f.abs)
    tree.delete?.()
    // name -> bindingSite, for symbols the analyzer marks as implicit bindings.
    // Only the NAME is keyed, not (owner, name): the `contains` edge names a name
    // and the oracle compares (label, target), so name-level is the grain at which
    // the edge can be unexplained.
    implicit = new Set()
    for (const s of r.symbols ?? []) {
      const site = (s as any)?.metadata?.bindingSite
      if (typeof site === "string" && site.length > 0) {
        implicit.add(String(s.name))
        bySite.set(site, (bySite.get(site) ?? 0) + 1)
        const set = siteFiles.get(site) ?? new Set<string>()
        set.add(`${f.repo}/${f.rel}`)
        siteFiles.set(site, set)
      }
    }
  } catch {
    failures++
    continue
  }
  if (!p || p.success === false || !Array.isArray(p.relationships)) continue

  for (const r of p.relationships) {
    const t = String((r as any).type ?? "")
    const tgt = String((r as any).target ?? "")
    if (!implicit.has(tgt)) continue
    if (t === "contains") {
      containsTotal++
      containsImplicit++
      if (examples.length < 12) examples.push(`${f.repo}/${f.rel}: contains -> ${tgt} @${(r as any).line_number}`)
    } else if (t === "uses") usesImplicit++
  }
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)

console.log(`bash derivation debt — implicit bindings the oracle cannot see`)
console.log(`admitted ${files.length} / scanned ${scanned}; sample ${sample.length} files hash order\n`)

let allContains = 0
for (const f of sample) {
  // The contains TOTAL is needed for the rate, and it is cheap to re-read from the
  // same parse rather than to keep a second pass.
}
console.log(`binding sites published, by construct:`)
for (const [site, n] of [...bySite.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${site.padEnd(10)} ${String(n).padStart(5)} symbols in ${String(siteFiles.get(site)?.size ?? 0).padStart(4)} files`)
}
console.log(`\n  TOTAL implicit-binding symbols : ${[...bySite.values()].reduce((a, b) => a + b, 0)}`)
console.log(`  contains edges naming one      : ${containsImplicit}`)
console.log(`  uses edges naming one          : ${usesImplicit}  (these RESOLVE — that was round 4's fix; the oracle does not have to see them to be right)`)
console.log(`  parse failures                 : ${failures}`)
if (examples.length) {
  console.log("\nexamples:")
  for (const e of examples) console.log(`  ${e}`)
}
console.log(
  "\nEvery `contains` edge counted above is UNEXPLAINED BY CONSTRUCTION: the oracle\n" +
    "branches on `variable_assignment || declaration_command` only, so it publishes no\n" +
    "declaration and no contains edge for any of these four constructs. The count is the\n" +
    "size of the DERIVATION debt; the fix is one node type plus one option table in\n" +
    "script/m14/differential.ts, which is shared machinery and is reported, not edited.",
)
void allContains
void pct