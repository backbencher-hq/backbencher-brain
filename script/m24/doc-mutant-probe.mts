// PROBE for the hover-docs mutant harness. NOT a gate — this is the oracle a
// mutant is asked to fool.
//
// It runs the REAL parser (parseForSafety) against a REAL fixture file and the
// REAL attachment rule (doc_commentFor), then answers one question per mutant id.
// The harness plants a defect in src/lsp/doc_comment.ts, runs this probe, and
// requires the probe to notice.
//
// Why the real parser and a real file rather than a hand-built commentSites
// array: a mutant suite that hands the code a synthetic input proves the code
// handles the synthetic input. This suite exists to prove the gate catches
// defects in the real path, so the input has to come from the real path.
import { parseForSafety } from "../../src/ast/safety-primitives.ts"
import { docCommentFor } from "../../src/lsp/doc_comment.ts"
import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const dir = "/private/var/folders/4j/11tssyqj4kj0f8dfz06jsb700000gn/T/opencode/doc-mutant"
mkdirSync(dir, { recursive: true })
const file = path.join(dir, "shapes.ts")

// documented at line 5 (comment ends line 4). `Unrelated` at line 13 is
// deliberately NOT adjacent to any comment: `separator` sits at line 11.
writeFileSync(
  file,
  [
    "/**",
    " * Documented: doubles a number.",
    " * Second line of the doc.",
    " */",
    "export function documented(n: number): number {",
    "  return n * 2",
    "}",
    "",
    "/**",
    " * Borrowed comment; must never attach to the declaration below it.",
    " */",
    "const separator = 1",
    "",
    "export interface Unrelated { a: number }",
    "",
  ].join("\n"),
)

const parsed = await parseForSafety(file, (await import("node:fs")).readFileSync(file, "utf8"))
const sites = parsed.commentSites

const answer = {
  // multi-line prose must survive whole
  full: docCommentFor(sites, 5),
  // a declaration with NO adjacent comment must get nothing
  far: docCommentFor(sites, 13),
}

const id = process.argv[2] ?? ""
let noticed = false
let why = ""
switch (id) {
  case "adjacency":
    // Defect: the attachment rule ignores adjacency and takes the nearest
    // comment above instead. Oracle: the borrowed comment leaks onto Unrelated.
    noticed = /Borrowed comment/.test(answer.far)
    why = `far-decl doc=${JSON.stringify(answer.far.slice(0, 46))}`
    break
  case "truncate":
    // Defect: only the first line of the doc is kept. Oracle: the second line
    // is gone.
    noticed = !/Second line/.test(answer.full)
    why = `full doc=${JSON.stringify(answer.full.slice(0, 60))}`
    break
  case "invent":
    // Defect: an absent doc is filled in with a placeholder. Oracle: something
    // non-empty comes back for a declaration with no comment.
    noticed = answer.far.trim().length > 0 && !/Borrowed comment/.test(answer.far)
    why = `far-decl doc=${JSON.stringify(answer.far.slice(0, 60))}`
    break
  case "markup":
    // Defect: the comment delimiters/asterisks are not stripped. Oracle: raw
    // markup survives in the answer — any of the opening delimiter, the closing
    // delimiter, or a continuation asterisk at the start of a line.
    //
    // The first version of this oracle only looked for /* and */, so the mutant
    // planted its defect correctly (leaving "* Documented: ...") and the probe
    // still reported nothing. A too-narrow oracle is the same failure as a gate
    // that cannot fail: it returns "fine" while the defect is on screen.
    noticed = /\/\*|\*\/|^\s*\*/m.test(answer.full)
    why = `full doc=${JSON.stringify(answer.full.slice(0, 60))}`
    break
  default:
    noticed = false
    why = "unknown mutant id"
}
process.stdout.write(JSON.stringify({ noticed, why }) + "\n")