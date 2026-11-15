/**
 * BUILTIN CALLS — what the `calls` filter suppresses, priced on the corpus, split by KIND.
 *
 * ## WHY THIS EXISTS
 *
 * `real-php-analyzer.ts:1669` reads:
 *
 *     if (PHP_BUILTINS.has(callName)) return
 *
 * and `PHP_BUILTINS` is `PHP_INTERNAL_FUNCTIONS ∪ PHP_LANGUAGE_CONSTRUCTS` (2,481 names,
 * derived from php-src by `internal-symbol-table.mts`). That ONE line therefore suppresses two
 * populations that are not the same thing:
 *
 *   CONSTRUCT  `isset`, `empty`, `list`, `eval` — language syntax, not a declared symbol.
 *              A `calls` edge naming one would point at a symbol php can never publish. Dropping
 *              it is right.
 *   FUNCTION   `usleep`, `sprintf`, `array_map`, `json_encode` — real functions DECLARED by
 *              php-src's own stubs, with a declaration site and a signature. A call to one is a
 *              TRUE fact about the corpus, and the edge would resolve if php-src were indexed.
 *
 * Cause C's stated mechanism is "MARK them external so they stop polluting `unresolved`", and
 * `labelExternalTargets()` does exactly that for `imports` / `instantiates` / `references`. For
 * `calls` the same names are not labelled — they are DELETED before labelling can see them. So
 * this probe measures the size of the population that is deleted rather than labelled, because
 * that number decides whether the asymmetry is a rounding error or a hole.
 *
 * ## WHAT IT IS NOT
 *
 * This is a CORPUS-SIDE CONSTRUCT COUNT (instrument B), not an analyzer edge count. It walks the
 * parse tree with `phpStaticCallableName` — the analyzer's OWN exported callee-name rule — so it
 * counts exactly the call sites that reach the filter, but it does not apply the rest of
 * `processFunctionCall` (WordPress hook exclusion, first-class tear-off, `inFunction` attribution).
 * The before/after EDGE delta therefore has to come from `ambiguity-split.mts`, not from here.
 * The two are printed side by side and must agree in sign; this file supplies the split, that one
 * supplies the delta.
 *
 * ## METHOD
 *
 * Corpus: every git-tracked file under `BB_CORPUS_ROOT` (default
 * /home/ishaq2321/bb_tests/repositories) that `detectLanguageFromPath` admits as `php`, over
 * `git ls-files` so build output is excluded by construction. Deterministic stride over the sorted
 * population with `--files N` (default 600). Zero regex: node types and named children only.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import * as ASTEngine from "../../../../src/ast/engine"
import { phpStaticCallableName } from "../../../../src/ast/real-php-analyzer"
import {
  PHP_INTERNAL_FUNCTIONS,
  PHP_LANGUAGE_CONSTRUCTS,
  PHP_INTERNAL_CLASSES,
  PHP_INTERNAL_CONSTANTS,
  PHP_INTERNAL_PROVENANCE,
} from "../../../../src/ast/php-internal-symbols"
import { readFileSync as _readFileSync } from "node:fs"

const argv = process.argv.slice(2)
const fail = (m: string): never => {
  console.error(`builtin-calls-probe: ${m}`)
  process.exit(2)
}
const argOf = (f: string) => {
  const i = argv.indexOf(f)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v == null || v.startsWith("--")) fail(`\`${f}\` has no value`)
  return v
}
const N = Number(argOf("--files") ?? 600)
if (!Number.isInteger(N) || N < 1) fail(`--files must be a positive integer`)
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 512 * 1024

/**
 * THE COUNTERFACTUAL, and why the probe needs it.
 *
 * `PHP_BUILTINS` was 218 hand-written names until this round and is now the derived
 * php-src union (2,480 after the `exit` overlap). So the `-4,421 calls` delta measured between
 * `validation/m60/php/ambiguity-split.json` at 0b6a2b203 and at HEAD is the INCREMENT — the
 * sites whose callee the derived table added — and it is NOT the population the filter removes
 * today. Without this split the probe's total and the ambiguity-split delta disagree by 10,120
 * and neither number is wrong; they are populations of different sizes, and saying so is the
 * point.
 *
 * The pre-M60 list is read from a committed artifact rather than retyped, so it cannot drift
 * from what the analyzer actually filtered. Extract command, for the record:
 *   git show 0b6a2b203:src/ast/real-php-analyzer.ts   ->  the `PHP_BUILTINS` literal block
 */
const PREFIX_LIST = "validation/m60/php/php-builtins-pre-m60.json"
const prefixNames = new Set<string>(
  JSON.parse(_readFileSync(new URL(`../../../../${PREFIX_LIST}`, import.meta.url), "utf8")) as string[],
)

/** The measured `calls` edge count before the derived table, from a committed artifact. */
const PRE_DELTA = JSON.parse(
  _readFileSync(new URL("../../../../validation/m60/php/calls-edges-pre-m60.json", import.meta.url), "utf8"),
) as { instrument: string; callsEdges: number; sampleFiles: number }
const callsDelta = PRE_DELTA.callsEdges - sumTotalCallsEdges()
/**
 * The post side, read from the CURRENT ambiguity-split artifact rather than typed in, so the
 * two numbers cannot come from different runs without the file saying so.
 */
function sumTotalCallsEdges(): number {
  const cur = JSON.parse(
    _readFileSync(new URL("../../../../validation/m60/php/ambiguity-split.json", import.meta.url), "utf8"),
  ) as { perType: Record<string, { edges: number }>; sampleFiles: number }
  if (cur.sampleFiles !== PRE_DELTA.sampleFiles) {
    console.error(
      `CONTROL FAILED: the two ambiguity-split artifacts are over different populations ` +
        `(${PRE_DELTA.sampleFiles} vs ${cur.sampleFiles} files), so their difference is not a delta.`,
    )
    process.exit(3)
  }
  return cur.perType.calls?.edges ?? 0
}

const admitted: { label: string; abs: string }[] = []
for (const entry of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, entry)
  let tracked: string[] = []
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text = ""
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "php") continue
    admitted.push({ label: `${entry}/${rel}`, abs })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const stride = Math.max(1, Math.floor(admitted.length / N))
const picked: typeof admitted = []
for (let i = 0; i < admitted.length && picked.length < N; i += stride) picked.push(admitted[i])

const parser = await ASTEngine.getParser("php")

/** name -> how many call SITES named it. One site, one increment. */
const fnSites = new Map<string, number>()
const conSites = new Map<string, number>()
const ctorSites = new Map<string, number>()
let callSites = 0
let namedCallSites = 0
let parseFailures = 0
let ctorSeen = 0
/** sites the filter removed BEFORE this round — a callee in the 218-name prefix list */
let prefixSites = 0
/** sites the derived table added — a callee in php-src but NOT in the prefix list */
let derivedOnlySites = 0
/** same split by distinct name */
const prefixNamesHit = new Set<string>()
const derivedOnlyNamesHit = new Set<string>()

for (const f of picked) {
  let text = ""
  try {
    text = readFileSync(f.abs, "utf8")
  } catch {
    continue
  }
  let root: any
  try {
    root = parser.parse(text).rootNode
  } catch {
    parseFailures++
    continue
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "function_call_expression") {
      callSites++
      const name = phpStaticCallableName(n.childForFieldName("function"))
      if (name) {
        namedCallSites++
        if (PHP_INTERNAL_FUNCTIONS.has(name)) {
          fnSites.set(name, (fnSites.get(name) ?? 0) + 1)
          if (prefixNames.has(name)) {
            prefixSites++
            prefixNamesHit.add(name)
          } else {
            derivedOnlySites++
            derivedOnlyNamesHit.add(name)
          }
        } else if (PHP_LANGUAGE_CONSTRUCTS.has(name)) conSites.set(name, (conSites.get(name) ?? 0) + 1)
      }
    } else if (n.type === "object_creation_expression") {
      ctorSeen++
      // NO `class` FIELD. Measured against the pinned grammar: the constructed class is the
      // first NAMED child in an untyped position (`qualified_name` or `name`), and the rest is
      // `arguments`. Reading `childForFieldName("class")` here returns null for every site and
      // prints a confident 0 — the vacuous zero this lane's own notes warn about. CONTROL below
      // fails the run if this stops seeing anything, so the 0 can never be believed silently.
      const first = n.namedChild(0)
      const name = first ? phpStaticCallableName(first) : undefined
      if (name) ctorSites.set(name, (ctorSites.get(name) ?? 0) + 1)
    }
    for (const c of n.children) stack.push(c)
  }
}

const bump = (m: Map<string, number>) =>
  [...m.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

// A name in BOTH sets would make the two buckets a partition by luck rather than by rule.
const overlap: string[] = []
for (const n of PHP_INTERNAL_FUNCTIONS) if (PHP_LANGUAGE_CONSTRUCTS.has(n)) overlap.push(n)

console.log(`corpus root          ${CORPUS}`)
console.log(`php-src commit       ${PHP_INTERNAL_PROVENANCE.commit}`)
console.log(`admitted php files   ${String(admitted.length).padStart(8)}  (git-tracked, detectLanguageFromPath === "php")`)
console.log(`sample               ${String(picked.length).padStart(8)}  (deterministic stride ${stride} over the sorted population)`)
console.log(`files that failed to parse ${String(parseFailures).padStart(4)}`)
console.log("")
console.log(`call_sites (function_call_expression)   ${callSites}`)
console.log(`  named by phpStaticCallableName        ${namedCallSites}`)
console.log(`  NOT named (variable/member callee)    ${callSites - namedCallSites}`)
console.log("")
console.log(`--- the filter at real-php-analyzer.ts:1669 ---`)
console.log(`PHP_BUILTINS = FUNCTIONS ∪ CONSTRUCTS`)
console.log(`FUNCTIONS   ${String(PHP_INTERNAL_FUNCTIONS.size).padStart(6)} names`)
console.log(`CONSTRUCTS  ${String(PHP_LANGUAGE_CONSTRUCTS.size).padStart(6)} names`)
console.log(`union       ${String(PHP_INTERNAL_FUNCTIONS.size + PHP_LANGUAGE_CONSTRUCTS.size - overlap.length).padStart(6)} names`)
console.log(`  name in BOTH sets (would break the partition) ${overlap.length}${overlap.length ? `: ${overlap.join(", ")}` : ""}`)
console.log("")
console.log(`--- call sites the filter DELETES, by half ---`)
console.log(`FUNCTIONS  (real php-src symbols)  sites=${String(sum(fnSites)).padStart(7)}  distinct names=${fnSites.size}`)
console.log(`CONSTRUCTS (language syntax)       sites=${String(sum(conSites)).padStart(7)}  distinct names=${conSites.size}`)
console.log(`  sum of the two halves            ${String(sum(fnSites) + sum(conSites)).padStart(7)}`)
console.log(`  named call sites (denominator)   ${String(namedCallSites).padStart(7)}`)
console.log(`  UNACCOUNTED named call sites     ${String(namedCallSites - sum(fnSites) - sum(conSites)).padStart(7)}  (calls that DO reach the filter)`)
console.log("")
console.log("--- COUNTERFACTUAL: which half of the deleted population is NEW this round? ---")
console.log(`  prefix list (pre-M60 PHP_BUILTINS)   ${prefixNames.size} names`)
console.log(`  sites the PREFIX filter already took  ${String(prefixSites).padStart(7)}  across ${prefixNamesHit.size} distinct names`)
console.log(`  sites the DERIVED table added         ${String(derivedOnlySites).padStart(7)}  across ${derivedOnlyNamesHit.size} distinct names`)
console.log(`  sum                                   ${String(prefixSites + derivedOnlySites).padStart(7)}  (must equal FUNCTIONS sites above)`)
if (prefixSites + derivedOnlySites !== sum(fnSites)) {
  console.error("CONTROL FAILED: the prefix/derived split does not partition the FUNCTIONS half.")
  process.exit(3)
}
console.log("")
console.log("--- RECONCILIATION against the measured edge delta ---")
console.log("  The ambiguity-split `calls` row moved 107,611 -> 103,190 between 0b6a2b203 and HEAD,")
console.log("  so -4,421 edges is the INCREMENT the derived table caused. It must equal the sites")
console.log("  whose callee the derived table ADDED, on both halves:")
let constructNewSites = 0
let constructOldSites = 0
for (const [name, c] of conSites) {
  if (prefixNames.has(name)) constructOldSites += c
  else constructNewSites += c
}
const newSites = derivedOnlySites + constructNewSites
const residual = callsDelta - newSites
console.log(`  derived-only FUNCTION sites                 ${String(derivedOnlySites).padStart(7)}`)
console.log(`  CONSTRUCT sites absent from the prefix list  ${String(constructNewSites).padStart(7)}   (isset, empty)`)
console.log(`  = sites the derived table newly filters      ${String(newSites).padStart(7)}`)
console.log(`  measured \`calls\` edge delta                 ${String(callsDelta).padStart(7)}   (from ${PRE_DELTA.instrument})`)
console.log(`  RESIDUAL (delta - predicted)                 ${String(residual).padStart(7)}   ${((Math.abs(residual) / callsDelta) * 100).toFixed(2)}% of the delta`)
console.log("")
console.log("  The residual is stated, not explained away. Its sign and size are what a consumer")
console.log("  needs: the probe counts CALL SITES reaching the filter and the analyzer pushes one")
console.log("  relationship per surviving site with no dedup key of its own, so the two populations")
console.log("  are the same set up to what the pipeline after the analyzer does. This lane does NOT")
console.log("  measure that collapse separately, so the reconciliation is reported as agreement to")
console.log("  within the residual, not as exact.")
console.log("")
console.log(`CONTROL — a vacuous 0 here would be a probe bug, not a finding:`)
console.log(`  object_creation_expression seen   ${ctorSeen}`)
console.log(`  naming an internal CLASS           ${sum(ctorSites)} across ${ctorSites.size} distinct names`)
if (ctorSeen === 0) {
  console.error("CONTROL FAILED: zero object_creation_expression nodes. The ctor half cannot be believed.")
  process.exit(3)
}
console.log("")
console.log(`top FUNCTIONS call sites — TRUE facts currently absent from the graph:`)
for (const [name, c] of bump(fnSites).slice(0, 25)) console.log(`  ${String(c).padStart(6)}  ${name}`)
console.log("")
console.log(`top CONSTRUCTS call sites — correctly dropped (no such symbol exists):`)
for (const [name, c] of bump(conSites).slice(0, 12)) console.log(`  ${String(c).padStart(6)}  ${name}`)
console.log("")
console.log(`--- object_creation_expression, for contrast (these ARE emitted, then labelled external) ---`)
for (const [name, c] of bump(ctorSites).slice(0, 12)) {
  console.log(`  ${String(c).padStart(6)}  ${name}  ${PHP_INTERNAL_CLASSES.has(name) ? "internal-class" : PHP_INTERNAL_CONSTANTS.has(name) ? "internal-const" : "NOT-INTERNAL"}`)
}