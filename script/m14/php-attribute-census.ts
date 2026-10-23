/**
 * PHP — THE ATTRIBUTE CENSUS, CORRECTED TO THE PRE-REGISTERED PREDICATE, AND THE DIRECT/`NESTED`
 * SPLIT THAT THE RULING ON `decorates` ACTUALLY TURNS ON.
 *
 * ## Why this exists (read the finding before trusting the number)
 *
 * The `decorates` ruling was pre-registered with a decisive counter: **an `attribute` whose
 * ARGUMENT is a call-shaped expression**. The whole-population census
 * (`php-population.ts --emit`) implemented that counter by walking the WHOLE `arguments` subtree of
 * each attribute, so a call-shaped node ANYWHERE beneath the attribute counted — including a `new`
 * inside a closure BODY that is itself the argument. MEASURED over the population: that loose
 * predicate fired exactly ONCE, on
 * `phpunit/tests/end-to-end/_files/data-provider/ClosureThrowsExceptionTest.php`:
 *
 *     #[DataProviderClosure(static function (): array { throw new RuntimeException('closure failed'); })]
 *
 * The firing node is the `new RuntimeException(...)` INSIDE the closure's body. The ARGUMENT is a
 * closure expression, not a call — the predicate over-reached, and a census whose predicate is
 * broader than the claim it tests is testing its own predicate. This instrument measures the claim
 * as stated, at three depths, and reports all three:
 *
 *   · `directCallShaped` — the argument EXPRESSION ITSELF is call-shaped
 *     (`function_call_expression` / `member_call_expression` / `scoped_call_expression` /
 *     `nullsafe_member_call_expression` / `object_creation_expression`). THIS is the pre-registered
 *     predicate; non-zero falsifies the ontological ruling and `decorates` is implemented.
 *   · `callableArgument` — the argument is a CLOSURE (anonymous/arrow function): a callable VALUE
 *     passed as metadata, not an application to the declaration. Counted and named because it is
 *     the nearest miss and the previous instrument's one firing lives here.
 *   · `nestedCallOnly` — the argument is neither, but a call shape appears somewhere in its subtree
 *     (the over-reach class the loose predicate actually measured).
 *
 * ## The population, and why this one needs no whole-population arm
 *
 * The candidate set is FILES WHOSE TEXT CONTAINS `#[` — a SUPERSET of the files that can carry a
 * PHP attribute (`#[` is required, contiguous, and a comment/string containing it only adds a file
 * that parses to zero attributes). The instrument PARSES every candidate and then CHECKS ITS OWN
 * SCREEN against the independently measured whole-population total: the full census counted
 * **6,507 attributes over 1,799 files**, and this run must reproduce that number EXACTLY or it
 * REFUSES — "a candidate set that misses a file reports a clean zero over a population it never
 * read" (the fleet's heritage-probe form). That is also why it is a SMALL-SLOT instrument: the
 * candidate population is the attribute-bearing subset, not the 6,424-file population.
 *
 * USAGE (small slot; see script/m14/arm-token.sh take-small)
 *   BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/php-attribute-census.ts \
 *     [--json validation/m14/measurements/php-attribute-census.json]
 *
 * EXIT: 0 measured · 2 usage/environment · 4 the screen's attribute total disagrees with the full
 *       census (the candidate set missed a file, so the counts are about a different population).
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { extensionsFor } from "./language-extensions"

const HERE = (import.meta as any).dir ?? dirname(new URL(import.meta.url).pathname)
const REPO = resolve(HERE, "..", "..")
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : ""
const ROOT = process.env.BB_CORPUS_ROOT ?? join(process.cwd(), ".corpus")
const EXTS = extensionsFor("php")
const CAP = 1_048_576
/** The whole-population census's own attribute total — the control this instrument must reproduce. */
const CENSUS_PATH = resolve(REPO, "validation/m14/measurements/php-emission-census.json")

if (!existsSync(ROOT)) { console.error(`php-attribute-census: no corpus root at ${ROOT}`); process.exit(2) }
if (!existsSync(CENSUS_PATH)) { console.error(`php-attribute-census: no full census at ${CENSUS_PATH}; the control cannot run and the screen would be uncontrolled`); process.exit(2) }
const fullCensus = JSON.parse(readFileSync(CENSUS_PATH, "utf8"))
const expectedAttributes = Number(fullCensus?.emission?.decorates?.attributes ?? -1)
const expectedGroups = Number(fullCensus?.emission?.decorates?.attributeGroups ?? -1)
if (expectedAttributes < 0) { console.error("php-attribute-census: the full census carries no attribute total — refusing to run uncontrolled"); process.exit(2) }

// ── the admitted set (the same tracked rule as php-population.ts) ────────────
const extOf = (p: string): boolean => EXTS.some((e) => p.toLowerCase().endsWith(e))
const gitTracked = (dir: string): string[] => {
  try { return execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { return [] }
}
const isRepo = (dir: string): boolean => { try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }); return true } catch { return false } }
const admitted: string[] = []
for (const name of ((): string[] => { try { return readdirSync(ROOT).sort() } catch { return [] } })()) {
  const dir = join(ROOT, name)
  let isDir = false
  try { isDir = statSync(dir).isDirectory() } catch { isDir = false }
  if (!isDir || !isRepo(dir)) continue
  for (const rel of gitTracked(dir)) {
    if (!extOf(rel)) continue
    const abs = join(dir, rel)
    let size = -1
    try { size = statSync(abs).size } catch { continue }
    if (size < 0 || size > CAP) continue
    admitted.push(abs)
  }
}

// ── the SCREEN: files whose text contains `#[` (superset; comments/strings only add files) ──
const candidates: string[] = []
for (const f of admitted) {
  let t = ""
  try { t = readFileSync(f, "utf8") } catch { continue }
  if (t.includes("#[")) candidates.push(f)
}

const { getParser } = await import("../../src/ast/engine.ts")
const parser = await getParser("php")
const CALL_SHAPED = new Set([
  "function_call_expression", "member_call_expression", "scoped_call_expression",
  "nullsafe_member_call_expression", "object_creation_expression",
])
const CALLABLE_EXPR = new Set(["anonymous_function", "arrow_function"])
const DECL_KINDS = new Set([
  "class_declaration", "interface_declaration", "trait_declaration", "enum_declaration",
  "method_declaration", "function_definition", "property_declaration", "const_declaration",
  "enum_case", "simple_parameter", "variadic_parameter", "property_promotion_parameter",
])

let attributeGroups = 0
let attributes = 0
const attributeFiles = new Set<string>()
const kinds: Record<string, number> = {}
const directCallShaped: Array<{ file: string; text: string }> = []
const callableArgument: Array<{ file: string; text: string }> = []
const nestedCallOnly: Array<{ file: string; text: string }> = []
const failures: string[] = []
let parsed = 0

/** Does this expression's SUBTREE contain a call-shaped node? */
function subtreeHasCall(n: any): boolean {
  const st = [n]
  while (st.length) {
    const m = st.pop()!
    if (CALL_SHAPED.has(String(m.type))) return true
    for (let i = 0; i < m.childCount; i++) { const c = m.child(i); if (c) st.push(c) }
  }
  return false
}

for (const f of candidates) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { failures.push(f); continue }
  let tree: any
  try { tree = await parser.parse(content) } catch { failures.push(f); continue }
  if (!tree) { failures.push(f); continue }
  parsed++
  const stack: Array<{ node: any; parent: any }> = [{ node: tree.rootNode, parent: null }]
  while (stack.length) {
    const { node: n, parent } = stack.pop()!
    const t = String(n.type)
    if (t === "attribute_group") attributeGroups++
    if (t === "attribute") {
      attributes++
      attributeFiles.add(f)
      let cur = parent
      let hops = 0
      while (cur && hops < 4) {
        if (DECL_KINDS.has(String(cur.type))) { kinds[String(cur.type)] = (kinds[String(cur.type)] ?? 0) + 1; break }
        cur = cur.parent ?? null
        hops++
      }
      // the DIRECT argument expressions: argument nodes under the attribute's `arguments`
      let args: any = null
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && String(c.type) === "arguments") { args = c; break } }
      if (args) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const arg = args.namedChild(i)
          if (!arg || String(arg.type) !== "argument") continue
          const expr = arg.namedChildren.find((c: any) => c && c.type !== "comment") ?? null
          if (!expr) continue
          const et = String(expr.type)
          const text = String(expr.text ?? "").replace(/\s+/g, " ").slice(0, 120)
          if (CALL_SHAPED.has(et)) directCallShaped.push({ file: f, text: `${et}: ${text}` })
          else if (CALLABLE_EXPR.has(et)) callableArgument.push({ file: f, text: `${et}: ${text}` })
          else if (subtreeHasCall(expr)) nestedCallOnly.push({ file: f, text: `${et} containing a call: ${text}` })
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push({ node: c, parent: n }) }
  }
}

// ── THE CONTROL: the screen's totals must reproduce the whole-population census's ──
const problems: string[] = []
if (attributes !== expectedAttributes) problems.push(`the screen counted ${attributes} attributes but the whole-population census measured ${expectedAttributes} — THE CANDIDATE SET MISSED A FILE, so every count here is about a different population`)
if (expectedGroups >= 0 && attributeGroups !== expectedGroups) problems.push(`the screen counted ${attributeGroups} attribute groups but the whole-population census measured ${expectedGroups}`)
if (failures.length > 0) problems.push(`${failures.length} candidate file(s) failed to parse — a partial parse is a partial number`)

const rel = (p: string): string => { try { return p.replace(resolve(ROOT) + "/", "") } catch { return p } }
const out = {
  language: "php",
  generated: new Date().toISOString(),
  rule:
    "CANDIDATE SET = files of the admitted php population whose TEXT contains `#[` (a SUPERSET of the files that can carry a PHP attribute: `#[` is required and contiguous, and a comment/string containing it only adds a file that parses to zero attributes). " +
    "Every candidate is PARSED; the decisive counter classifies each DIRECT argument expression of each `attribute` node by its own node type.",
  corpusRoot: resolve(ROOT),
  population: { admitted: admitted.length, candidates: candidates.length, parsed, failures: failures.length },
  control: {
    expectedAttributesFromFullCensus: expectedAttributes,
    expectedGroupsFromFullCensus: expectedGroups,
    measuredAttributes: attributes,
    measuredGroups: attributeGroups,
    exact: problems.length === 0,
    problems,
  },
  decoratesCounter: {
    preRegisteredPredicate: "an `attribute` whose ARGUMENT is a call-shaped expression",
    directCallShaped: { rows: directCallShaped.length, files: new Set(directCallShaped.map((x) => x.file)).size, samples: directCallShaped.slice(0, 20).map((x) => `${rel(x.file)}: ${x.text}`) },
    callableArgument: { rows: callableArgument.length, files: new Set(callableArgument.map((x) => x.file)).size, samples: callableArgument.slice(0, 20).map((x) => `${rel(x.file)}: ${x.text}`) },
    nestedCallOnly: { rows: nestedCallOnly.length, files: new Set(nestedCallOnly.map((x) => x.file)).size, samples: nestedCallOnly.slice(0, 20).map((x) => `${rel(x.file)}: ${x.text}`) },
    meaning:
      "`directCallShaped` IS the pre-registered counter: non-zero falsifies the passive-metadata ruling and `decorates` is implemented. " +
      "`callableArgument` (a closure passed as a metadata VALUE) and `nestedCallOnly` (a call shape somewhere beneath the argument) are reported because the FIRST implementation of the counter walked the whole `arguments` subtree and therefore measured `nestedCallOnly` while claiming to measure the predicate.",
  },
  attributeSites: { groups: attributeGroups, attributes, files: attributeFiles.size, annotatedDeclKinds: kinds },
  screens: { candidateFiles: candidates.length, admittedFiles: admitted.length, note: "a candidate set that misses a file reports a clean zero over a population it never read — the control above is what prevents that" },
}

const sayN = (n: number) => n.toLocaleString()
console.log(`PHP ATTRIBUTE CENSUS — root ${resolve(ROOT)}`)
console.log(`population: ${sayN(admitted.length)} admitted · ${sayN(candidates.length)} candidate files contain \`#[\` · ${sayN(parsed)} parsed · ${sayN(failures.length)} failed`)
console.log(`control vs the whole-population census: attributes ${sayN(attributes)} / expected ${sayN(expectedAttributes)} · groups ${sayN(attributeGroups)} / expected ${sayN(expectedGroups)} — ${problems.length === 0 ? "EXACT (the screen missed nothing)" : "*** DISAGREES ***"}`)
for (const p of problems) console.log(`  problem: ${p}`)
console.log("")
console.log(`PRE-REGISTERED COUNTER — attribute whose ARGUMENT is call-shaped: ${sayN(directCallShaped.length)} site(s) over ${sayN(new Set(directCallShaped.map((x) => x.file)).size)} file(s)`)
for (const s of out.decoratesCounter.directCallShaped.samples.slice(0, 6)) console.log(`  DIRECT ${s}`)
console.log(`NEAREST MISS — the argument is a CLOSURE (a callable value, not an application): ${sayN(callableArgument.length)} site(s) over ${sayN(new Set(callableArgument.map((x) => x.file)).size)} file(s)`)
for (const s of out.decoratesCounter.callableArgument.samples.slice(0, 6)) console.log(`  CALLABLE ${s}`)
console.log(`OVER-REACH CLASS — a call shape somewhere beneath the argument, argument itself not call-shaped: ${sayN(nestedCallOnly.length)} site(s)`)
for (const s of out.decoratesCounter.nestedCallOnly.samples.slice(0, 6)) console.log(`  NESTED ${s}`)
console.log("")
console.log(`attribute sites: ${sayN(attributeGroups)} groups · ${sayN(attributes)} attributes over ${sayN(attributeFiles.size)} files · annotated kinds ${JSON.stringify(kinds)}`)

if (JSON_OUT) {
  writeFileSync(resolve(REPO, JSON_OUT), JSON.stringify(out, null, 2) + "\n")
  console.log(`\nartifact written: ${JSON_OUT}`)
}
if (problems.length > 0) process.exit(4)
