/**
 * dart-binding-resolution-identity — THE "NO SILENT LOSS" INVARIANT FROM THE OTHER SIDE.
 *
 * ## THE QUESTION
 *
 * The Lead's second condition on the dedup fix: *"the arbiter must still resolve each read to the
 * SAME declaration. If two reads of one declaration now produce two rows that resolve to DIFFERENT
 * declarations, the fix has moved a loss rather than removed it."*
 *
 * The fix gives the dedup key the **DECLARATION's identity** (`metadata.localBindingScope`) rather
 * than the read's line, so:
 *
 *   * two reads of TWO DIFFERENT declarations that share a name → **two rows** (the shadowed read
 *     was being MERGED, a resolution loss — now recovered);
 *   * two reads of the SAME declaration → **one row** (the family's payload-pollution dedup, which
 *     must keep working).
 *
 * So the ROW COUNT is not the invariant — the **RESOLUTION IDENTITY** is. Two rows of the same
 * local must resolve to the same declaration, and a recovered shadowed read must resolve to the
 * shadowing declaration and NOT to the outer one.
 *
 * ## WHAT IT MEASURES, AND HOW
 *
 * It runs the analyzer over a fixture and then asks, for every local-binding row, the question the
 * arbiter would answer: **which declaration does this row bind to?** Three independent checks:
 *
 *   1. **THE EXPECTED SET.** Each fixture declares which declaration(s) its rows must bind to, and
 *      the instrument asserts the exact SET — no more, no fewer. A row that binds a declaration of
 *      the same name in the WRONG place is caught, and not merely "a row that binds to something".
 *
 *   2. **THE LEXICAL SCOPE, computed INDEPENDENTLY.** The instrument walks the fixture's SOURCE
 *      TEXT with its own scope rule — the innermost enclosing block that declares the name before
 *      the read's line, and a block's OWN declaration only — and asserts that each row binds
 *      exactly THAT declaration. The walk is written against the text, not against the analyzer's
 *      output, so the two can disagree, and a disagreement is the failure this check exists for.
 *
 *   3. **THE ARBITER'S OWN VERDICT.** `verifyBindingClaim` is IMPORTED from
 *      `script/m14/incoming-rule.ts` — the arbiter's own function, not a copy — and every
 *      local-binding row must read `bindingVerified` under it.
 *
 * ## WHY THE CHECK IS NOT VACUOUS
 *
 * Both failure shapes are MEASURED, by breaking the analyzer and re-running:
 *   * the scope removed from the dedup key → the shadowed read is MERGED and the check fails;
 *   * the scope naming a declaration of a DIFFERENT name → the rows still resolve, but to the
 *     WRONG declaration, and the lexical check fails.
 */
import * as path from "node:path"
import { readFileSync } from "node:fs"
import { getParser } from "../../src/ast/engine"
import { RealDartAnalyzer } from "../../src/ast/real-dart-analyzer"
import { verifyBindingClaim } from "./incoming-rule"
import { BINDING_SEP } from "../../src/ast/types"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")

/** ONE FIXTURE, and the declarations its rows must bind to. The line numbers are the FIXTURE's
 *  own, so the expectation is about the SOURCE and not about the analyzer's output. */
const FIXTURES: {
  id: string
  file: string
  expect: { source: string; rows: number; binds: number[] }[]
}[] = [
  {
    id: "dart/local-read-same-declaration",
    file: "local-read-same-declaration/local_read_same_declaration.dart",
    // The SAME local read twice: ONE row, and it binds the declaration at line 27.
    expect: [
      { source: "f", rows: 1, binds: [27] },
      { source: "g", rows: 1, binds: [35] },
    ],
  },
  {
    id: "dart/local-shadow-scope",
    file: "local-shadow-scope/local_shadow_scope.dart",
    // TWO declarations sharing a name: the outer read binds 35, the INNER read binds 38. The
    // third method's declaration (58) is a SAME-NAMED declaration in a DIFFERENT scope, so a
    // row that bound to it would resolve and still be WRONG.
    expect: [
      { source: "f", rows: 2, binds: [35, 38] },
      { source: "g", rows: 1, binds: [47] },
      { source: "h", rows: 1, binds: [58] },
    ],
  },
]

/** THE SOURCE'S OWN SCOPE WALK — the instrument's independent answer to "which declaration is in
 *  scope at this line". A block is a line range; a declaration belongs to the block whose body
 *  holds it; a nested block's declaration is NOT the outer block's. */
function scopeModel(content: string): {
  lineAt: (byteOffset: number) => number
  inScopeAt: (line: number, name: string) => number | null
} {
  const sourceLines = content.split("\n")
  const lineAt = (byteOffset: number): number => {
    let line = 1
    for (let i = 0; i < byteOffset && i < content.length; i++) if (content.charCodeAt(i) === 10) line++
    return line
  }
  type Block = { start: number; end: number; decl: string | null; declLine: number }
  const blocks: Block[] = []
  {
    const stack: Block[] = []
    for (let i = 0; i < sourceLines.length; i++) {
      const l = sourceLines[i]
      const code = l.replace(/\/\/.*$/, "")
      const dm = /^\s*(?:final|var|const|late\s+\w+)\s+(\w+)\s*=/.exec(l)
      if (/\{/.test(code)) {
        const b: Block = { start: i + 1, end: i + 1, decl: dm ? dm[1] : null, declLine: dm ? i + 1 : 0 }
        blocks.push(b)
        stack.push(b)
      } else if (stack.length > 0 && dm) {
        const top = stack[stack.length - 1]
        top.decl = dm[1]
        top.declLine = i + 1
      }
      if (/\}/.test(code) && stack.length > 0) {
        const b = stack.pop()!
        b.end = i + 1
      }
      for (const b of stack) b.end = i + 1
    }
  }
  // THE INNERMOST enclosing block that declares the name BEFORE the line. A block's declaration
  // is its OWN, and a nested block's declaration belongs to the nested block.
  const inScopeAt = (line: number, name: string): number | null => {
    const candidates = blocks.filter((b) =>
      b.decl === name && b.declLine > 0 && b.declLine < line && b.start <= line && line <= b.end)
    if (candidates.length === 0) return null
    candidates.sort((a, b) => b.start - a.start)
    return candidates[0].declLine
  }
  return { lineAt, inScopeAt }
}

const parser = await getParser("dart")
let failures = 0
const fail = (m: string): void => { failures++; console.error(`FAIL ${m}`) }
const ok = (m: string): void => console.log(`  ok  ${m}`)

for (const fx of FIXTURES) {
  const abs = path.join(ROOT, "validation", "m14", "fixtures", "dart", fx.file)
  const content = readFileSync(abs, "utf8")
  const tree = parser.parse(content)
  if (!tree?.rootNode) { fail(`${fx.id}: the fixture did not parse`); continue }
  const analyzer = new RealDartAnalyzer()
  const result: any = await analyzer.analyze(tree.rootNode, content, fx.file)
  const { lineAt, inScopeAt } = scopeModel(content)

  // EVERY LOCAL-BINDING ROW, with the scope identity the fix gives it.
  const rows = (result?.relationships ?? []).filter((r: any) => {
    const md = (r?.metadata ?? {}) as Record<string, unknown>
    return md.localBinding === true && md.localBindingScope !== undefined
  })

  console.log(`\n== ${fx.id}`)

  for (const want of fx.expect) {
    const mine = rows.filter((r: any) => String(r.source) === want.source)
    if (mine.length !== want.rows) {
      fail(`${want.source}: ${want.rows} row(s) expected, got ${mine.length}`)
      continue
    }
    ok(`${want.source}: ${want.rows} row(s), as expected`)

    // CHECK 1 — THE EXPECTED SET OF BOUND DECLARATIONS.
    const bound = new Set<number>()
    for (const r of mine) {
      const scope = String((r.metadata as any).localBindingScope)
      bound.add(lineAt(Number(scope.split(":")[1])))
    }
    const got = [...bound].sort((a, b) => a - b)
    const expect = [...want.binds].sort((a, b) => a - b)
    if (JSON.stringify(got) !== JSON.stringify(expect)) {
      fail(`${want.source}: the rows bind declaration(s) at line(s) ${got.join(",")} — expected ${expect.join(",")}. ` +
        `A row bound to the WRONG declaration is a loss MOVED rather than removed.`)
    } else {
      ok(`${want.source}: every row binds the expected declaration(s) at line(s) ${expect.join(",")} — ` +
        `the scope separates the ROWS without changing what any row BINDS`)
    }

    // CHECK 2 — THE LEXICAL SCOPE, computed independently from the SOURCE TEXT.
    for (const r of mine) {
      const scope = String((r.metadata as any).localBindingScope)
      const declLine = lineAt(Number(scope.split(":")[1]))
      // THE NAME, and the type says why it cannot be undefined: a binding target is
      // `<callable>` + BINDING_SEP + `<name>`, so the name after the LAST separator is
      // always there — but `split().pop()` is typed `string | undefined`, and a name
      // that is not there is a REAL failure of this check, not an empty string to
      // carry on with. So it is read as a definite string, and the emptiness is
      // checked rather than assumed away.
      const name = String(r.target).split(BINDING_SEP).pop() ?? ""
      if (name.length === 0) {
        fail(`${want.source} at line ${r.line_number}: the target ${JSON.stringify(String(r.target))} carries no binding name after its separator`)
        continue
      }
      const inScope = inScopeAt(Number(r.line_number), name)
      if (inScope === null) {
        fail(`${want.source} at line ${r.line_number}: no declaration of '${name}' is in scope there, ` +
          `but the row binds the one at line ${declLine}`)
      } else if (inScope !== declLine) {
        fail(`${want.source} at line ${r.line_number}: the row binds the declaration at line ${declLine}, ` +
          `but the declaration IN SCOPE there is at line ${inScope} — A LOSS MOVED RATHER THAN REMOVED`)
      }
    }

    // CHECK 3 — THE ARBITER'S OWN VERDICT, from the arbiter's own function.
    for (const r of mine) {
      const outcome = verifyBindingClaim(String(r.target))
      if (outcome !== "bindingVerified") {
        fail(`${want.source}: the arbiter's own verifyBindingClaim read ${outcome} for ${JSON.stringify(r.target)}`)
      }
    }
  }
  if (rows.length > 0) ok("the arbiter's own verifyBindingClaim read bindingVerified on every local-binding row")
}

console.log(failures === 0
  ? "\nPASS — the resolution identity holds on every row: two reads of ONE declaration resolve to the SAME declaration, and a shadowed read resolves to ITS OWN declaration"
  : `\nFAIL — ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 3)
