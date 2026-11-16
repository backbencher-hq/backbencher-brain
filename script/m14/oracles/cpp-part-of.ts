/**
 * The C++ `part_of` oracle — LANE-OWNED, and written to be wired by the Lead.
 *
 * ## Why this file exists
 *
 * `part_of` is the canonical label for C++'s textual-inclusion directive: a QUOTED
 * `#include "x.h"` makes the including translation unit and the included header ONE unit — the
 * part shares the unit's single scope, imports nothing, and cannot be resolved as a separate
 * module, which is the contract's own test for `part_of` (`src/ast/types.ts:148-160`). An ANGLE
 * `#include <x.h>` names ANOTHER module's header and stays `imports`.
 *
 * The analyzer emits the rows. The differential compares labels that have a TRUTH — and admitting
 * a label with no truth charges every analyzer row as a fabrication. C++ was the **only** lane
 * with a `part_of` emission and no `part_of` truth: dart, php, erlang, julia and rust each have a
 * lane-owned oracle, cpp had none. `validation/m60/results/rel-type-coverage.json` recorded cpp's
 * single DERIVATION finding for exactly this, and two defects in the emission survived because
 * nothing independently checked it:
 *
 *   1. the dedup guard keyed on the written PATH while the row emitted the file STEM, so two quoted
 *      includes sharing a stem published the same (source,target) row twice — 5 duplicate rows
 *      measured over a two-repo corpus, invisible to every fixture;
 *   2. `classifyEvidenceTier` had no `part_of` arm, so all 365 rows carried `usage_contextual` while
 *      the documentation claimed `structural`.
 *
 * Both are fixed now. This file is the instrument that would have caught them, and it is written so
 * the Lead can push it in `differential.ts`'s cpp arm next to `deriveCppUnadmittedTruth` and admit
 * `part_of` to cpp's compared set in the same commit.
 *
 * ## What "independent" means here, and what it does not
 *
 * It does not import `RealCppAnalyzer`, read its tables, or call its helpers — not `cppPartSymbol`,
 * not `isCppSpelledName`, not `stripIncludeChars`. It walks the parse tree with its own recursion,
 * reads the directive's own path node with its own reader, and derives the stem with its own
 * character scan. The LANGUAGE rules are of course the same rules — a quoted include names a
 * fragment, an angle include names another module — but they are stated here from C++ and checked
 * against the analyzer by a caller, not shared with it. Its stem rule is DELIBERATELY not a copy of
 * the analyzer's `cppPartSymbol`: it takes the last path segment, strips a trailing extension, and
 * trims, which is the same answer, so a disagreement would surface rather than cancel out (#916).
 *
 * ## The rules, and why each refusal is a first-class result
 *
 *   QUOTED  `#include "x.h"`  -> `part_of`, source = the file-scope sentinel `global` (the analyzer's
 *   own convention for a directive, which belongs to no symbol), target = the file STEM.
 *
 *   ANGLE   `#include <x.h>`  -> `imports`, never `part_of`. Emitted here as `imports` so the
 *   caller can diff BOTH labels from one walk; a caller that only wants `part_of` filters on
 *   `label`.
 *
 *   The STEM, not the path and not the specifier: the arbiter resolves TARGET STRINGS against
 *   SYMBOL NAMES and has no space for a path. Measured in this lane before the rule landed: a path
 *   target resolved **0 of 4,612** rows; the symbol target resolved **383 of the same 4,612**.
 *
 *   `global` is the SOURCE sentinel and is NOT a declaration. A `part_of` row whose target is also
 *   `global` is therefore a collision with the sentinel, and this oracle REFUSES it (no row) so a
 *   disagreement is visible rather than absorbed.
 *
 *   A quoted include the grammar did NOT parse as `preproc_include` (a macro-composed argument, or
 *   an `#include` inside a recovery region) yields NO row here: the analyzer cannot read it either,
 *   and a truth row the analyzer cannot produce would charge it as missing.
 *
 *   The dedup is **per (label, target)**, which is the contract: two quoted includes sharing a stem
 *   express ONE containment fact, and the row is emitted once. This is the rule the analyzer's own
 *   guard now implements, and it is the half that defect (1) got wrong.
 *
 * ## Usage (the shape the Lead wires)
 *
 *   for (const e of deriveCppPartOfTruth(root)) truth.push({ label: e.label, from: e.from, target: e.target })
 *
 * The walk is over the parse tree only: no filesystem, no project root, no package map. C++'s
 * include resolution is the compiler's, not the analyzer's, so there is nothing to resolve — the
 * directive's own text IS the fact.
 */

export interface CppPartOfTruthEdge {
  label: "part_of" | "imports"
  from: string
  target: string
}

/** The file-scope sentinel the analyzer uses for a directive (it belongs to no symbol). */
const FILE_SCOPE = "global"

/** Strip the surrounding quote/bracket characters from a directive's raw path token, so
 *  `"x.h"`, `<x.h>`, `<sys/types.h>` all read as a bare specifier. Pure scan, no regex. */
function bareSpecifier(raw: string): string {
  let t = String(raw ?? "").trim()
  if (t.length >= 2) {
    const first = t[0]
    const last = t[t.length - 1]
    if ((first === '"' && last === '"') || (first === "<" && last === ">")) t = t.slice(1, -1)
  }
  return t.trim()
}

/**
 * The TARGET a quoted include publishes: the file STEM — the last path segment with its final
 * extension removed, trimmed. Stated here from the contract ("the part's module symbol", its file
 * stem, without directories and without the extension) rather than copied from the analyzer.
 */
function stemOf(specifier: string): string {
  const slash = specifier.lastIndexOf("/")
  const base = slash >= 0 ? specifier.slice(slash + 1) : specifier
  const dot = base.lastIndexOf(".")
  return (dot > 0 ? base.slice(0, dot) : base).trim()
}

/**
 * Derive this file's `part_of` (and `imports`) truth rows.
 *
 * The recursion covers the whole tree rather than only the top level: an `#include` inside a
 * recovery region or an `extern "C"` block is still a directive the analyzer reads when the
 * grammar produces a `preproc_include` node for it, and a truth walk that refused it would make
 * the analyzer's row look fabricated.
 */
export function deriveCppPartOfTruth(root: any): CppPartOfTruthEdge[] {
  const out: CppPartOfTruthEdge[] = []
  const seen = new Set<string>()
  const visit = (node: any): void => {
    if (!node) return
    if (node.type === "preproc_include") {
      // The path comes from the directive's own `path` FIELD, never from a slice of the whole
      // directive: a trailing comment (`#include <vector> // vector`) would otherwise ride along,
      // which is the defect that published the module name `vector // vector` (876 sites measured).
      const pathNode = node.childForFieldName?.("path") ?? null
      const raw = String(pathNode?.text ?? "")
      const spec = bareSpecifier(raw)
      // A macro-composed argument (`#include HEADER`) parses as a call_expression under the same
      // field and is not a readable header name — no row.
      const isQuoted = raw.startsWith('"')
      const isAngle = raw.startsWith("<")
      if (spec.length > 0 && (isQuoted || isAngle) && pathNode !== null) {
        const target = isQuoted ? stemOf(spec) : spec
        // THE SENTINEL COLLISION GUARD: a target spelled `global` is the file-scope SOURCE sentinel,
        // and a row naming it would be indistinguishable from the sentinel to a consumer. `global` is
        // a legal C++ identifier (std::locale::global is a real function), so this refuses a row
        // rather than asserting a fact the vocabulary cannot carry.
        if (target.length > 0 && target !== FILE_SCOPE) {
          const label: "part_of" | "imports" = isQuoted ? "part_of" : "imports"
          const key = `${label}\u0000${target}`
          if (!seen.has(key)) {
            seen.add(key)
            out.push({ label, from: FILE_SCOPE, target })
          }
        }
      }
    }
    for (const c of node.namedChildren ?? []) visit(c)
  }
  visit(root)
  return out
}
