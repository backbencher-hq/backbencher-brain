/**
 * INDEPENDENT callee-name oracle for php, and the `relative_name` question.
 *
 * `phpStaticCallableName` is the analyzer's own callee rule and the differential
 * CALLS IT — so the whole of php's 2nd-largest label (89,059 `calls` edges over the
 * two pinned corpora) is decided by ONE implementation. This rule has already been
 * wrong once: it published `calls -> $callable` (a target no php symbol can ever be
 * named) until R10 fixed it, and the oracle agreed because it called the same
 * function, so no differential could see it. Found by reading the analyzer, not by
 * comparing two implementations.
 *
 * Written from the pinned grammar's own callee shapes, measured over the full
 * git-tracked corpus of both pinned repos.
 */
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"
const ROOT = "$HOME/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { phpStaticCallableName, PHP_BUILTINS } = await import(path.join(ROOT, "src/ast/real-php-analyzer.ts"))
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const g: any = await (wts as any).Language.load(readFileSync(`${ROOT}/wasm/tree-sitter-php.wasm`))
const parser = new P(); parser.setLanguage(g)

/**
 * THE RULE, independently: a call target exists only when the callee is spelled as a
 * NAME. Six callee shapes exist in this grammar (probe-verified):
 *
 *   name                      strlen(...)          -> `strlen`
 *   qualified_name            \Foo\Bar\baz(...)    -> `baz`   (LEAF, incl. a leading \)
 *   variable_name             $fn(...)             -> nothing: a runtime VALUE, not a callee NAME
 *   parenthesized_expression  ($fn)(...)           -> nothing
 *   array_creation_expression [$fn](...)          -> nothing
 *   relative_name             namespace\f(...)     -> nothing (see the question below)
 *
 * A `calls` target is a name a symbol can BE named by, so anything not spelled as a
 * name yields no edge — and the VALUE is still read, by the variable pass, as
 * `uses -> fn`. Publishing `calls -> $fn` would fabricate a name AND lose the honest
 * edge at the same time, which is the R10 target-spelling defect.
 */
function independentCallableName(fn: any): string | undefined {
  if (!fn) return undefined
  if (fn.type === "name") { const t = String(fn.text ?? "").trim(); return t || undefined }
  if (fn.type === "qualified_name") {
    let text = String(fn.text ?? "")
    let i = 0
    while (i < text.length && text.charCodeAt(i) === 92) i++   // drop leading backslashes
    const at = text.lastIndexOf("\\", i === 0 ? 0 : text.length)
    const leaf = text.substring(at + 1).trim()
    return leaf || undefined
  }
  return undefined
}

let files = 0
let sharedTotal = 0, indepTotal = 0
let sharedNull = 0, indepNull = 0
const disagreements: string[] = []
const calleeShapes = new Map<string, number>()
let relativeNameSites: string[] = []
let relativeNameBuiltin = 0
const wpHooks = new Set(["add_action", "add_filter"])

for (const repo of ["phpunit", "phpmyadmin"]) {
  const dir = path.join("$HOME/fixtures/repositories", repo)
  for (const f of execSync(`git ls-files -z -- '*.php'`, { cwd: dir, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean).sort()) {
    let src: string, root: any
    try { src = readFileSync(path.join(dir, f), "utf8"); root = parser.parse(src).rootNode } catch { continue }
    files++
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "function_call_expression") {
        const fn = n.childForFieldName?.("function")
        const shape = fn?.type ?? "(none)"
        calleeShapes.set(shape, (calleeShapes.get(shape) ?? 0) + 1)
        if (shape === "relative_name" && relativeNameSites.length < 12) relativeNameSites.push(`${repo}/${f}: ${n.text.split("\n")[0].slice(0, 80)}`)
        const a = phpStaticCallableName(fn)
        const b = independentCallableName(fn)
        if (a !== undefined) sharedTotal++; else sharedNull++
        if (b !== undefined) indepTotal++; else indepNull++
        if (a !== b && disagreements.length < 30) disagreements.push(`${repo}/${f}  ${shape}  shared=${JSON.stringify(a)}  independent=${JSON.stringify(b)}`)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
}
console.log(`files=${files}`)
console.log(`\nCALLEE-NAME RULE — shared vs independent, over every function_call_expression`)
console.log(`  sites with a callee NAME   shared=${sharedTotal}  independent=${indepTotal}`)
console.log(`  sites with NO callee name  shared=${sharedNull}  independent=${indepNull}`)
console.log(`  disagreements             ${disagreements.length}${disagreements.length >= 30 ? "+" : ""}`)
for (const d of disagreements) console.log("    " + d)
console.log(`\nCALLEE NODE TYPES in the corpora:`)
for (const [k, v] of [...calleeShapes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(30)} ${v}`)
console.log(`\nrelative_name CALLEE SITES (namespace\\f()) — the rule both sides decline:`)
console.log(`  ${relativeNameSites.length}${relativeNameSites.length >= 12 ? "+" : ""} sample(s)`)
for (const s of relativeNameSites) console.log("    " + s)
process.exit(0)
