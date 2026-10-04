// Mutation test for verify-lua-export-shapes.ts. A green gate proves nothing
// unless breaking each condition turns it RED, so every rule the gate encodes is
// broken in turn and the gate is required to fail. Each mutation is applied to a
// RESTORED copy of the analyzer and reverted immediately, so the tree is never
// left mutated.
import { readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
// Derived from this file's own location, NOT hardcoded. Six of this lane's scripts
// pinned $HOME/backbencher-brain, so in a lane worktree they read a path
// that does not exist and the gate died with ENOENT instead of reporting a verdict.
// A gate that cannot execute is not a gate, and the mutant battery looked green
// only because its failure was being read as a pass.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const SRC = REPO + "/src/ast/real-lua-analyzer.ts"
const GATE = REPO + "/script/m60/verify-lua-export-shapes.ts"
const original = readFileSync(SRC, "utf8")

const MUTATIONS: Array<[string, string, string, string[]]> = [
  [
    "M1 positional fallback",
    'const key = f.childForFieldName("name")',
    'const key = f.childForFieldName("name") || f.namedChild(0)',
    // Caught by the POSITIONAL-VALUE cases, not by the numeric-array case. For
    // `return { 1, 2 }` the fallback yields a number and the type check rejects
    // it, so the original expectation here was wrong and the harness said so
    // rather than passing quietly. The mutation is only observable when the
    // positional value is a string, because only then does the fallback reach
    // `stringValue` and fabricate a name.
    ["no name invented from a positional return { \"a\", \"b\" }"],
  ],
  [
    "M2 drop string-key handling",
    'else if (key.type === "string") name = this.stringValue(key)',
    'else if (false) name = this.stringValue(key)',
    ["string keys publish unquoted", "a dotted string key keeps its dots"],
  ],
  [
    "M3 anchor range on the return statement",
    "range: this.nodeToRange(key), metadata: { luaSpecific: true }",
    "range: this.nodeToRange(node), metadata: { luaSpecific: true }",
    ["first member's line is its own", "second member's line is its own"],
  ],
  [
    "M4 remove the in-function guard",
    "    if (frame.inFunction) return\n    // M60 LUA-00:",
    "    // M60 LUA-00:",
    ["a return inside a function is not a module export", "a method's return is not a module export"],
  ],
  [
    "M5 skip the table branch entirely",
    'if (target.type === "table_constructor") {',
    'if (false) {',
    ["named table members are published", "string keys publish unquoted", "nested table publishes its own key only"],
  ],
]

const runGate = (): { code: number; out: string } => {
  try {
    const o = execFileSync("bun", [GATE], { cwd: REPO, encoding: "utf8", env: { ...process.env, PATH: process.env.HOME + "/.local/bin:" + process.env.PATH } })
    return { code: 0, out: o }
  } catch (e: any) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") }
  }
}

// Sanity: the UNMUTATED gate must be green, or every mutation below is vacuous.
const base = runGate()
if (base.code !== 0) {
  console.error("refusing to mutate: the gate is not green before mutation")
  console.error(base.out)
  process.exit(2)
}
console.log(`baseline: green\n`)

let survived = 0
try {
  for (const [label, find, replace, expect] of MUTATIONS) {
    if (!original.includes(find)) {
      console.log(`  ${label.padEnd(38)} SKIPPED — anchor not found (the analyzer moved on; fix the mutation)`)
      survived++
      continue
    }
    writeFileSync(SRC, original.replace(find, replace))
    const r = runGate()
    writeFileSync(SRC, original) // revert immediately
    const caught = r.code !== 0
    const named = expect.filter(e => r.out.includes(e))
    if (!caught) { survived++; console.log(`  ${label.padEnd(38)} SURVIVED — gate stayed green`); continue }
    console.log(`  ${label.padEnd(38)} caught  (${named.length}/${expect.length} expected checks failed)`)
    if (named.length < expect.length) {
      console.log(`      expected but not reported: ${expect.filter(e => !r.out.includes(e)).join(", ")}`)
    }
  }
} finally {
  writeFileSync(SRC, original)
}

// Prove the tree is back to the original, byte for byte.
const now = readFileSync(SRC, "utf8")
console.log(`\nanalyzer restored byte-for-byte: ${now === original ? "YES" : "NO — INVESTIGATE"}`)
const after = runGate()
console.log(`gate green after restore: ${after.code === 0 ? "YES" : "NO"}`)

console.log(survived === 0 ? "\nall mutations caught" : `\n${survived} mutation(s) SURVIVED`)
process.exit(survived === 0 && now === original ? 0 : 1)
