/**
 * ORACLE-INDEPENDENCE GATE (php) — a rule both sides call is a rule with one
 * implementation.
 *
 * THE PROBLEM THIS EXISTS TO STOP. `script/m14/differential.ts` imported THREE
 * functions from `src/ast/real-php-analyzer.ts`:
 *
 *   phpDeclaredTypeRefs    the ENTIRE declared-type reference graph   (8,030 edges)
 *   phpStaticCallableName  the callee-name rule                        (governs `calls`, 89,059)
 *   phpStaticIncludePath   the include-path rule                       (governs `imports` paths)
 *
 * The lane's own comment justified it: "a hand-written copy cannot drift from the
 * rule it claims to state." The drift half is true. The blindness half was not
 * priced, and this lane had already paid it TWICE:
 *
 *   - `phpStaticCallableName` published `calls -> $callable` — a target no php symbol
 *     can ever be named — until R10 fixed it. The oracle agreed because it called the
 *     same function. Found by R10's target-spelling census, which READS the analyzer.
 *   - `phpStaticIncludePath` published `$this->baseDir.'revision-info.php'` as a
 *     `references` target, then published `__DIR__.'/src/DeprecatedClass.php'` on
 *     phpunit's autoloaders. Both agreed, both times, for the same reason.
 *
 * None of the three was ever checked by comparing two implementations. php is not
 * unique in sharing — csharp shares five functions and ruby shares three — but this
 * gate covers php, and it covers the CLASS rather than the three names, so the next
 * shared rule cannot be added quietly.
 *
 * WHAT IT ASSERTS, and the distinction it turns on:
 *
 *   RULE   — a function that DECIDES something. Importing it means the truth is not
 *            independent, and no comparison exists.
 *   DATA   — a SET of names (`PHP_BUILTINS`). Importing it is correct and in fact
 *            required: a hand-copied list of builtin names drifts, and the drift would
 *            fabricate or hide call edges. This is a data set both sides read, not a
 *            rule either side computes.
 *
 * So the gate allows declared DATA exports and fails on anything else, which is the
 * same distinction `derivePhpDeclaredTypeEdgesIndependent`'s header draws when it
 * reads `metadata.baseClass` from the analyzer's symbols: a PUBLISHED FACT both sides
 * read is not a shared rule.
 *
 * It also asserts the three replacements are PRESENT and WIRED, because an
 * independence gate that only checks for the absence of a violation would happily
 * pass on a file where the truth was deleted.
 *
 * Run: bun script/m60/php-oracle-independence.ts   (exit 1 on any violation)
 *      bun script/m60/php-oracle-independence.ts --json
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = "$HOME/backbencher-brain"
const DIFF = path.join(ROOT, "script/m14/differential.ts")
const AS_JSON = process.argv.includes("--json")

/** Analyzer exports that are DATA, not RULES. Importing these is correct. */
const ALLOWED_DATA = new Set(["PHP_BUILTINS"])

/**
 * Analyzer exports that may be imported ONLY to keep a side-by-side comparison
 * reproducible from this file, never for the truth path.
 *
 * Narrow on purpose, and each entry has to say why. The alternative — deleting the
 * import — would leave the shared derivation reachable only by re-typing it, and the
 * measurement that justifies the replacement ("0 disagreements over 4,463 files")
 * would stop being reproducible from the file that carries the replacement. Keeping
 * the superseded version next to the independent one is what makes the claim checkable
 * by a reader instead of by trust.
 *
 * The gate enforces the half that matters: an entry here is exempt from the
 * "importing a RULE is a violation" rule, but the truth-path check below still fails
 * if the truth loop actually CALLS it. So an exemption can keep a comparison alive and
 * can never quietly become the answer.
 */
const ALLOWED_SUPERSEDED: Record<string, string> = {
  phpDeclaredTypeRefs: "the SUPERSEDED shared declared-type derivation, kept so `derivePhpDeclaredTypeEdges` (which no longer feeds the truth) can still be run beside `derivePhpDeclaredTypeEdgesIndependent` and reproduce the 0-disagreement measurement from this file alone",
}

/**
 * php's rules that MUST have an independent derivation in the differential, and the
 * export that provides it. Named rather than inferred: the point is to say which
 * capability is at stake, so that deleting a replacement is a named failure rather
 * than a silent one.
 */
const REQUIRED_INDEPENDENT: Array<{ rule: string; replacement: string; governs: string }> = [
  { rule: "phpDeclaredTypeRefs", replacement: "derivePhpDeclaredTypeEdgesIndependent", governs: "`references` — 8,030 edges, the declared-type graph" },
  { rule: "phpStaticCallableName", replacement: "phpIndependentCallableName", governs: "`calls` — 89,059 edges, the callee-name rule" },
  { rule: "phpStaticIncludePath", replacement: "phpIndependentStaticIncludePath", governs: "`imports` — the include/require path half" },
]

const src = readFileSync(DIFF, "utf8")

// ---------------------------------------------------------------------------
// Which php-analyzer exports does the truth import? Read the import statements
// rather than grepping, so a name inside a comment or a string cannot register.
// ---------------------------------------------------------------------------
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
const parser = new P()
parser.setLanguage(grammar)
const tree = parser.parse(src)

const imported = new Set<string>()
const importStmts: string[] = []
{
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "import_statement") {
      const text = String(n.text ?? "")
      if (/real-php-analyzer/.test(text)) {
        importStmts.push(text.replace(/\s+/g, " ").slice(0, 200))
        const clause = n.namedChildren.find((c: any) => c.type === "import_clause")
        if (clause) {
          const cl: any[] = [clause]
          while (cl.length) {
            const c = cl.pop()!
            if (c.type === "identifier" || c.type === "shorthand_property_identifier_pattern") imported.add(String(c.text))
            for (let i = 0; i < c.namedChildCount; i++) { const x = c.namedChild(i); if (x) cl.push(x) }
          }
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}

// ---------------------------------------------------------------------------
// Is each replacement DEFINED and WIRED (defined AND referenced beyond its own
// declaration)? A gate that only checks for absence passes on a deleted truth.
// ---------------------------------------------------------------------------
const definedCount = (name: string): number => {
  const re = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`, "g")
  return (src.match(re) ?? []).length
}
const referenceCount = (name: string): number => {
  const re = new RegExp(`\\b${name}\\s*\\(`, "g")
  return (src.match(re) ?? []).length
}

const violations: string[] = []
const rows: Array<{ name: string; kind: "data" | "rule" | "superseded-comparison"; note: string }> = []
for (const name of [...imported].sort()) {
  if (ALLOWED_DATA.has(name)) { rows.push({ name, kind: "data", note: "declared DATA export — a set of names, not a rule; a hand-copied list would drift" }); continue }
  if (ALLOWED_SUPERSEDED[name]) { rows.push({ name, kind: "superseded-comparison", note: `exempt: kept only to keep the comparison reproducible — ${ALLOWED_SUPERSEDED[name]}` }); continue }
  rows.push({ name, kind: "rule", note: "SHARED RULE — the truth is not independent of the analyzer" })
  violations.push(`php-oracle-independence: the truth imports the RULE \`${name}\` from real-php-analyzer — no comparison exists for whatever it decides`)
}

const replacements: Array<{ rule: string; replacement: string; governs: string; defined: number; refs: number; ok: boolean }> = []
for (const r of REQUIRED_INDEPENDENT) {
  const defined = definedCount(r.replacement)
  const refs = referenceCount(r.replacement)
  const ok = defined >= 1 && refs >= 2 // definition + at least one call
  replacements.push({ ...r, defined, refs, ok })
  if (!ok) {
    violations.push(`php-oracle-independence: ${r.rule} has no WIRED independent replacement — \`${r.replacement}\` (defined=${defined}, references=${refs}); ${r.governs} would be unaudited`)
  }
}

// The shared function may still be IMPORTED for the kept-superseded comparison, but
// it must not be on the truth path. Checked as: the superseded wrapper's name still
// appears, and the truth loop does not call the analyzer's function directly.
const onTruthPath = /for \(const e of derivePhpDeclaredTypeEdges\(/.test(src)
if (onTruthPath) {
  violations.push("php-oracle-independence: the php truth loop calls `derivePhpDeclaredTypeEdges` (the SHARED declared-type derivation) — the independent one is not wired")
}

const result = {
  gate: "php-oracle-independence",
  principle: "a rule both sides call is a rule with one implementation, and one implementation has nobody checking it",
  phpAnalyzerImports: importStmts,
  imports: rows,
  independentReplacements: replacements,
  violations,
  verdict: violations.length === 0 ? "PASS" : "FAIL",
}
if (AS_JSON) { console.log(JSON.stringify(result, null, 1)); process.exit(violations.length ? 1 : 0) }

console.log(`php oracle independence — ${DIFF.replace(ROOT + "/", "")}`)
console.log(`  principle: ${result.principle}\n`)
console.log(`  php-analyzer imports: ${importStmts.length}`)
for (const s of importStmts) console.log(`    ${s}`)
console.log(`\n  imported exports:`)
for (const r of rows) console.log(`    ${(r.kind === "data" ? "DATA" : r.kind === "rule" ? "RULE" : "CMP ").padEnd(5)} ${r.name.padEnd(26)} ${r.note}`)
console.log(`\n  independent replacements (must be defined AND wired):`)
for (const r of replacements) {
  console.log(`    ${r.ok ? "ok  " : "MISS"} ${r.rule.padEnd(22)} -> ${r.replacement.padEnd(40)} defined=${r.defined} refs=${r.refs}`)
  console.log(`         governs ${r.governs}`)
}
console.log(`\n  truth loop calls the SHARED declared-type derivation: ${onTruthPath ? "YES (violation)" : "no"}`)
if (violations.length) { console.log("\n  VIOLATIONS:"); for (const v of violations) console.log(`    ${v}`) }
console.log(`\nphp oracle independence: ${result.verdict}`)
process.exit(violations.length ? 1 : 0)
