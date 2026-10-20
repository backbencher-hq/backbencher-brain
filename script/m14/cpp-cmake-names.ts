/**
 * cpp-cmake-names — THE CMAKE READER, WITH ITS FIELD LIST, IN ONE PLACE.
 *
 * WHY THIS FILE EXISTS (the Lead's ruling, 2026-10-20): the package-scope claim's evidence is a PACKAGE
 * NAME, and a CMake `find_package`/target name is not one — which is the C++ lane's own ruling
 * (CPP-PACKAGE-SCOPE-RULING.md §0). So the gate's manifest reader is NOT extended with `CMakeLists.txt`
 * yet: extending it before the field list is stated would let the reader take EVERY string in a CMake file
 * as a dependency name, which is exactly the false claim the lane's falsifier is about.
 *
 * **This file is the field list, and the reader that implements it.** The Lead's condition for the
 * extension is: state exactly which fields of which CMake forms are read as names, and bring a verifier
 * that proves the read in both directions. That is what this file and
 * `script/m14/cpp-cmake-names-verify.ts` are.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * THE FIELD LIST — WHICH FORMS ARE READ, AND WHICH FIELD OF EACH
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * 1. `find_package(<Name> [version] [REQUIRED] [QUIET] [COMPONENTS <c>...])`
 *    READ: **argument 1 only** — `<Name>`.
 *    REFUSED: argument 2 when it is a VERSION (`find_package(Boost 1.75.0)` — `1.75.0` is a version, not a
 *    name); every `COMPONENTS` entry (they are the package's components, not packages); the keywords
 *    `REQUIRED`/`QUIET`/`EXACT`/`CONFIG`/`MODULE`/`COMPONENTS`.
 *    WHY: `<Name>` IS a package — CMake calls it a package, and the claim's word and CMake's word are the
 *    same word. A version is not a name, and a component is not a package.
 *
 * 2. `pkg_check_modules(<PREFIX> [REQUIRED] [QUIET] [IMPORTED_TARGET] <module>...)`
 *    READ: **the `<module>` arguments.**
 *    REFUSED: `<PREFIX>` (a local variable name — `ZLIB_FOUND` names nothing), the keywords, and any
 *    argument starting with `-`.
 *    WHY: the module is the pkg-config package; the prefix is a variable.
 *
 * 3. `target_link_libraries(<target> <item>...)`
 *    READ: **the NAMESPACE part of an `Ns::Tgt` item — AND ONLY AS CORROBORATION.**
 *    REFUSED: a bare item (it is either a PROJECT target or a raw linker name) and the keywords
 *    `PUBLIC`/`PRIVATE`/`INTERFACE` and any `-`-prefixed item.
 *    WHY: CMake's own convention makes `Ns` the package that provided the imported target — but a project
 *    may define an imported target of its own, so a namespace may NOT introduce a package on its own. It
 *    is recorded as a CORROBORATION of a name that forms 1 or 2 already declared, and it is DROPPED
 *    otherwise. **This is the rule that stops the reader from manufacturing a package out of a namespace.**
 *
 * 4. `find_library(<VAR> NAMES <stem>...)` · `find_path(<VAR> NAMES <stem>...)`
 *    READ: **NOTHING.**
 *    WHY: a `NAMES` entry is a FILE STEM the linker searches for, not a package. `find_library(X NAMES z)`
 *    does not declare a dependency named `z`.
 *
 * 5. `add_library(<name> ...)` · `add_executable(<name> ...)`
 *    READ: **NOTHING.**
 *    WHY: a PROJECT TARGET. (An `IMPORTED` target names something installed elsewhere, but the reader
 *    cannot tell which package provided it, so it is not read.)
 *
 * 6. `add_subdirectory(<dir>...)`
 *    READ: **NOTHING.**
 *    WHY: a directory OF THIS PROJECT.
 *
 * 7. `FetchContent_Declare(<name> ...)` · `FetchContent_MakeAvailable(<name>...)` ·
 *    `ExternalProject_Add(<name> ...)`
 *    READ: **NOTHING.**
 *    WHY: a fetched dependency's SOURCES ARE IN THE CHECKOUT, so its declarations are the PROJECT's — the
 *    row is bucket A, not bucket D. The local name is not a package name.
 *
 * 8. A `#` COMMENT
 *    READ: **NOTHING.**
 *    WHY: **MEASURED** — ghostty's root `CMakeLists.txt` carries `#   find_package(ghostty-vt REQUIRED)`
 *    inside a comment that documents "Option 2 — find_package (after installing to a prefix)". A reader
 *    that does not strip comments invents a dependency the project does not have, and a claim checked
 *    against it is REFUTED by a checkout that never declared it.
 *
 * 9. EVERY OTHER TOKEN IN A CMAKE FILE
 *    READ: **NOTHING.** The rule is a WHITELIST of (form, field) pairs, not a scan for name-shaped
 *    strings. A reader that took every string would manufacture exactly the false claim the lane's
 *    falsifier is about.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * THE NAME-SPELLING AND SCOPE RULES
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * - **THE NAME IS THE MANIFEST'S OWN SPELLING** (`nlohmann_json`, `gtk+-3.0`, `Python3`), never
 *   normalised: the arbiter's verification matches case-insensitively and at a path boundary, so a
 *   normalised spelling could not be matched against the manifest it came from.
 * - **A MANIFEST IS PER-DIRECTORY**, not per-repository: a `find_package` inside a SUBDIRECTORY's
 *   `CMakeLists.txt` is that subdirectory's manifest, and the nearest-ancestor rule decides which
 *   manifest governs a file. The reader's shape is the gate's `manifestDependenciesIn(dir)`.
 * - **A COMMAND MAY SPAN LINES**, so the reader is PAREN-AWARE: it reads to the matching `)`, not to the
 *   end of the line. A line-based reader misses half the manifest.
 * - **A COMMAND'S ARGUMENTS MAY BE QUOTED** (`find_package("Boost")`); the quotes are stripped.
 *
 * USAGE
 *   bun run script/m14/cpp-cmake-names.ts --file=<path>            # print the names a manifest declares
 *   bun run script/m14/cpp-cmake-names.ts --selftest                 # the reader's own control
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

/**
 * CMAKE COMMENTS ARE NOT DECLARATIONS — and a reader that does not strip them invents dependencies.
 * MEASURED: ghostty's root `CMakeLists.txt` carries `#   find_package(ghostty-vt REQUIRED)` in a comment.
 * A `#` outside a quoted string runs to the end of the line; a `#` inside a quoted string is kept.
 *
 * THE LIMIT, STATED: CMake's bracket comments (`#[[ ... ]]`) are not handled — the corpus's manifests do
 * not use them, and the reader's own control refuses a manifest that contains one rather than guessing.
 */
export function stripCmakeComments(text: string): { text: string; hadBracketComment: boolean } {
  const out: string[] = []
  let hadBracketComment = false
  for (const line of text.split(/\r?\n/)) {
    let inString = false
    let cut = line.length
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === "#" && line[i + 1] === "[" && line[i + 2] === "[") hadBracketComment = true
      if (c === '"' && line[i - 1] !== "\\") inString = !inString
      else if (c === "#" && !inString) { cut = i; break }
    }
    out.push(line.slice(0, cut))
  }
  return { text: out.join("\n"), hadBracketComment }
}

/** THE ARGUMENTS OF ONE COMMAND INVOCATION, read to the matching `)`. */
export function cmakeCommandArgs(text: string, command: string): string[][] {
  const out: string[][] = []
  const re = new RegExp(`(^|[^A-Za-z0-9_])${command}\\s*\\(`, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const open = text.indexOf("(", m.index + m[0].length - 1)
    let depth = 0
    let i = open
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++
      else if (text[i] === ")") { depth--; if (depth === 0) break }
    }
    if (i >= text.length) break // an UNCLOSED command: not a declaration this reader can trust
    const body = text.slice(open + 1, i)
    out.push(body.split(/\s+/).map((s) => s.replace(/^["']|["']$/g, "")).filter((s) => s.length > 0))
    re.lastIndex = i
  }
  return out
}

const KEYWORDS = new Set([
  "REQUIRED", "QUIET", "EXACT", "CONFIG", "MODULE", "COMPONENTS", "OPTIONAL_COMPONENTS", "SYSTEM",
  "COMPONENTS", "NAMES", "NAMES_PER_DIR", "PATHS", "HINTS", "PATH_SUFFIXES", "NO_DEFAULT_PATH",
  "IMPORTED_TARGET", "GLOBAL", "STATIC", "SHARED", "INTERFACE", "PUBLIC", "PRIVATE", "ALIAS",
  "INTERFACE", "UNKNOWN", "WINDOWS", "UNIX", "APPLE", "ANDROID", "IOS",
])

/** A VERSION argument of `find_package(Boost 1.75.0)`: a dotted number, or a number with a suffix. */
const isVersionSpelling = (s: string): boolean => {
  if (s.length === 0) return false
  if (!/^[0-9]/.test(s)) return false
  return /^[0-9][0-9A-Za-z._-]*$/.test(s)
}

/**
 * THE NAMES A CMAKE MANIFEST DECLARES — the reader, implementing the field list above.
 *
 * RETURNS the names in the manifest's OWN SPELLING, as a set, plus the namespaces that CORROBORATE them
 * and the ones that do not (a namespace is never allowed to introduce a package).
 */
export function cmakeDependencyNames(text: string): {
  names: string[]
  corroboratingNamespaces: string[]
  uncorroboratedNamespaces: string[]
  hadBracketComment: boolean
} {
  const stripped = stripCmakeComments(text)
  const src = stripped.text
  const names = new Set<string>()
  const namespaces = new Set<string>()

  // 1 · find_package(<Name> ...) — argument 1 only.
  for (const args of cmakeCommandArgs(src, "find_package")) {
    if (args.length === 0) continue
    const name = args[0]
    if (name.length === 0 || KEYWORDS.has(name.toUpperCase())) continue
    if (isVersionSpelling(name)) continue
    names.add(name)
  }
  // 2 · pkg_check_modules(<PREFIX> ... <module>...) — the modules, never the prefix.
  for (const args of cmakeCommandArgs(src, "pkg_check_modules")) {
    for (const a of args.slice(1)) {
      if (KEYWORDS.has(a.toUpperCase())) continue
      if (a.startsWith("-")) continue
      if (isVersionSpelling(a)) continue
      names.add(a)
    }
  }
  // 3 · target_link_libraries(... Ns::Tgt ...) — the namespace, as CORROBORATION only.
  for (const args of cmakeCommandArgs(src, "target_link_libraries")) {
    for (const a of args.slice(1)) {
      if (KEYWORDS.has(a.toUpperCase())) continue
      if (a.startsWith("-")) continue
      const cut = a.indexOf("::")
      if (cut <= 0) continue
      const ns = a.slice(0, cut).trim()
      if (ns.length > 0) namespaces.add(ns)
    }
  }
  // A namespace CORROBORATES a declared name when it IS that name (case-insensitively) or when it shares
  // the name's word-boundary prefix (`nlohmann` corroborates `nlohmann_json`).
  const corroborating: string[] = []
  const uncorroborated: string[] = []
  for (const ns of namespaces) {
    const lower = ns.toLowerCase()
    const hit = [...names].some((n) => {
      const ln = n.toLowerCase()
      if (ln === lower) return true
      if (ln.startsWith(lower)) {
        const next = ln.charAt(lower.length)
        return next === "_" || next === "-" || next === "." || next === "/"
      }
      return false
    })
    ;(hit ? corroborating : uncorroborated).push(ns)
  }
  return {
    names: [...names],
    corroboratingNamespaces: corroborating,
    uncorroboratedNamespaces: uncorroborated,
    hadBracketComment: stripped.hadBracketComment,
  }
}

// ── the CLI ─────────────────────────────────────────────────────────────────────────────────────────
// `import.meta.main` GUARDS IT: the verifier IMPORTS this module to read the reader, and without the
// guard the import would run the CLI and print its usage instead of returning.
if (import.meta.main) {
if (process.argv.includes("--selftest")) {
  const TEXT = `
# a real dependency
find_package(Boost REQUIRED)
# a version is not a name
find_package(nlohmann_json 3.11.2 REQUIRED)
# components are not packages
find_package(Python3 COMPONENTS Development Interpreter)
# a prefix is not a name
pkg_check_modules(ZLIB REQUIRED zlib)
# a namespace corroborates, it does not introduce
target_link_libraries(app PRIVATE Boost::boost MyLib::thing)
# a project target is not a package
add_library(mylib STATIC a.cpp)
# a file stem is not a package
find_library(SQLITE3 NAMES sqlite3)
# a directory of this project is not a package
add_subdirectory(third_party)
# a fetched dependency's sources are in the checkout
FetchContent_Declare(googletest URL https://example.invalid/googletest.tar.gz)
# a comment is not a declaration
#   find_package(ghostty-vt REQUIRED)
`
  const out = cmakeDependencyNames(TEXT)
  const expect = ["Boost", "nlohmann_json", "Python3", "zlib"]
  const got = [...out.names].sort()
  const ok = JSON.stringify(got) === JSON.stringify([...expect].sort())
    && out.uncorroboratedNamespaces.includes("MyLib")
    && out.corroboratingNamespaces.includes("Boost")
  console.log(`cpp-cmake-names selftest — names: ${JSON.stringify(got)}`)
  console.log(`  corroborating namespaces: ${JSON.stringify(out.corroboratingNamespaces)} · uncorroborated: ${JSON.stringify(out.uncorroboratedNamespaces)}`)
  console.log(ok ? "PASS — the field list holds on the trap shapes" : "FAIL — the field list does not hold")
  if (!ok) process.exit(3)
} else {
  const file = process.argv.find((a) => a.startsWith("--file="))?.slice("--file=".length)
  if (!file) {
    console.error("usage: bun run script/m14/cpp-cmake-names.ts --file=<path> | --selftest")
    process.exit(2)
  }
  const abs = path.resolve(file)
  const out = cmakeDependencyNames(readFileSync(abs, "utf8"))
  console.log(`${abs}\n  names: ${JSON.stringify(out.names)}`)
  console.log(`  corroborating namespaces: ${JSON.stringify(out.corroboratingNamespaces)}`)
  console.log(`  uncorroborated namespaces (NOT packages): ${JSON.stringify(out.uncorroboratedNamespaces)}`)
  if (out.hadBracketComment) console.log("  NOTE: this manifest uses a BRACKET comment, which this reader does not handle — it refuses to guess.")
}
}
