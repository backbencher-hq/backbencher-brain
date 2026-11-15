/**
 * probe-h-boundary.ts — the c/cpp `.h` boundary, MEASURED from the corpus.
 *
 * Author: Muhammad Ishaq Khan. Probe, not production code.
 *
 * The question is the Lead's, and it has two sides. This probe writes the C
 * side: of the `.h` files the router hands to the C analyzer, how many are
 * actually C++, by the four markers the proposal is stated in — `class`,
 * `namespace`, `template<`, `::` — and WHY the router's own disambiguation
 * (src/ast/language-detection.ts:402) did not see it.
 *
 * TWO ROUTES ARE MEASURED, because the tree has two and they disagree:
 *   PRODUCTION   pool-worker.ts:1079 `detectLanguageFromPath(filePath)` — NO
 *                content, so every `.h` goes to c. This is the indexing path.
 *   ENGINE/GATE  engine.ts:1772 `detectLanguage(filePath, content)` — the
 *                content sniff at language-detection.ts:402. The incoming gate
 *                and the firing gate go through this path.
 * A file set that differs between the two predicates is a measurement-vs-
 * production divergence, and it is printed as one.
 *
 * Marker evidence is measured on comment/string-stripped code, because
 * `// public:` in prose is not C++ (the router's own measured false-positive
 * class). `::` is PARTITIONED by cause, because C has three ways to spell it
 * without a scope operator: `asm volatile ("" ::: "memory")`, a C23 attribute
 * `[[clang::no_sanitize]]`, and prose. Counting those as C++ would be the
 * false-positive class this lane already convicted once.
 *
 * Population: every TRACKED `.h` file in the corpus, discovered with
 * `git ls-files` per repository — the same discovery rule as
 * script/m14/incoming-gate.ts. Absent, over-cap and unreadable files are
 * counted, not silently dropped.
 *
 * Run: bun run validation/m14/fixtures/c/probe-h-boundary.ts
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const HEAD = 65536

/** Replace comments and string/char literals with spaces, preserving offsets. */
function stripCommentsAndStrings(src: string): string {
  const out: string[] = []
  let i = 0
  const n = src.length
  let state: "code" | "line" | "block" | "str" | "chr" = "code"
  while (i < n) {
    const ch = src[i]
    const next = i + 1 < n ? src[i + 1] : ""
    if (state === "code") {
      if (ch === "/" && next === "/") { state = "line"; out.push("  "); i += 2; continue }
      if (ch === "/" && next === "*") { state = "block"; out.push("  "); i += 2; continue }
      if (ch === '"') { state = "str"; out.push(" "); i++; continue }
      if (ch === "'") { state = "chr"; out.push(" "); i++; continue }
      out.push(ch); i++; continue
    }
    if (state === "line") {
      if (ch === "\n") { state = "code"; out.push("\n") } else out.push(" ")
      i++; continue
    }
    if (state === "block") {
      if (ch === "*" && next === "/") { state = "code"; out.push("  "); i += 2; continue }
      out.push(ch === "\n" ? "\n" : " "); i++; continue
    }
    if (ch === "\\") { out.push(" "); if (next) out.push(next === "\n" ? "\n" : " "); i += 2; continue }
    if ((state === "str" && ch === '"') || (state === "chr" && ch === "'")) { state = "code"; out.push(" "); i++; continue }
    out.push(ch === "\n" ? "\n" : " "); i++
  }
  return out.join("")
}

/** Strip COMMENTS only — string/char literals are KEPT, because the `::`
 *  partition depends on seeing an asm constraint string (`:: "r"(x)`): on the
 *  fully-stripped text that quote is a space and every inline-asm `::` would
 *  be counted as a C++ scope operator. Marker evidence still uses the fully
 *  stripped text, so a `"namespace foo"` string cannot route a file. */
function stripCommentsOnly(src: string): string {
  const out: string[] = []
  let i = 0
  const n = src.length
  let state: "code" | "line" | "block" = "code"
  while (i < n) {
    const ch = src[i]
    const next = i + 1 < n ? src[i + 1] : ""
    if (state === "code") {
      if (ch === "/" && next === "/") { state = "line"; out.push("  "); i += 2; continue }
      if (ch === "/" && next === "*") { state = "block"; out.push("  "); i += 2; continue }
      out.push(ch); i++; continue
    }
    if (state === "line") {
      if (ch === "\n") { state = "code"; out.push("\n") } else out.push(" ")
      i++; continue
    }
    if (ch === "*" && next === "/") { state = "code"; out.push("  "); i += 2; continue }
    out.push(ch === "\n" ? "\n" : " "); i++
  }
  return out.join("")
}

type ScopeHit = "asm-colon" | "c23-attribute" | "scope-operator"

/** Next non-whitespace character at/after i (or "" at end of code). */
function nextNonSpace(code: string, i: number): string {
  let j = i
  while (j < code.length) {
    const c = code[j]
    if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") return c
    j++
  }
  return ""
}
/** Previous non-whitespace character before i (or "" at start). */
function prevNonSpace(code: string, i: number): string {
  let j = i - 1
  while (j >= 0) {
    const c = code[j]
    if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") return c
    j--
  }
  return ""
}

/** Classify EVERY `::` in stripped code.
 *
 *  C spells `::` outside C++ in exactly two ways, and both are decidable from
 *  the character around it:
 *    - an INLINE-ASM constraint list — the token is followed by a constraint
 *      string (`:: "r"(x)`) or is the middle of `:::` (`"" ::: "memory"`), and
 *      a C++ scope operator is NEVER followed by a quote;
 *    - a C23 attribute namespace — `[[clang::no_sanitize]]`, where a `[[` is
 *      open and unmatched on the line.
 *  Everything else is a scope operator, which C does not have. */
function scopeHits(code: string): ScopeHit[] {
  const hits: ScopeHit[] = []
  let idx = code.indexOf("::")
  while (idx >= 0) {
    const inAttribute = code.lastIndexOf("[[", idx) > code.lastIndexOf("]]", idx)
    const next = nextNonSpace(code, idx + 2)
    const prev = prevNonSpace(code, idx)
    const thirdColon = code[idx + 2] === ":"
    if (inAttribute) hits.push("c23-attribute")
    else if (thirdColon || next === '"' || (prev === '"' && next === '"')) hits.push("asm-colon")
    else hits.push("scope-operator")
    idx = code.indexOf("::", idx + 2)
  }
  return hits
}

const STRONG: ReadonlyArray<readonly [string, RegExp]> = [
  ["class", /(?<!@)\bclass\s+[A-Za-z_][\w:]*/],
  ["namespace", /\bnamespace\s+[A-Za-z_][\w:]*/],
  ["template<", /\btemplate\s*</],
]
const ROUTER_CLASS = /\bclass\s+[A-Za-z_][\w:]*\s*(?::\s*[^\n{]*)?\s*\{/
const ROUTER_NAMESPACE = /\bnamespace\s+[A-Za-z_][\w:]*\s*\{/
const ROUTER_CPP_INCLUDE = /#include\s*[<"](?:algorithm|array|bits\/|cassert|cctype|cerrno|cfloat|climits|cmath|cstddef|cstdint|cstdio|cstdlib|cstring|ctime|deque|exception|fstream|functional|iomanip|ios|iosfwd|iostream|istream|iterator|limits|list|locale|map|memory|mutex|new|numeric|ostream|queue|regex|set|sstream|stack|stdexcept|streambuf|string|typeinfo|unordered_map|unordered_set|utility|valarray|vector)[">]/
const FORWARD_CLASS = /\bclass\s+[A-Za-z_][\w:]*\s*[;,]\s/
const USING_NAMESPACE = /\busing\s+namespace\s+[A-Za-z_]/
const CPP_GUARD = /__cplusplus/
const OBJC_ONLY = /@(?:interface|protocol|implementation|class)\s+[A-Za-z_]/

type Row = {
  repo: string
  rel: string
  engineRoute: string | null
  strong: string[]
  scope: ScopeHit[]
  routerClass: boolean
  routerNamespace: boolean
  routerInclude: boolean
  forwardClass: boolean
  usingNs: boolean
  cppGuard: boolean
  objcMarker: boolean
  headOnlyStrong: boolean
}

const rows: Row[] = []
const counts = { absent: 0, overCap: 0, unreadable: 0, empty: 0, c: 0, cpp: 0, objc: 0, other: 0, null: 0 }

function exists(p: string): boolean {
  try { statSync(p); return true } catch { return false }
}

const repos = readdirSync(CR).sort()
let repoCount = 0
for (const name of repos) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  repoCount++
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".h")) continue
    const abs = path.join(dir, rel)
    let content: string
    try {
      if (statSync(abs).size > SIZE_CAP) { counts.overCap++; continue }
      content = readFileSync(abs, "utf8")
    } catch {
      if (exists(abs)) counts.unreadable++
      else counts.absent++
      continue
    }
    if (content.trim().length === 0) { counts.empty++; continue }
    const engineRoute = detectLanguageFromPath(abs, content) as string | null
    const codeFull = stripCommentsAndStrings(content)
    const codeHead = stripCommentsAndStrings(content.slice(0, HEAD))
    const strong: string[] = []
    const strongHead: string[] = []
    for (const [marker, re] of STRONG) {
      if (re.test(codeFull)) strong.push(marker)
      if (re.test(codeHead)) strongHead.push(marker)
    }
    const scope = scopeHits(stripCommentsOnly(content))
    rows.push({
      repo: name, rel, engineRoute, strong, scope,
      routerClass: ROUTER_CLASS.test(codeHead),
      routerNamespace: ROUTER_NAMESPACE.test(codeHead),
      routerInclude: ROUTER_CPP_INCLUDE.test(codeHead),
      forwardClass: FORWARD_CLASS.test(codeFull),
      usingNs: USING_NAMESPACE.test(codeFull),
      cppGuard: CPP_GUARD.test(codeFull),
      objcMarker: OBJC_ONLY.test(codeFull),
      headOnlyStrong: strongHead.length !== strong.length,
    })
    if (engineRoute === "c") counts.c++
    else if (engineRoute === "cpp") counts.cpp++
    else if (engineRoute === "objective-c") counts.objc++
    else if (engineRoute === null) counts.null++
    else counts.other++
  }
}

const total = rows.length + counts.overCap + counts.absent + counts.unreadable + counts.empty
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(2)}%`)
/** Genuine C++ evidence: a strong marker, or a `::` that is a SCOPE OPERATOR (not asm/attribute). */
const genuine = (r: Row): string[] => {
  const ev = [...r.strong]
  if (r.scope.includes("scope-operator")) ev.push("::")
  return ev
}
const hasGenuine = (r: Row): boolean => genuine(r).length > 0
const scopeCounts = { "asm-colon": 0, "c23-attribute": 0, "scope-operator": 0 }
for (const r of rows) for (const h of r.scope) scopeCounts[h]++

const cRows = rows.filter((r) => r.engineRoute === "c")
const cppRows = rows.filter((r) => r.engineRoute === "cpp")
const objcRows = rows.filter((r) => r.engineRoute === "objective-c")
const genuineAll = rows.filter(hasGenuine)
const genuineC = cRows.filter(hasGenuine)
const strongAll = rows.filter((r) => r.strong.length > 0)
const strongC = cRows.filter((r) => r.strong.length > 0)
const scopeOnlyC = cRows.filter((r) => r.strong.length === 0 && r.scope.includes("scope-operator"))
const asmOnlyC = cRows.filter((r) => r.strong.length === 0 && r.scope.length > 0 && !r.scope.includes("scope-operator"))
const classMissed = cRows.filter((r) => r.strong.includes("class") && !r.routerClass)
const nsMissed = cRows.filter((r) => r.strong.includes("namespace") && !r.routerNamespace)
const headOnlyGenuine = cRows.filter((r) => r.headOnlyStrong && hasGenuine(r))
const byMarker: Record<string, number> = {}
for (const r of genuineC) for (const m of genuine(r)) byMarker[m] = (byMarker[m] ?? 0) + 1

console.log("# .h BOUNDARY PROBE — corpus " + CR)
console.log(`# repos measured: ${repoCount}`)
console.log(`# tracked .h files: ${total}  (measured ${rows.length} · over 1MB ${counts.overCap} · absent ${counts.absent} · unreadable ${counts.unreadable} · empty ${counts.empty})`)
console.log("#")
console.log("# PRODUCTION ROUTE — pool-worker.ts:1079 detectLanguageFromPath(filePath), NO content:")
console.log(`#   c            ${rows.length}   (100.00% — every measurable .h is parsed by the C analyzer in indexing)`)
console.log("# ENGINE/GATE ROUTE — engine.ts:1772 detectLanguage(filePath, content), the content sniff:")
console.log(`#   c            ${counts.c}  (${pct(counts.c, rows.length)})`)
console.log(`#   cpp          ${counts.cpp}  (${pct(counts.cpp, rows.length)})`)
console.log(`#   objective-c  ${counts.objc}  (${pct(counts.objc, rows.length)})`)
console.log(`#   null/other   ${counts.null}/${counts.other}`)
console.log(`#   DIVERGENCE   ${counts.cpp + counts.objc} .h files (~${pct(counts.cpp + counts.objc, rows.length)}) are parsed by a DIFFERENT analyzer in the gate than in production`)
console.log("#")
console.log("# C++ EVIDENCE, MEASURED ON COMMENT/STRING-STRIPPED CODE, all measurable .h:")
console.log(`#   strong marker (class|namespace|template<)   ${strongAll.length}  (${pct(strongAll.length, rows.length)} of .h)`)
console.log(`#   genuine C++ (strong marker OR real ::)      ${genuineAll.length}  (${pct(genuineAll.length, rows.length)} of .h)`)
console.log(`#   of the genuine: DUAL-language (carry __cplusplus) ${genuineAll.filter((r) => r.cppGuard).length} · C++-only ${genuineAll.filter((r) => !r.cppGuard).length}`)
console.log(`#   :: occurrences partitioned: scope-operator ${scopeCounts["scope-operator"]} · asm-colon ${scopeCounts["asm-colon"]} · C23-attribute ${scopeCounts["c23-attribute"]}`)
console.log(`#   objective-c marker (@interface/@protocol/@implementation/@class) in c-routed: ${cRows.filter((r) => r.objcMarker).length} (a THIRD boundary, disclosed not claimed)`)
console.log(`#   headers whose ONLY :: are asm/attribute     ${asmOnlyC.length} (c-routed) + ${rows.filter((r) => r.engineRoute !== "c" && r.strong.length === 0 && r.scope.length > 0 && !r.scope.includes("scope-operator")).length} (other routes)`)
console.log("#")
console.log(`# THE RESIDUE THE C ANALYZER RECEIVES IN PRODUCTION — genuine C++ among ALL ${rows.length} .h: ${genuineAll.length}`)
console.log(`#   of which plain C headers with NO genuine evidence: ${rows.length - genuineAll.length}`)
console.log(`#   under the ENGINE/GATE sniff the C analyzer would receive only ${counts.c} .h, of which genuine C++ is ${genuineC.length} (${pct(genuineC.length, counts.c)} of its .h feed)`)
console.log(`#     of that residue: DUAL-language ${genuineC.filter((r) => r.cppGuard).length} · C++-only ${genuineC.filter((r) => !r.cppGuard).length}`)
console.log("#")
console.log("# AMONG THE ENGINE-ROUTED-c RESIDUE (the 137-class), by marker:")
for (const [m] of STRONG) console.log(`#   ${m.padEnd(10)} ${byMarker[m] ?? 0}`)
console.log(`#   ::         ${byMarker["::"] ?? 0}`)
console.log(`#   strong markers only (no ::) ${strongC.length - strongC.filter((r) => r.scope.includes("scope-operator")).length} · scope-only ${scopeOnlyC.length}`)
console.log("# WHY THE ROUTER MISSED THEM (engine-routed-c files):")
console.log(`#   class evidence, router's body-required marker did NOT fire   ${classMissed.length}`)
console.log(`#   namespace evidence, router marker did NOT fire               ${nsMissed.length}`)
console.log(`#   genuine evidence ONLY beyond the 64 KiB head                 ${headOnlyGenuine.length}`)
console.log(`#   C++ standard-header #include in head (router marker)         ${cRows.filter((r) => r.routerInclude).length}`)
console.log(`#   dual-language header carries __cplusplus                     ${cRows.filter((r) => r.cppGuard).length}`)
console.log("# EXAMPLES — engine-routed-c headers with genuine C++ evidence (first 40 by path):")
for (const r of genuineC.slice(0, 40)) console.log(`#   ${genuine(r).join("+").padEnd(24)} ${r.repo}/${r.rel}`)
console.log("# DECISION INPUT — extension-only remap (.h -> cpp, no sniff):")
console.log(`#   cpp gains ${genuineAll.length} genuine-C++ headers AND ${rows.length - genuineAll.length} plain C headers`)
console.log(`#   (${pct(rows.length - genuineAll.length, rows.length)} of its feed would be C), which is why the sniff exists.`)
console.log("# DECISION INPUT — content-aware routing shared by production and gates (engine predicate as production):")
console.log(`#   cpp gains ${counts.cpp} headers; c keeps ${counts.c} of ${rows.length}; ${counts.objc} go to objective-c.`)
console.log(`#   cpp still does NOT see ${genuineC.length} genuine-C++ headers (${pct(genuineC.length, genuineAll.length)} of all genuine-C++ .h).`)

// Machine-readable sidecar: every genuine-C++ header with its route and markers,
// so a reader can check the classification rather than trust the totals.
const tsv = ["repo\trel\tengineRoute\tmarkers\tscope_operator\tasm_colon\tc23_attribute\tstrong"]
for (const r of genuineAll) {
  tsv.push([
    r.repo, r.rel, r.engineRoute ?? "null", genuine(r).join("+"),
    r.scope.filter((h) => h === "scope-operator").length,
    r.scope.filter((h) => h === "asm-colon").length,
    r.scope.filter((h) => h === "c23-attribute").length,
    r.strong.join("+"),
  ].join("\t"))
}
writeFileSync("validation/m14/fixtures/c/measurements/probe-h-boundary.tsv", tsv.join("\n") + "\n")
console.log(`# artifact: validation/m14/fixtures/c/measurements/probe-h-boundary.tsv (${genuineAll.length} rows)`)
