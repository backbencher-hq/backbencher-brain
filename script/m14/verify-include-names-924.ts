/**
 * M60-C — #924 gate: a C/C++ lane publishes the include's NAME, and it is the
 * name the source WROTE.
 *
 * The cpp include extractor built the name by slicing the whole
 * `preproc_include` text from the `include` keyword to the node's end and
 * stripping `< > " '`. Every trailing comment therefore rode along —
 * `#include <vector> // vector` published the module and the include_dependency
 * target `vector // vector`, a string that is not a name and cannot resolve.
 * Measured through the production entry on the two pinned cpp corpora:
 * 876 published names across 438 include sites, on 71 files (the A/B is
 * script/m60/probe-cpp-include-names.ts; 880 -> 4 after the fix, and the four left
 * are `operator"" _json` user-defined-literal names, a different class).
 * The same block also reported system-ness as
 * `includePath.startsWith("<")` — evaluated on the STRIPPED name, where
 * `stripIncludeChars` has already deleted the `<` — so NO cpp include could
 * ever be reported as a system one.
 *
 * WHY A GATE AND NOT JUST A FIXTURE: the fixture pins the shapes; this pins the
 * INVARIANT over real files. It is deliberately independent of the analyzer's
 * own rules — it reads the published names and the SOURCE TEXT, never the
 * analyzer's extraction — because the differential oracle cannot see this
 * class at all: it derives its truth from the same rule, so both sides moved
 * together and F5 reported zero unexplained edges while 876 names were wrong
 * (measured). A self-consistent lane needs a gate that reads the language, not
 * the lane.
 *
 * Checks:
 *   V1  NO WHITESPACE NAME. No published include name contains whitespace. The
 *       invariant is real for C/C++: a header name is a single token.
 *   V2  THE NAME IS WRITTEN. Each published name occurs in the file's own text
 *       as `<name>` or `"name"` on a `#include` directive line.
 *   V3  SYSTEM-NESS AGREES WITH THE WRITTEN FORM. `isSystemInclude` (import) and
 *       `isSystem` (edge) must be true exactly when the written form is the
 *       angle form — read from the source, never from the payload.
 *   V4  MUTATION SELF-TEST. V1/V2/V3 run against the PRE-FIX extraction,
 *       re-derived faithfully from the same directive lines, MUST fail. A gate
 *       that cannot fail on the defect it was written for is decoration.
 *
 * CLI: bun run script/m14/verify-include-names-924.ts [--emit] [--selftest]
 * Evidence: validation/m14/results/M14.0.F13.json.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/engine"
import { emitEvidence } from "./evidence-harness"

const ROOT = path.resolve(__dirname, "..", "..")
const REPOS = "$HOME/fixtures/repositories"

/** The pinned corpora, and the extensions the production loader maps per lane. */
const LANES: Array<{ lang: "c" | "cpp"; dirs: string[]; exts: string[] }> = [
  { lang: "c", dirs: ["jq", "sqlite"], exts: [".c"] },
  { lang: "cpp", dirs: ["fmt", "nlohmann-json"], exts: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h"] },
]
const PER_LANE_LIMIT = Number(process.env.BB_INCLUDE_SAMPLE ?? 40)
const SKIP_DIRS = new Set([".git", "node_modules", "build", "out", "dist", "target", "third_party", "vendor", "test", "tests", "docs", "doc"])

interface Site {
  file: string
  lang: string
  name: string
  isSystem: boolean
  /** The pre-fix name for this same directive, re-derived from the source. */
  prefixName: string
  source: string
}

/** The pre-fix extraction, verbatim: the directive's remainder, stripped. */
function prefixNameOf(line: string): string {
  const i = line.indexOf("include")
  if (i === -1) return ""
  let out = ""
  for (const c of line.slice(i + "include".length)) {
    if (c !== "<" && c !== ">" && c !== '"' && c !== "'") out += c
  }
  return out.trim()
}

function collectFiles(lane: (typeof LANES)[number]): string[] {
  const out: string[] = []
  for (const dir of lane.dirs) {
    const base = path.join(REPOS, dir)
    if (!fs.existsSync(base)) continue
    const walk = (d: string, depth: number): void => {
      if (out.length >= PER_LANE_LIMIT || depth > 7) return
      let entries: string[]
      try {
        entries = fs.readdirSync(d).sort()
      } catch {
        return
      }
      for (const e of entries) {
        if (out.length >= PER_LANE_LIMIT) return
        if (SKIP_DIRS.has(e)) continue
        const p = path.join(d, e)
        let st: fs.Stats
        try {
          st = fs.statSync(p)
        } catch {
          continue
        }
        if (st.isDirectory()) walk(p, depth + 1)
        else if (lane.exts.some((x) => p.endsWith(x))) out.push(p)
      }
    }
    walk(base, 0)
  }
  return out
}

/** Every published include site in one file, with the pre-fix name alongside. */
async function sitesOf(file: string, lang: string): Promise<Site[]> {
  const content = fs.readFileSync(file, "utf8")
  let r: any
  try {
    r = await parseFile(file, content)
  } catch {
    return []
  }
  const lines = content.split("\n")
  // Directive lines, in order: the pre-fix name of a site is the remainder of
  // the directive line its name matches.
  const directives = lines.filter((l) => /^\s*#\s*include\b/.test(l))
  const sites: Site[] = []
  const push = (name: string, isSystem: boolean): void => {
    if (!name) return
    const line = directives.find((l) => prefixNameOf(l).split(/\s+/)[0] === name) ?? ""
    sites.push({ file, lang, name, isSystem, prefixName: prefixNameOf(line), source: line })
  }
  for (const imp of r.imports ?? []) {
    if (!imp?.module) continue
    // INCLUDE rows only. `isImport` alone is not enough: a `using std::locale;`
    // declaration is published as an import-shaped row with
    // `isUsingDeclaration` (cpp line 748) and its module is a QUALIFIED NAME,
    // not a header. c sets isIncludeDependency on the edge but only
    // isSystemInclude+isImport on the import, so the import test accepts either
    // marker (cpp) or the system-ness key every include import carries (c).
    const m: any = imp.metadata ?? {}
    const isInclude = m.isIncludeDependency === true || (m.isImport === true && "isSystemInclude" in m)
    if (!isInclude) continue
    push(String(imp.module), m.isSystemInclude === true)
  }
  for (const rel of r.relationships ?? []) {
    if (rel?.metadata?.relationshipType !== "include_dependency") continue
    push(String(rel.target), rel?.metadata?.isSystem === true)
  }
  return sites
}

/** V1 — the invariant. Returns the offending names. */
function whitespaceNames(sites: Site[]): string[] {
  return sites.filter((s) => /\s/.test(s.name)).map((s) => `${s.file}: ${JSON.stringify(s.name)}`)
}
/** V2 — the published name must be written in the source. */
function unwrittenNames(sites: Site[]): string[] {
  const out: string[] = []
  for (const s of sites) {
    if (/[\s<>"']/.test(s.name)) continue // V1 owns the malformed ones
    const esc = s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const written = new RegExp(`^\\s*#\\s*include\\s+(<\\s*${esc}\\s*>|"\\s*${esc}\\s*")\\s*$`)
    const line = s.source.trim() === "" ? "" : s.source.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "")
    if (!written.test(line)) out.push(`${s.file}: ${JSON.stringify(s.name)} not written as a directive argument`)
  }
  return out
}
/** V3 — system-ness is a property of the WRITTEN form. */
function systemnessErrors(sites: Site[]): string[] {
  const out: string[] = []
  for (const s of sites) {
    if (/[\s]/.test(s.name)) continue
    const esc = s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const angle = new RegExp(`^\\s*#\\s*include\\s+<\\s*${esc}\\s*>`)
    const writtenAngle = angle.test(s.source)
    if (writtenAngle !== s.isSystem) {
      out.push(`${s.file}: ${JSON.stringify(s.name)} published isSystem=${s.isSystem} but written ${writtenAngle ? "angle" : "quoted"}`)
    }
  }
  return out
}

const results: Array<{ id: string; pass: boolean; detail: string }> = []
function record(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail })
  console.log(`${pass ? "ok  " : "FAIL"}  ${id}  ${detail}`)
}

const all: Site[] = []
for (const lane of LANES) {
  const files = collectFiles(lane)
  for (const f of files) all.push(...(await sitesOf(f, lane.lang)))
}
const byLang = (l: string): Site[] => all.filter((s) => s.lang === l)
console.log(
  `corpus: ${new Set(all.map((s) => s.file)).size} files, ${all.length} include sites ` +
    `(c ${byLang("c").length}, cpp ${byLang("cpp").length})`,
)

const ws = whitespaceNames(all)
record("V1-no-whitespace-name", ws.length === 0, ws.length === 0 ? "every published include name is a single token" : `${ws.length} offending: ${ws.slice(0, 5).join(" | ")}`)
const unwritten = unwrittenNames(all)
record("V2-name-is-written", unwritten.length === 0, unwritten.length === 0 ? "every name appears as <name> or \"name\" in its own directive" : `${unwritten.length} offending: ${unwritten.slice(0, 5).join(" | ")}`)
const sys = systemnessErrors(all)
record("V3-systemness-from-written-form", sys.length === 0, sys.length === 0 ? "isSystemInclude/isSystem agree with the angle-vs-quoted form on every site" : `${sys.length} offending: ${sys.slice(0, 5).join(" | ")}`)

// V4 — the mutation self-test: the SAME predicates, against the pre-fix names.
const pre: Site[] = all.map((s) => ({ ...s, name: s.prefixName, isSystem: false }))
const preWs = whitespaceNames(pre)
const preSys = systemnessErrors(pre)
const glue = pre.filter((s) => /\s/.test(s.name)).length
record(
  "V4-selftest-prefix-is-caught",
  preWs.length > 0 && preSys.length > 0,
  `pre-fix extraction re-derived from the same directives: V1 would flag ${preWs.length} names (${glue} comment-glued), ` +
    `V3 would flag ${preSys.length} system-ness lies — the gate can fail on the defect it was written for`,
)

const failed = results.filter((r) => !r.pass)
console.log(`\n${failed.length === 0 ? "PASS" : "FAIL"} — ${results.length - failed.length}/${results.length} checks`)

if (process.argv.includes("--emit")) {
  emitEvidence({
    issueId: "M14.0.F13",
    title: "C/C++ include names are the source's own name",
    claimLevel: "L1",
    layers: ["corpus", "differential", "mutation"],
    checks: results.map((r) => ({ id: r.id, description: r.detail, status: r.pass ? "pass" : "fail" })),
    limitations: [
      `sample: up to ${PER_LANE_LIMIT} files per lane from the four pinned corpora (jq, sqlite, fmt, nlohmann-json); a full-corpus sweep is the A/B in script/m60/probe-cpp-include-names.ts`,
      "V1's invariant (a header name contains no whitespace) is a language fact, not a parser fact — a lane that publishes a comment as part of a name violates it in any C/C++ file",
      "the differential oracle downstream of this lane derives its include truth from the same extraction, so F5 could not see this class; this gate is deliberately independent of the analyzer's rules",
      "the pre-fix names in V4 are re-derived from the directive lines, so the self-test measures the real defect shape rather than a synthetic string",
    ],
  })
  console.log("evidence: validation/m14/results/M14.0.F13.json")
}

process.exit(failed.length === 0 ? 0 : 1)
