// script/m13/verify-declared-dialect.ts
//
// Reported on 0.1.8: "24 Font Awesome LESS/SCSS syntax errors and the 1 >5 MB
// skipped file remain."
//
// `.less` and `.sass` are routed to the CSS grammar because no LESS or
// indented-Sass grammar is bundled (src/ast/engine.ts documents them as DECLARED).
// The CSS grammar does not understand `@variable`, mixin guards or indentation, so
// it warns about constructs the file uses CORRECTLY. Reporting those as the FILE
// having a syntax error is the wrong claim: the analyzer is incomplete, not the
// file. They are now counted as declared-dialect files instead.

import { readFileSync } from "node:fs"
import * as path from "node:path"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const root = path.resolve(import.meta.dirname, "../..")
const indexer = readFileSync(path.join(root, "src/ast/parallel-indexer.ts"), "utf8")
const engine = readFileSync(path.join(root, "src/ast/engine.ts"), "utf8")

console.log("M13 declared-dialect parse limits\n")

// ── the routing is already declared upstream ─────────────────────────────────
check("engine.ts routes scss to its own grammar", /tree-sitter-scss\.wasm/.test(engine))
check("engine.ts declares .sass/.less on the CSS wasm", /\.less\` stay on the CSS wasm|\.less.*CSS wasm/.test(engine))

// ── the indexer no longer calls a dialect limitation a syntax error ──────────
check("the indexer names the declared dialects", /DECLARED_DIALECT_EXTS = new Set\(\["\.less", "\.sass"\]\)/.test(indexer))
check(
  "a declared-dialect parse warning does NOT set hasSyntaxErrors",
  /hasSyntaxErrors = rawSyntaxErrors && !declaredDialect/.test(indexer),
  "the guard must be `rawSyntaxErrors && !declaredDialect`",
)
check("raw parse warnings are still stored, not discarded", /errorReport = rawSyntaxErrors \? JSON\.stringify/.test(indexer))
check("declared-dialect files are COUNTED", /declaredDialectMetrics\.files\+\+/.test(indexer))
check("the counter is exported so a reader can see it", /export const declaredDialectMetrics = \{ files: 0 \}/.test(indexer))

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "DECLARED DIALECT: PASS" : `DECLARED DIALECT: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
