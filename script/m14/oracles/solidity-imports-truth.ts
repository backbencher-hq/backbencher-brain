/**
 * SOLIDITY IMPORTS TRUTH — the lane-owned differential oracle for `imports`, the ONE emitted label
 * that `validation/m60/results/rel-type-coverage.json` recorded as emitted-but-unaudited for this lane
 * (emitted 10, audited 9). The rest of the lane's truth lives in `script/m14/oracles/solidity.ts`
 * (`deriveSolidityEdges` + `deriveSolidityCallReferenceEdges`); this file is separate because the
 * wiring is the Lead's single-writer surface (`differential.ts`) and a separate import line is the
 * smallest change that can be reviewed on its own.
 *
 * WHAT `imports` IS IN THIS LANE (SOL-R6, measured): `import_directive` -> the MODULE SPECIFIER as
 * written, one edge per module, from the FILE-MODULE symbol (SOL-1: the basename WITH its extension —
 * a `.sol` file holds several top-level contracts, so no declaration names the file). The target is a
 * PATH, not a symbol name, by construction of the type; the analyzer's `pathTarget` opt-out exists
 * because the symbol-name guard silently dropped 357 of 358 corpus imports without it.
 *
 * WHAT IT MUST NOT DERIVE (the negative controls, each a construct that LOOKS import-ish):
 *   · a `using Lib for T;` / `using Lib for T global;` — that is a USING DEPENDENCY, published as
 *     `references` (the lane's existing oracle derives it; it is not a module inclusion).
 *   · an imported BINDING (`import {B} from "./B.sol"` -> B; `import * as U from …` -> U;
 *     `import "./C.sol" as C` -> C) — bindings are `references`; the `imports` edge names the PATH.
 *   · a non-literal / computed path — no static module specifier can be derived, and the analyzer
 *     emits nothing for one; deriving it would manufacture a MISSING row.
 *
 * INDEPENDENCE, STATED HONESTLY: this is a second walk over the same pinned parse, keyed on the
 * grammar's own `import_directive` + `string` nodes. Both sides share a grammar bug if there is one
 * (the harness property the workstream doc requires be said, not claimed around). What the comparison
 * DOES catch is a labelling or extraction divergence in the analyzer — the class that matters here.
 *
 * NO REGEX: the quote strip is a character scan, matching the lane's zero-regex contract.
 */

export interface SolidityImportEdge {
  label: "imports"
  from: string
  target: string
}

function stripQuotes(text: string): string {
  let start = 0
  let end = text.length
  while (start < end) {
    const c = text[start]
    if (c === '"' || c === "'") start++
    else break
  }
  while (end > start) {
    const c = text[end - 1]
    if (c === '"' || c === "'") end--
    else break
  }
  return text.slice(start, end)
}

function namedChildren(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/**
 * Derive `imports` truth for ONE file.
 *
 * @param root       the file's parse tree root
 * @param moduleName the file's module symbol: the basename WITH its extension (SOL-1) — the same value
 *                   `differential.ts` passes to the lane's other truth functions.
 */
export function deriveSolidityImportTruth(root: any, moduleName: string): SolidityImportEdge[] {
  const out: SolidityImportEdge[] = []
  const seen = new Set<string>()
  const walk = (n: any): void => {
    if (!n) return
    if (n.type === "import_directive") {
      // The module specifier is the directive's `string` node. Read it structurally (the grammar puts
      // the path in a `string` node whose text INCLUDES the quotes) — never by slicing the directive
      // text, which would carry the keyword and have to be repaired by a second rule.
      let path = ""
      for (const c of namedChildren(n)) {
        if (c.type === "string" || c.type === "string_literal") {
          path = stripQuotes(String(c.text ?? "")).trim()
          break
        }
      }
      // A computed/absent path is not a static module specifier: deriving one would fabricate a row.
      if (!path) return
      if (seen.has(path)) return
      seen.add(path)
      out.push({ label: "imports", from: moduleName, target: path })
      return
    }
    for (const c of namedChildren(n)) walk(c)
  }
  walk(root)
  return out
}

/** The label set this module derives, exported for a lane contract check and for the Lead's wiring
 *  note. Kept as a literal of quoted strings so a pattern reader can see it (the cpp lane's lesson). */
export const SOLIDITY_IMPORT_ORACLE_LABELS: ReadonlyArray<string> = ["imports"]
