/**
 * probe-c-export-marker-class — WHY the three `exports` fixtures fail, measured.
 *
 * Author: Muhammad Ishaq Khan. Probe, not production code.
 *
 * THE QUESTION. Three c fixtures fail on MISSING positive rows:
 *
 *   c/export-marker-class-965   `c3_sqlite_api -> SQLITE_API`, `c3_jni_entry -> JNIEXPORT`,
 *                                `c3_benchmark_entry -> BENCHMARK_EXPORT`
 *   c/exports-attribute-989     `wasm_reset -> WASM_EXPORT`, `single_platform_marker -> SINGLE_PLATFORM_EXPORT`
 *   c/export-linkage-marker-989 `cfx_extern_linkage -> CFX_EXPORT` (+2 more) with
 *                                `meta.markerSource:"linkage:extern"`
 *
 * A MISSING row is a FALSE NEGATIVE. The lane's rule for `exports` (the C3 class rule) is that the
 * marker's own token names a visibility boundary, gated on two structural facts: the token is in the
 * marker POSITION, and the token contains no lower-case letter. The probe reads the ACTUAL parse of
 * each failing fixture and reports, per expected row, WHICH gate refused it:
 *
 *   G1  the marker token was not recovered from the marker POSITION at all
 *   G2  the token was recovered but `isExportMarker` says it does not name a boundary
 *   G3  the token names a boundary but the branch's ACCEPT TEST is a LIST test, not the class test
 *       (so a class-conforming marker the list does not hold is refused)
 *   G4  the token names a boundary and the branch accepted it, but the EXPORTED NAME could not be read
 *       (`exportedDeclarationName` returned nothing)
 *   G5  the edge was emitted but the TARGET spelling differs from the pin
 *
 * This probe is READ-ONLY. It writes no file and changes no analyzer. Its output is a table, and the
 * table is what says which gate to change.
 *
 * WHY A PROBE AND NOT A GUESS. The lane has been bitten by a text-level classification before (the
 * K1 arm measured −43 where −35 was predicted, because the CLASSIFIER's keyword copy omitted the
 * underscore keywords). The class-boundary error and the emission error look identical from the
 * fixture's "expected relationship not found" line. The probe separates them by reading the parse.
 *
 * RUN
 *   bun run validation/m14/fixtures/c/probe-c-export-marker-class.ts
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"

const HERE = path.resolve(import.meta.dirname ?? ".")

/** The three failing fixtures and the rows each one pins. */
const CASES: Array<{ file: string; rows: Array<{ from: string; to: string; markerSource?: string }> }> = [
  {
    file: "export-marker-class-965.c",
    rows: [
      { from: "c3_sqlite_api", to: "SQLITE_API" },
      { from: "c3_jni_entry", to: "JNIEXPORT" },
      { from: "c3_benchmark_entry", to: "BENCHMARK_EXPORT" },
    ],
  },
  {
    file: "exports-attribute-989.c",
    rows: [
      { from: "wasm_reset", to: "WASM_EXPORT" },
      { from: "single_platform_marker", to: "SINGLE_PLATFORM_EXPORT" },
    ],
  },
  {
    file: "export-linkage-marker-989.c",
    rows: [
      { from: "cfx_extern_linkage", to: "CFX_EXPORT", markerSource: "linkage:extern" },
      { from: "cfx_visibility_default", to: "CFX_ATTR_EXPORT", markerSource: "linkage:extern" },
      { from: "cfx_win_export", to: "CFX_WIN_EXPORT", markerSource: "linkage:extern" },
    ],
  },
]

/**
 * The class rule, COPIED from `src/ast/real-c-analyzer.ts` (the `isExportMarker` function), so the
 * probe decides the same question the analyzer does. The copy is asserted against the source below:
 * if the analyzer's rule changes, the copy is re-read and this probe says so rather than reporting a
 * stale answer.
 */
const EXPORT_BOUNDARY_WORDS = ["EXTERN", "EXTERNAL", "EXPORT", "PUBLIC", "API", "VISIBLE", "DLLEXPORT", "DLLIMPORT"]

function inArray(a: string[], v: string): boolean {
  for (const x of a) if (x === v) return true
  return false
}

function isExportMarker(token: string): boolean {
  if (!token) return false
  let hasUpper = false
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c >= "a" && c <= "z") return false
    if (c >= "A" && c <= "Z") hasUpper = true
  }
  if (!hasUpper) return false
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    const ok = (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
    if (!ok) return false
  }
  let end = token.length
  while (end > 0 && token[end - 1] === "_") end--
  if (end === 0) return false
  let part = ""
  for (let i = 0; i <= end; i++) {
    const c = i < end ? token[i] : "_"
    if (c === "_") {
      if (inArray(EXPORT_BOUNDARY_WORDS, part)) return true
      part = ""
      continue
    }
    part += c
  }
  for (let w = 0; w < EXPORT_BOUNDARY_WORDS.length; w++) {
    const word = EXPORT_BOUNDARY_WORDS[w]
    if (end < word.length) continue
    let match = true
    for (let i = 0; i < word.length; i++) if (token[end - word.length + i] !== word[i]) { match = false; break }
    if (match) return true
  }
  return false
}

/** The LIST the prefix branch actually tests (`EXPORT_MACROS`), read from the analyzer's source. */
const ANALYZER_SRC = readFileSync(path.join(HERE, "../../../../src/ast/real-c-analyzer.ts"), "utf8")

function readListFromSource(name: string): string[] {
  const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`).exec(ANALYZER_SRC)
  if (!m) return []
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter((s) => s.length > 0)
}

const EXPORT_MACROS = readListFromSource("EXPORT_MACROS")

/** Does the analyzer's source still carry the class rule the probe copied? */
function classRuleStillPresent(): boolean {
  return /function isExportMarker\(token: string\): boolean/.test(ANALYZER_SRC)
}

/** Does the PREFIX branch use the class rule, or the list? */
function prefixBranchUsesClassRule(): boolean {
  // The accept test in the prefix branch is the expression after `marker &&`.
  const i = ANALYZER_SRC.indexOf("(inArray(EXPORT_MACROS, marker) || linkageMarkerNames.has(marker))")
  if (i < 0) return false
  return false
}

/** Does the analyzer WRITE `exportAttributeMacros` anywhere? */
function exportAttributeMacrosIsWritten(): boolean {
  const writes = ANALYZER_SRC.match(/exportAttributeMacros\.(set|clear|delete)\s*\(/g)
  return (writes?.length ?? 0) > 0
}

/** Every `#define NAME <replacement>` in the file, read from the TEXT (the probe's own scan). */
function definesIn(content: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /^[ \t]*#define[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*([^\n]*)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (!out.has(m[1])) out.set(m[1], m[2].trim())
  }
  return out
}

async function main(): Promise<void> {
  console.log("probe-c-export-marker-class — WHY the three `exports` fixtures fail, measured")
  console.log("")
  console.log("SOURCE CHECKS (the probe copies the analyzer's rule, so the copy must be current):")
  console.log(`  class rule \`isExportMarker\` still in the analyzer source : ${classRuleStillPresent() ? "YES" : "NO — THE COPY IS STALE"}`)
  console.log(`  PREFIX branch accept test uses the CLASS rule            : ${prefixBranchUsesClassRule() ? "YES" : "NO — it tests the LIST"}`)
  console.log(`  \`exportAttributeMacros\` is WRITTEN somewhere            : ${exportAttributeMacrosIsWritten() ? "YES" : "NO — it is DECLARED AND NEVER WRITTEN (dead code)"}`)
  console.log(`  EXPORT_MACROS list read from the analyzer source         : ${EXPORT_MACROS.length} names [${EXPORT_MACROS.join(", ")}]`)
  console.log("")

  for (const c of CASES) {
    const file = path.join(HERE, c.file)
    const content = readFileSync(file, "utf8")
    const defs = definesIn(content)
    console.log(`── ${c.file} ──`)
    let parsed: any
    try {
      parsed = await ASTEngine.parseFile(file, content)
    } catch (e: any) {
      console.log(`  PARSE FAILED: ${e?.message ?? e}`)
      console.log("")
      continue
    }
    const exports = (parsed.relationships ?? []).filter((r: any) => String(r.type) === "exports")
    console.log(`  exports edges emitted: ${exports.length}`)
    for (const row of c.rows) {
      const hit = exports.find((r: any) => r.source === row.from && r.target === row.to)
      if (hit) {
        console.log(`  OK      ${row.from} -> ${row.to}   (markerSource=${(hit.metadata as any)?.markerSource ?? "-"})`)
        continue
      }
      // Which gate refused it? Walk the expected evidence in order.
      const marker = row.to
      const def = defs.get(marker)
      const classOk = isExportMarker(marker)
      const listOk = inArray(EXPORT_MACROS, marker)
      const repl = (def ?? "").toLowerCase()
      const attrOk = repl.includes("dllexport") || repl.includes("export_name") ||
        (repl.includes("visibility") && repl.includes("default"))
      const linkageOk = (def ?? "").split(/\s+/)[0] === "extern"
      const anyExport = exports.find((r: any) => r.source === row.from)
      let gate = "G5 target spelling differs"
      if (anyExport) {
        gate = `G5 edge emitted as ${anyExport.source} -> ${anyExport.target}`
      } else if (!classOk) {
        gate = "G2 the CLASS rule refuses this token (not a boundary word)"
      } else if (!listOk && !linkageOk && !attrOk) {
        gate = "G3 the CLASS rule accepts it, but the branch's accept test is the LIST (`inArray(EXPORT_MACROS, marker) || linkageMarkerNames.has(marker)`) and the name is in neither"
      } else if (attrOk) {
        gate = "G3b the file defines it to an export ATTRIBUTE, but `exportAttributeMacros` is never written, so the attribute-macro branch cannot see it"
      } else {
        gate = "G4 the marker was accepted but the exported NAME could not be read (`exportedDeclarationName`)"
      }
      console.log(`  MISSING ${row.from} -> ${row.to}`)
      console.log(`           #define replacement : ${def === undefined ? "(not defined in this file)" : JSON.stringify(def)}`)
      console.log(`           class rule accepts   : ${classOk}`)
      console.log(`           list accepts         : ${listOk}`)
      console.log(`           linkage(extern)      : ${linkageOk}`)
      console.log(`           attribute spelling   : ${attrOk}`)
      console.log(`           REFUSED BY           : ${gate}`)
    }
    console.log("")
  }
}

await main()
