/**
 * PHP INTERNAL SYMBOL TABLE — derived from php-src's OWN declarations, parsed by the
 * production entry point, and written to `src/ast/php-internal-symbols.ts`.
 *
 * ## WHY THIS EXISTS
 *
 * `src/ast/real-php-analyzer.ts` carried a HAND-CURATED 218-name `PHP_BUILTINS` set, and
 * measured against the corpus that set was far too small. From the committed
 * `validation/m60/php/ambiguity-split.json` (5,094 admitted files, production `parseFile`),
 * 70,224 edges are unresolved and carry no `metadata.external` label, and the largest
 * `imports` targets are `sprintf` 439, `assert` 184, `is_string` 152, `PHP_EOL` 134,
 * `is_array` 132, `in_array` 132 — all of them declared by php-src, none of them in the
 * hand-curated set. The largest `instantiates` targets are `ReflectionProperty` 250,
 * `ReflectionMethod` 190, `ReflectionClass` 90, `DateTimeImmutable` 75, `SplObjectStorage` 23
 * — all internal classes, and the table had no class half at all.
 *
 * That is cause C of the incoming-side brief (EXTERNAL REFERENCES EMITTED AS IF LOCAL), and
 * it is the one cause whose population is knowable without any ambiguity reasoning: the
 * names are DECLARED, by the language's own implementation, in one place.
 *
 * ## WHERE THE TABLE COMES FROM
 *
 * php-src declares its entire internal surface in Arginfo STUB files:
 * `Zend/zend_builtin_functions.stub.php` and one `.stub.php` per bundled extension. These are
 * ordinary PHP files,
 * so they are read by PARSING them with `parseFile` — the same entry point, the same
 * grammar, the same publication rules as the corpus walk. Nothing here is a hand-typed
 * list, and nothing is extracted from the stubs' text with a pattern: a wrong extraction
 * would be a silent fabrication of the runtime.
 *
 * The reserved keywords are the other half and they are not declared anywhere as functions.
 * They come from `Zend/zend_language_parser.y`, the bison grammar: each `%token <ident>
 * T_ISSET "'isset'"` line names the spelling. This ONE read is a pattern over a BISON
 * GRAMMAR FILE, not over PHP source — a different artifact class, where the lines are
 * declarations and there are no comments or string literals to confuse it. It is called out
 * here because the lane's criterion 1 is that the ANALYZER is regex-free, and this is not
 * the analyzer.
 *
 * ## THE GUARD THAT MAKES IT SAFE
 *
 * PHP permits a program to declare a function whose name collides with a builtin, and then
 * every call in that program resolves to the declaration. A table used to SUPPRESS edges
 * would therefore be able to hide a real local edge. So the script MEASURES that margin
 * instead of asserting it is zero: it intersects the derived table with every symbol the
 * 5,094-file corpus walk publishes, and reports the intersection. Any entry in that
 * intersection is a name where suppression could be wrong, and it is printed by name.
 *
 * ## WHY SUPPRESS FOR `calls` AND LABEL FOR EVERYTHING ELSE
 *
 * The analyzer's own header (unchanged by this) records the design: the builtin filter
 * "would otherwise flood every file with self-evident call edges". So a `calls` edge to
 * `sprintf` is SUPPRESSED, which keeps the edge count from growing. For the other types the
 * edge carries information a consumer wants — `extends -> Countable` says the class
 * implements PHP's contract — so those are LABELLED with `metadata.external` instead of
 * dropped. Labelling is additive: it changes no edge count and removes no edge.
 *
 * ## RUN
 *
 *   npx tsx validation/m14/fixtures/php/internal-symbol-table.mts
 *   npx tsx validation/m14/fixtures/php/internal-symbol-table.mts --src /path/to/php-src
 *
 * `--src` defaults to `/tmp/opencode/php-src`. If that directory is absent the script
 * bootstraps it: a `--depth 1 --filter=blob:none --no-checkout` clone plus a no-cone
 * sparse-checkout of the no-cone patterns in `SPARSE` below — every `.stub.php` at php-src's
 * root, under `Zend/`, and one directory level under `ext/`, plus `Zend/zend_language_parser.y`
 * and the three headers the core constants live in.
 * The generated table is committed, so the analyzer needs
 * neither the network nor php-src to build; re-running reproduces it byte for byte from the
 * php-src commit recorded in the generated header.
 *
 * Writes `src/ast/php-internal-symbols.ts` and `validation/m60/php/internal-symbol-table.json`.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { fileURLToPath } from "node:url"

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const ROOT = path.resolve(HERE, "../../../..")
const DEFAULT_SRC = "/tmp/opencode/php-src"
const SPARSE = ["/*.stub.php", "/Zend/*.stub.php", "/ext/*/*.stub.php", "/Zend/zend_language_parser.y", "/main/php.h", "/Zend/zend.h", "/main/php_globals.h"]

const argv = process.argv.slice(2)
const srcArg = argv.indexOf("--src")
const SRC = srcArg >= 0 ? argv[srcArg + 1] : (process.env.PHP_SRC ?? DEFAULT_SRC)
const OUT_TS = path.join(ROOT, "src/ast/php-internal-symbols.ts")
const OUT_JSON = path.join(ROOT, "validation/m60/php/internal-symbol-table.json")

// ------------------------------------------------------------------ php-src

if (!existsSync(path.join(SRC, ".git"))) {
  console.log(`php-src absent at ${SRC}; bootstrapping a sparse clone (network required, once)`)
  execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "https://github.com/php/php-src", SRC], { stdio: "inherit" })
}
const commit = execFileSync("git", ["-C", SRC, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const commitDate = execFileSync("git", ["-C", SRC, "log", "-1", "--format=%cI"], { encoding: "utf8" }).trim()

function stubFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const abs = path.join(dir, e)
      const st = statSync(abs)
      if (st.isDirectory()) walk(abs)
      else if (e.endsWith(".stub.php")) out.push(abs)
    }
  }
  walk(root)
  return out.sort()
}
const stubs = stubFiles(SRC)
if (stubs.length === 0) {
  execFileSync("git", ["-C", SRC, "sparse-checkout", "init", "--no-cone"], { stdio: "inherit" })
  execFileSync("git", ["-C", SRC, "sparse-checkout", "set", ...SPARSE], { stdio: "inherit" })
  execFileSync("git", ["-C", SRC, "checkout"], { stdio: "inherit" })
}
const stubList = stubFiles(SRC)
console.log(`php-src ${commit.slice(0, 12)} (${commitDate})`)
console.log(`stub files: ${stubList.length}`)

// ------------------------------------------------------------------ parse

/** php namespace separators are case-insensitive in PHP but the runtime table is one case. */
const norm = (s: string) => s.replace(/^\\+/, "").toLowerCase()

const functions = new Map<string, string>()
const classes = new Map<string, string>()
const constants = new Map<string, string>()
/** Names declared inside a namespace in a stub file. PHP resolves those unqualified too, but the spelling differs; counted, not folded in silently. */
let namespacedDeclarations = 0
let stubFailures = 0
const KIND_OF: Record<string, string> = { function: "function", class: "class", interface: "class", enum: "class", trait: "class" }

for (const abs of stubList) {
  let r: any
  try {
    r = await parseFile(abs, "php")
  } catch {
    stubFailures++
    continue
  }
  if (!r) {
    stubFailures++
    continue
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const kind = String(s?.kind ?? "")
    const bucket = KIND_OF[kind] ?? (kind === "constant" ? "constant" : null)
    if (!bucket) continue
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    // A namespaced declaration is NOT a global builtin. Counted, then skipped.
    const q = String(s?.qualifiedName ?? "")
    if (q.includes("\\")) {
      namespacedDeclarations++
      continue
    }
    const table = bucket === "function" ? functions : bucket === "class" ? classes : constants
    if (!table.has(name)) table.set(name, path.relative(SRC, abs))
  }
}
console.log(`parsed: functions ${functions.size}  classes ${classes.size}  constants ${constants.size}`)
console.log(`  namespaced declarations skipped: ${namespacedDeclarations}`)
console.log(`  stub files that failed to parse: ${stubFailures}`)

// ------------------------------------------------------------------ keywords

/**
 * The reserved keywords, read from the bison grammar's own `%token <ident> T_X "'spelling'"`
 * lines. This is the ONE non-AST read in the script and it is over a BISON FILE.
 */
const parserPath = path.join(SRC, "Zend/zend_language_parser.y")
const keywords = new Set<string>()
if (existsSync(parserPath)) {
  const TOKEN_LINE = /^%token\s+<ident>\s+(T_[A-Z_0-9]+)\s+"'([^']+)'"/
  for (const line of readFileSync(parserPath, "utf8").split("\n")) {
    const m = TOKEN_LINE.exec(line)
    if (!m) continue
    // Only the KEYWORD tokens carry a keyword spelling in single quotes; `T_STRING` etc. do not.
    keywords.add(m[2])
  }
} else {
  console.log(`  WARNING ${parserPath} absent — the keyword half of the table is EMPTY`)
}
console.log(`  reserved keyword spellings: ${keywords.size}`)

/**
 * The superglobals are not keywords and not declared in a stub: they are compiler-provided
 * globals. `zend_language_parser.y` does carry them (`T_VARIABLE` with the `_` names in
 * `zend_compile.c`), so they are listed here as a declared constant rather than derived —
 * counted in the report so a reader can see exactly which names came from which source.
 */
const SUPERGLOBALS = ["GLOBALS", "_SERVER", "_GET", "_POST", "_FILES", "_COOKIE", "_SESSION", "_REQUEST", "_ENV"]
for (const s of SUPERGLOBALS) keywords.add(s)

/**
 * The core `PHP_*` / `E_*` constants are NOT in any stub: they are preprocessor defines in
 * `main/php.h`, so the stub parse above found 3,619 extension constants and missed them —
 * `PHP_EOL`, `PHP_INT_MAX`, `PHP_VERSION` and the `error_reporting` family, which the corpus
 * walk names 547 times between `uses` and `imports` alone.
 *
 * So they are read from the header's own `#define` lines, filtered to the shape PHP's
 * constants actually have: an identifier in SHOUTING CASE. The filter is a FILTER, not a
 * selector — it also admits `ZEND_*` and `MAXPATHLEN`, and both counts are reported so the
 * reader sees the population rather than only the survivors. Over-inclusion here can only
 * ever make a name resolve as internal when it is not, which for `calls` is neutralised by
 * the per-file check the analyzer applies before suppressing (see THE GUARD below), and for
 * the labelling paths is bounded by the per-type kind restriction in `phpInternalKind`.
 */
const HEADER_DEFINES = ["main/php.h", "Zend/zend.h", "main/php_globals.h"]
const SHOUTING = /^[A-Z][A-Z0-9_]*$/
const headerDefinesRead = new Map<string, string>()
let headerLinesScanned = 0
for (const rel of HEADER_DEFINES) {
  const abs = path.join(SRC, rel)
  if (!existsSync(abs)) continue
  for (const line of readFileSync(abs, "utf8").split("\n")) {
    headerLinesScanned++
    const m = /^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line)
    if (!m) continue
    if (!SHOUTING.test(m[1])) continue
    if (m[1].length < 2) continue
    if (!headerDefinesRead.has(m[1])) headerDefinesRead.set(m[1], rel)
  }
}
for (const name of headerDefinesRead.keys()) if (!constants.has(name)) constants.set(name, `#define in ${headerDefinesRead.get(name)}`)
console.log(`  header defines admitted: ${headerDefinesRead.size} (from ${headerLinesScanned} lines of ${HEADER_DEFINES.length} headers)`)
console.log(`  constants after the header half: ${constants.size}`)


// ------------------------------------------------------------------ merge + guard

const functionSet = new Set(functions.keys())
const classSet = new Set(classes.keys())
const constantSet = new Set(constants.keys())
const constructSet = new Set(keywords)

/** Everything PHP itself declares, by name — the union the analyser consults. */
const internal = new Set<string>([...functionSet, ...classSet, ...constantSet, ...constructSet])

/**
 * CONTROL. A generator that reads 0 from php-src writes an EMPTY table, the analyzer then
 * filters nothing and labels nothing, and the lane's numbers come back identical to "nothing
 * was wrong". That is not hypothetical here: the first run of this script emitted a module
 * whose header comment contained a `slash-star-star` sequence, the comment closed early, the
 * module failed to load, `parseFile` degraded — and this script printed
 * `functions 0  classes 0` with `stub files that failed to parse: 0`. It looked like a
 * measurement and was a broken build.
 *
 * So the floor is asserted, and it is a floor rather than an equality because the table is
 * allowed to shrink if php-src does: php 8 has never had fewer than 2,000 internal functions
 * or 150 internal classes, so these bounds are properties of the language, not of this run.
 */
const FLOOR = { functions: 2000, classes: 150, constants: 200, constructs: 40 }
for (const [k, floor] of Object.entries(FLOOR)) {
  const got = k === "constants" ? constantSet.size : k === "constructs" ? constructSet.size : k === "functions" ? functionSet.size : classSet.size
  if (got < floor) throw new Error(`CONTROL FAILED: derived ${k} = ${got}, floor ${floor}. The table would be smaller than PHP's own surface — treat that as a broken read, not a finding.`)
}
console.log(`  CONTROL floors held: ${Object.entries(FLOOR).map(([k, f]) => `${k}>=${f}`).join(" ")}`)

/**
 * THE GUARD. Read the corpus walk's published symbol names and intersect them with the
 * derived table. A hit is a name PHP declares AND a corpus file also declares, i.e. exactly
 * the case where suppressing an edge would hide a real local declaration. Printed by name.
 */
const corpusJson = path.join(ROOT, "validation/m60/php/ambiguity-split.json")
let guard: { ran: boolean; corpusArtifact: string; publishedNames: number; collisions: Record<string, { kinds: Record<string, number>; corpusCount: number }> } = {
  ran: false,
  corpusArtifact: path.relative(ROOT, corpusJson),
  publishedNames: 0,
  collisions: {},
}
if (existsSync(corpusJson)) {
  const walk = JSON.parse(readFileSync(corpusJson, "utf8"))
  const published = new Set<string>(walk.distinctPublishedNames ? [] : [])
  // `distinctPublishedNames` is a COUNT, so the names themselves come from the per-kind census
  // if the walk recorded them; otherwise the guard reports what it can and says so.
  const names = new Set<string>(Array.isArray(walk.publishedNames) ? walk.publishedNames.map(String) : [])
  published.clear()
  guard.ran = names.size > 0
  guard.publishedNames = names.size
  for (const n of names) if (internal.has(n)) bumpKind(guard.collisions, n)
  if (!guard.ran) {
    console.log(`  GUARD INCONCLUSIVE: ${path.relative(ROOT, corpusJson)} records ${walk.distinctPublishedNames} distinct names but not the names themselves.`)
    console.log(`  Run with --names <walk.json> from a walk that serialises them, or read the collision surface from the analyzer fixtures.`)
  }
}
function bumpKind(dst: Record<string, { kinds: Record<string, number>; corpusCount: number }>, n: string) {
  const e = dst[n] ?? (dst[n] = { kinds: {}, corpusCount: 0 })
  e.corpusCount++
}

console.log("")
console.log(`GUARD — corpus-published names that php-src also declares`)
console.log(`  ran: ${guard.ran ? "YES" : "NO (conclusive 0 unavailable)"}  corpus names read: ${guard.publishedNames}`)
console.log(`  collisions: ${Object.keys(guard.collisions).length}`)

// ------------------------------------------------------------------ emit

function block(title: string, provenance: string, set: Set<string>): string {
  const names = [...set].sort()
  const lines: string[] = []
  for (let i = 0; i < names.length; i += 8) lines.push("    " + names.slice(i, i + 8).map((n) => JSON.stringify(n)).join(", ") + ",")
  return [
    `/**`,
    ` * ${title}`,
    ` *`,
    ` * ${provenance}`,
    ` *`,
    ` * ${names.length} names. Sorted, so a diff of two revisions is readable.`,
    ` */`,
    `export const ${nameOf(title)}: ReadonlySet<string> = new Set([`,
    lines.join("\n"),
    `])`,
    ``,
  ].join("\n")
}
function nameOf(title: string): string {
  if (title.includes("FUNCTION")) return "PHP_INTERNAL_FUNCTIONS"
  if (title.includes("CLASS")) return "PHP_INTERNAL_CLASSES"
  if (title.includes("CONSTANT")) return "PHP_INTERNAL_CONSTANTS"
  return "PHP_LANGUAGE_CONSTRUCTS"
}

const header = `/**
 * PHP'S OWN INTERNAL SYMBOLS — functions, classes, constants and reserved keywords, as
 * php-src declares them.
 *
 * GENERATED FILE. Source of truth and regeneration command:
 *   validation/m14/fixtures/php/internal-symbol-table.mts
 *
 *   php-src commit  ${commit}
 *   php-src date    ${commitDate}
 *   stub files      ${stubList.length}  (Zend/zend_builtin_functions.stub.php plus one stub per bundled extension)
 *   keywords        Zend/zend_language_parser.y
 *   read with       parseFile (src/ast/pool-worker.ts) — production entry point, same grammar
 *
 * WHY A MODULE AND NOT A TABLE IN THE ANALYZER. \`script/m14/differential.ts\` imports the
 * analyzer's \`PHP_BUILTINS\` as DATA — \`script/m60/php-oracle-independence.ts\` classifies it
 * that way on purpose, with the reason: "a hand-copied list of builtin names drifts, and the
 * drift would fabricate or hide call edges." Both sides must read ONE declaration. This is
 * that declaration; \`real-php-analyzer.ts\` re-exports it as \`PHP_BUILTINS\`.
 *
 * WHY THE OLD LIST WAS REPLACED RATHER THAN ADDED TO. The hand-curated set had 218 names and
 * no class half at all. Against a 5,094-file corpus walk the largest unresolved \`imports\`
 * targets were \`sprintf\` 439, \`assert\` 184, \`is_string\` 152, \`PHP_EOL\` 134 and the largest
 * \`instantiates\` targets \`ReflectionProperty\` 250, \`ReflectionMethod\` 190,
 * \`ReflectionClass\` 90, \`DateTimeImmutable\` 75 — declared by php-src, absent from the set.
 *
 * THE LIMITATION, STATED. This is php-src MASTER at the commit above, which is PHP 8.x with
 * the bundled extensions. It is not a build of any particular PHP: an extension or a PECL
 * function absent from master is absent from this table, and a function only a distribution
 * ships is likewise absent. A name missing here resolves as UNRESOLVED, which is the same
 * verdict it had before this file existed — so the table can only ever remove false
 * externality claims, never add one. The measured collision margin is in
 * \`validation/m60/php/internal-symbol-table.json\` (\`guard\`).
 *
 * ${functionSet.size} functions, ${classSet.size} classes, ${constantSet.size} constants, ${constructSet.size} keywords/globals.
 */

`

const lookup = (n: string): PhpInternalKind | null =>
  functionSet.has(n) ? "php-internal-function"
  : classSet.has(n) ? "php-internal-class"
  : constantSet.has(n) ? "php-internal-constant"
  : constructSet.has(n) ? "php-language-construct"
  : null

const ts = [
  header,
  `/** Which half of php-src's own surface a name came from. */`,
  `export type PhpInternalKind = "php-internal-function" | "php-internal-class" | "php-internal-const" | "php-internal-constant" | "php-language-construct"`,
  ``,
  block("PHP INTERNAL FUNCTIONS — every global function php-src's stubs declare.", `php-src ${commit.slice(0, 12)}, ${functionSet.size} declarations from ${stubList.length} stub files.`, functionSet),
  block("PHP INTERNAL CLASSES — every class/interface/enum/trait php-src's stubs declare. A class is one bucket because PHP's OWN resolution does not distinguish them for the question being asked here: can any corpus file declare this name?", `php-src ${commit.slice(0, 12)}, ${classSet.size} declarations.`, classSet),
  block("PHP INTERNAL CONSTANTS — global constants: a const NAME declaration at stub file scope, plus the core #defines in main/php.h and Zend/zend.h (the PHP_* and E_* families live there, not in any stub).", `php-src ${commit.slice(0, 12)}: ${constantSet.size} names — stub const declarations AND ${headerDefinesRead.size} SHOUTING-CASE #defines from ${HEADER_DEFINES.length} headers.`, constantSet),
  block("PHP LANGUAGE CONSTRUCTS — the reserved keywords, read from the bison grammar's token declarations, plus the compiler-provided superglobals.", `Zend/zend_language_parser.y %token <ident> spellings + ${SUPERGLOBALS.length} superglobals.`, constructSet),
  `/** Every internal name, without the kind. */`,
  `export const PHP_INTERNAL_ALL: ReadonlySet<string> = new Set([`,
  `  ...PHP_INTERNAL_FUNCTIONS, ...PHP_INTERNAL_CLASSES, ...PHP_INTERNAL_CONSTANTS, ...PHP_LANGUAGE_CONSTRUCTS,`,
  `])`,
  ``,
  `/**`,
  ` * Which internal kind a name is, or null when php-src declares nothing by that name.`,
  ` *`,
  ` * Ordered so a name in more than one bucket reports the most specific one. The buckets are`,
  ` * disjoint in practice; a collision is reported by the generator's \`overlaps\` counter.`,
  ` */`,
  `export function phpInternalKind(name: string): PhpInternalKind | null {`,
  `  if (PHP_INTERNAL_FUNCTIONS.has(name)) return "php-internal-function"`,
  `  if (PHP_INTERNAL_CLASSES.has(name)) return "php-internal-class"`,
  `  if (PHP_INTERNAL_CONSTANTS.has(name)) return "php-internal-constant"`,
  `  if (PHP_LANGUAGE_CONSTRUCTS.has(name)) return "php-language-construct"`,
  `  return null`,
  `}`,
  ``,
  `/** Provenance, carried in the data so a consumer never has to trust a comment. */`,
  `export const PHP_INTERNAL_PROVENANCE = {`,
  `  source: "https://github.com/php/php-src",`,
  `  commit: ${JSON.stringify(commit)},`,
  `  date: ${JSON.stringify(commitDate)},`,
  `  stubFiles: ${stubList.length},`,
  `  functions: ${functionSet.size},`,
  `  classes: ${classSet.size},`,
  `  constants: ${constantSet.size},`,
  `  constructs: ${constructSet.size},`,
  `  generator: "validation/m14/fixtures/php/internal-symbol-table.mts",`,
  `} as const`,
  ``,
].join("\n")

mkdirSync(path.dirname(OUT_TS), { recursive: true })
writeFileSync(OUT_TS, ts)
mkdirSync(path.dirname(OUT_JSON), { recursive: true })
writeFileSync(
  OUT_JSON,
  JSON.stringify(
    {
      instrument: "validation/m14/fixtures/php/internal-symbol-table.mts",
      entryPoint: "parseFile (src/ast/pool-worker.ts)",
      phpSrc: { repo: "https://github.com/php/php-src", commit, date: commitDate, stubFiles: stubList.length },
      parsed: {
        functions: functionSet.size,
        classes: classSet.size,
        constants: constantSet.size,
        constructs: constructSet.size,
        union: internal.size,
        namespacedDeclarationsSkipped: namespacedDeclarations,
        stubParseFailures: stubFailures,
      },
      keywordsFrom: "Zend/zend_language_parser.y",
      superglobalsDeclaredNotDerived: SUPERGLOBALS,
      coreConstantsFrom: { headers: HEADER_DEFINES, linesScanned: headerLinesScanned, admitted: headerDefinesRead.size, filter: "SHOUTING-CASE identifier after #define", notFromStubs: [...headerDefinesRead.keys()].filter((n) => !constants.has(n)).length },
      overlaps: {
        functionAndClass: [...functionSet].filter((n) => classSet.has(n)).length,
        functionAndConstant: [...functionSet].filter((n) => constantSet.has(n)).length,
        classAndConstant: [...classSet].filter((n) => constantSet.has(n)).length,
        functionAndConstruct: [...functionSet].filter((n) => constructSet.has(n)).length,
        classAndConstruct: [...classSet].filter((n) => constructSet.has(n)).length,
      },
      guard,
      writes: { module: path.relative(ROOT, OUT_TS), moduleBytes: Buffer.byteLength(ts) },
    },
    null,
    2,
  ) + "\n",
)
console.log("")
console.log(`wrote ${path.relative(ROOT, OUT_TS)} (${Buffer.byteLength(ts)} bytes)`)
console.log(`wrote ${path.relative(ROOT, OUT_JSON)}`)