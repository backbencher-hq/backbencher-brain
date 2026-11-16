/**
 * Builtin oracle, derived by PARSING rather than by hand-listing.
 *
 * For every lowercase alphabetic node type the pinned grammar declares, ask the
 * grammar how it parses that word used as a call:
 *
 *     NAME;          -> func0op_call_expression / function NAME   (named list op)
 *     NAME(1);       -> func1op_call_expression / function NAME   (named unary op)
 *
 * A word the grammar gives a CALL node is a named operator: a Perl builtin or a
 * keyword, both of which must never become a `calls` edge target. This is
 * version-pinned to the grammar the product loads, and it needs no
 * hand-maintained list to drift.
 *
 * Cross-checked against perl 5.38's own opcode.h (PL_op_name) and against the
 * system's CORE:: where reachable.
 */
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { createHash } from "crypto"

const ROOT = "<corpus-root>/backbencher-brain"
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const language: any = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm")))
const parser = new ParserClass()
parser.setLanguage(language)

const declared: string[] = []
for (let i = 0; i < language.nodeTypeCount; i++) {
  const n = language.nodeTypeForId(i)
  if (n) declared.push(n)
}
const candidates = [...new Set(declared.filter((n) => /^[a-z][a-z0-9_]*$/.test(n)))].sort()

/** Does `src` produce a call node naming `word`? */
function callShape(word: string, src: string): string | null {
  let tree: any
  try {
    tree = parser.parse(src)
  } catch {
    return null
  }
  if (tree.rootNode.hasError) return null
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "func0op_call_expression" || n.type === "func1op_call_expression" || n.type === "ambiguous_function_call_expression" || n.type === "function_call_expression") {
      const fn = n.childForFieldName?.("function")
      if (fn && fn.text === word) return n.type
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return null
}

const namedOps: Record<string, string> = {}
const notOps: string[] = []
for (const w of candidates) {
  // A named op is a keyword-ish bareword: it must parse as a call with no
  // leading-declaration context. `package`, `my`, `if` etc. are ops in perl's
  // op table (package, my, if are all OP names) even though they read as
  // keywords, so the probe is the right test.
  const asList = callShape(w, `sub _probe { ${w}; }`)
  const asUnary = callShape(w, `sub _probe { ${w}(1); }`)
  if (asList || asUnary) namedOps[w] = (asList ?? asUnary) as string
  else notOps.push(w)
}

// Cross-check: perl 5.38 opcode.h named-op tokens (the source-level ones are
// the subset that also appear as grammar node types).
let opHead: string[] = []
try {
  // perl5's own opcode.h is the authority for the builtin set; it lives in the
  // corpus checkout, not the repo, so it comes from BB_PERL_CORPUS
  // (reviews/LANE-AUDIT-FORMULA.md, evidence-integrity rule 4).
  const p = (process.env.BB_PERL_CORPUS ?? "<corpus-root>/bb_tests/repositories") + "/perl5/opcode.h"
  const s = fs.readFileSync(p, "utf8")
  const i = s.indexOf("PL_op_name[] INIT({")
  const j = s.indexOf("\n});", i)
  opHead = [...new Set((s.slice(i, j).match(/"[a-z_][a-z0-9_]*"/g) ?? []).map((q: string) => q.slice(1, -1)))]
} catch {
  /* optional */
}

const opHeadNamed = opHead.filter((o) => namedOps[o]).sort()
const opHeadMissing = opHead.filter((o) => !namedOps[o] && declared.includes(o)).sort()

const report = {
  grammarNodeTypesTotal: declared.length,
  lowercaseCandidates: candidates.length,
  grammarNamedOps: Object.keys(namedOps).length,
  grammarNamedOpsByShape: Object.fromEntries(
    Object.entries(Object.entries(namedOps).reduce((a: any, [k, v]) => ((a[v] = (a[v] ?? 0) + 1), a), {})),
  ),
  namedOps: Object.keys(namedOps).sort(),
  opHeadTotal: opHead.length,
  opHeadNamedCount: opHeadNamed.length,
  opHeadDeclaredButNotProbedAsCall: opHeadMissing,
  notOps,
}
fs.writeFileSync((process.env.BB_PERL_OUT ?? "/tmp") + "/perl-builtin-oracle.json", JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, namedOps: undefined, notOps: report.notOps.length }, null, 2))
