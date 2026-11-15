/**
 * READ-ONLY PROBE — bash command-extraction ledger.
 *
 * The previous probe showed 1558 `command` nodes and 356 `calls` edges. That
 * gap is mostly INTENTIONAL (builtins), so quoting it as recall would be
 * dishonest. This classifies every command node into exactly one bucket and
 * reports the buckets, so the real loss is separated from the designed filter.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { parseFile } from "../../../src/ast/pool-worker"

const CORPUS = process.env.BB_BASH_CORPUS ?? "/home/ishaq2321/bb_tests/repositories/fsharp"
const ROOT = process.cwd()

const BUILTINS = new Set([
  "echo", "printf", "cd", "pwd", "exit", "return", "break", "continue",
  "shift", "source", ".", "export", "local", "declare", "typeset", "readonly",
  "set", "unset", "alias", "unalias", "trap", "eval", "exec", "true", "false",
  "sudo", "test", "[", "command", "builtin", "type", "let", "pushd", "popd", "dirs",
  "wait", "jobs", "fg", "bg", "kill", "read", "readarray", "mapfile",
  "getopts", "ulimit", "umask", "times", "enable", "help", "hash", "bind",
  "compgen", "complete", "compopt", "logout", "suspend", "caller", "disown",
  "shopt", "history", "fc", "coproc",
])
// Commands the analyzer claims but returns before the Calls edge.
const HANDLED_NO_EDGE = new Set(["source", ".", "export", "alias", "trap", "set", "chmod", "rm"])

const parser = await ASTEngine.getParser("bash")
const files = execFileSync("git", ["-C", CORPUS, "ls-files", "*.sh", "*.bash"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()

const buckets: Record<string, number> = {}
const unknownNames = new Map<string, number>()
const caseSuppressedNames = new Map<string, number>()
const bump = (k: string, n = 1) => { buckets[k] = (buckets[k] ?? 0) + n }
const bumpName = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

for (const file of files) {
  const text = execFileSync("git", ["-C", CORPUS, "show", `HEAD:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const tree = parser.parse(text)
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n: any = stack.pop()
    if (!n) continue
    if (n.type === "command") {
      // command_name > word
      let name = ""
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "command_name") { name = c.text; break }
      }
      if (name === "") bump("no-command-name")
      else if (HANDLED_NO_EDGE.has(name)) bump(`handled-no-edge:${name}`)
      else if (BUILTINS.has(name)) bump("builtin-filtered")
      else if (underType(n, "case_item")) { bump("suppressed-by-caseDepth"); bumpName(caseSuppressedNames, name) }
      else { bump("SHOULD-EMIT"); bumpName(unknownNames, name) }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  tree.delete?.()
}

function underType(node: any, t: string): boolean {
  let p = node.parent
  while (p) { if (p.type === t) return true; p = p.parent }
  return false
}

let shouldEmit = 0, emitted = 0
for (const file of files) {
  const res = await parseFile(path.join(CORPUS, file), ROOT)
  emitted += (res.relationships ?? []).filter((r: any) => r.type === "calls").length
}
shouldEmit = buckets["SHOULD-EMIT"] ?? 0

console.log("=== bash command-extraction ledger (corpus: fsharp, 32 files) ===")
const total = Object.values(buckets).reduce((a, b) => a + b, 0)
for (const k of Object.keys(buckets).sort()) console.log(`${String(buckets[k]).padStart(7)}  ${(100 * buckets[k] / total).toFixed(1).padStart(5)}%  ${k}`)
console.log(`${String(total).padStart(7)}          TOTAL command nodes`)
console.log()
console.log(`SHOULD-EMIT (non-builtin, non-case, not a no-edge handler): ${shouldEmit}`)
console.log(`calls edges actually emitted                                 : ${emitted}`)
console.log(`=> unexplained shortfall                                       : ${shouldEmit - emitted}`)
console.log()
console.log("=== names in the SHOULD-EMIT bucket (top 25) ===")
for (const [k, v] of [...unknownNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(v).padStart(6)}  ${k}`)
console.log()
console.log("=== names suppressed by caseDepth (top 25) — a DESIGN filter, currently undeclared ===")
for (const [k, v] of [...caseSuppressedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(v).padStart(6)}  ${k}`)
