/**
 * cpp-cmake-names-verify — THE CONTROL THAT PROVES THE CMAKE READ, IN BOTH DIRECTIONS.
 *
 * WHY IT EXISTS (the Lead's ruling, 2026-10-20): the gate's manifest reader is NOT extended with
 * `CMakeLists.txt` until the lane states exactly WHICH FIELDS OF WHICH CMAKE FORMS are read as names —
 * because a reader that takes every string in a CMake file as a dependency name would manufacture exactly
 * the false claim the lane's falsifier is about. **This is that control**, and the field list it proves is
 * `script/m14/cpp-cmake-names.ts`'s header.
 *
 * THE TWO DIRECTIONS, BOTH PINNED:
 *
 *   THE POSITIVE — every shape the field list NAMES is read: `find_package`'s argument 1 (and a
 *   MULTI-LINE command, and a quoted one), a pkg-config MODULE, and the manifest's OWN SPELLING of each
 *   name. A namespace that matches a declared name is recorded as CORROBORATING it.
 *
 *   THE NEGATIVE — every shape the field list REFUSES is not read: a `find_package` VERSION, a
 *   `COMPONENTS` entry, a `pkg_check_modules` PREFIX, a bare `target_link_libraries` item, a project
 *   TARGET, a `find_library`/`find_path` FILE STEM, an `add_subdirectory` DIRECTORY, a FETCHED
 *   dependency, a COMMENT-ONLY `find_package`, a name-shaped string in any other command, and a namespace
 *   that would INTRODUCE a package.
 *
 * AND THE SCOPE RULES: the reader is PER-DIRECTORY (the nearest-ancestor rule — a file under
 * `nested/` is governed by `nested/CMakeLists.txt`, not by the one above it), a command may span lines, and
 * an UNCLOSED command is refused rather than guessed.
 *
 * USAGE: bun run script/m14/cpp-cmake-names-verify.ts [--text] [--prove-red]   EXIT 0 pass · 3 fail
 */
import { readFileSync, existsSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const FIX = path.join(ROOT, "validation", "m14", "fixtures", "cpp", "cmake-names")
const TEXT = process.argv.includes("--text")

const { cmakeDependencyNames } = await import(path.join(ROOT, "script/m14/cpp-cmake-names.ts"))

const rootText = readFileSync(path.join(FIX, "CMakeLists.txt"), "utf8")
const nestedText = readFileSync(path.join(FIX, "nested", "CMakeLists.txt"), "utf8")
const root = cmakeDependencyNames(rootText)
const nested = cmakeDependencyNames(nestedText)
const rootNames = new Set(root.names)
const nestedNames = new Set(nested.names)

const checks: Array<{ id: string; ok: boolean; detail: string }> = []
const check = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail })

// ── THE POSITIVE ─────────────────────────────────────────────────────────────────────────────────────
for (const n of ["Boost", "nlohmann_json", "Python3", "Quoted", "gtk+-3.0", "glib-2.0", "zlib", "libpcre2-8"]) {
  check(`reads-${n}`, rootNames.has(n), `names=${JSON.stringify(root.names)}`)
}
check("reads-a-multi-line-command", rootNames.has("gtk+-3.0"), "a command that spans lines is read whole")
check("keeps-the-manifests-own-spelling", rootNames.has("gtk+-3.0") && !rootNames.has("gtk+3.0"), "the spelling is never normalised")
check("reads-the-nested-manifests-names", nestedNames.has("OpenSSL") && nestedNames.has("CURL"), JSON.stringify(nested.names))
check("corroborating-namespace-recorded", root.corroboratingNamespaces.includes("Boost") && root.corroboratingNamespaces.includes("zlib"), JSON.stringify(root.corroboratingNamespaces))
check("nested-namespace-corroborates", nested.corroboratingNamespaces.includes("OpenSSL"), JSON.stringify(nested.corroboratingNamespaces))

// ── THE NEGATIVE ─────────────────────────────────────────────────────────────────────────────────────
for (const n of ["3.11.2", "Development", "Interpreter", "ZLIB", "sqlite3", "Python.h", "mylib", "myapp", "third_party", "googletest", "json", "ghostty-vt", "NotAPackage", "Boost2"]) {
  check(`refuses-${n}`, !rootNames.has(n), `names=${JSON.stringify(root.names)}`)
}
// THE WHITELIST PROPERTY, stated as an EXACT SET: the reader reads EXACTLY these eight names from the
// root fixture — the ones the field list NAMES — and not one more. (The individual assertions above say
// which is which; this one says there is nothing ELSE.) A reader that took every string would read
// "NotAPackage", "Boost" a second time, "mylib", "sqlite3" and the rest, and this check would fail.
{
  const expected = ["Boost", "Quoted", "glib-2.0", "gtk+-3.0", "libpcre2-8", "nlohmann_json", "Python3", "zlib"]
  const got = [...rootNames].sort()
  check("reads-exactly-the-names-the-field-list-names", JSON.stringify(got) === JSON.stringify([...expected].sort()), `got=${JSON.stringify(got)}`)
  check("the-fixture-traps-are-all-present", rootText.includes('set(ANOTHER "Boost")') && rootText.includes("#   find_package(ghostty-vt REQUIRED)"), "the fixture's trap shapes are still there — the control is not vacuous")
}
check("a-namespace-never-introduces-a-package", root.uncorroboratedNamespaces.includes("MyLib") && !rootNames.has("MyLib"), JSON.stringify(root.uncorroboratedNamespaces))
check("a-nested-namespace-never-introduces-a-package", !nestedNames.has("SSL"), JSON.stringify(nested.names))

// ── THE SCOPE RULES ──────────────────────────────────────────────────────────────────────────────────
/** THE NEAREST-ANCESTOR WALK — the same rule the gate's manifest reader uses, over the fixture tree. */
function governingManifest(absDir: string): string | null {
  let dir = absDir
  for (;;) {
    const candidate = path.join(dir, "CMakeLists.txt")
    if (existsSync(candidate)) return candidate
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}
{
  const nestedFile = path.join(FIX, "nested", "app.cpp")
  const rootFile = path.join(FIX, "app.cpp")
  const nestedGov = governingManifest(path.dirname(nestedFile))
  const rootGov = governingManifest(path.dirname(rootFile))
  check("nearest-ancestor-picks-the-subdirectory-manifest", nestedGov === path.join(FIX, "nested", "CMakeLists.txt"), String(nestedGov))
  check("nearest-ancestor-picks-the-root-manifest-above", rootGov === path.join(FIX, "CMakeLists.txt"), String(rootGov))
  const nestedRead = cmakeDependencyNames(readFileSync(nestedGov!, "utf8"))
  const rootRead = cmakeDependencyNames(readFileSync(rootGov!, "utf8"))
  check("the-subdirectory-manifest-does-not-leak-up", !nestedRead.names.includes("Boost") && rootRead.names.includes("Boost"), "a subdirectory manifest is per-directory")
}
{
  // AN UNCLOSED COMMAND is refused rather than guessed.
  const broken = cmakeDependencyNames("find_package(Broken\nadd_library(x STATIC a.cpp)\n")
  check("an-unclosed-command-is-refused", !broken.names.includes("Broken"), JSON.stringify(broken.names))
}

// ── RED PROOF: a deliberately impossible expectation makes the instrument exit 3 ─────────────────────────
if (process.argv.includes("--prove-red")) {
  check("prove-red-control-a-refused-name-is-read", rootNames.has("sqlite3"), "deliberately false expectation (the instrument must FAIL here)")
}

const failures = checks.filter((c) => !c.ok)
const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-cmake-names-verify.ts",
  fixture: path.relative(ROOT, FIX),
  fieldList: {
    read: [
      "find_package(<Name>) — argument 1 only",
      "pkg_check_modules(<PREFIX> <module>...) — the MODULES, never the prefix",
      "target_link_libraries(... Ns::Tgt ...) — the NAMESPACE, as CORROBORATION only",
    ],
    refused: [
      "a find_package VERSION argument",
      "a find_package COMPONENTS entry",
      "a bare target_link_libraries item",
      "add_library / add_executable — a PROJECT TARGET",
      "find_library / find_path NAMES — a FILE STEM",
      "add_subdirectory — a DIRECTORY OF THIS PROJECT",
      "FetchContent_Declare / FetchContent_MakeAvailable / ExternalProject_Add — a FETCHED dependency",
      "a # COMMENT",
      "every other token in the file",
    ],
  },
  checks,
  ok: failures.length === 0,
}
if (TEXT) {
  console.log(`cpp-cmake-names-verify — ${checks.length} assertions`)
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.id}${c.ok ? "" : ` — ${c.detail}`}`)
  console.log(failures.length === 0
    ? "PASS — the field list reads the names it names and refuses every other string"
    : `FAIL — ${failures.length} assertion(s) failed`)
} else console.log(JSON.stringify(report, null, 1))
if (failures.length > 0) process.exit(3)
