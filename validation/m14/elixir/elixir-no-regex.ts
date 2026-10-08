// ELIXIR_FIX2 no-regex census over EVERY file this lane owns.
//
// WHY THIS EXISTS. `script/m14/no-regex-gate.sh src/ast` reports 4 regex literals
// in the whole tree and none of them is the elixir analyzer — but it scans
// `src/ast` only, so the elixir ORACLE and the six lane instruments are outside
// its population. An earlier finding in this programme was exactly that shape: a
// probe printing "0 regexes" while covering 16 of the lane's 25 files. So this
// census names the population it covered and counts regex nodes in each file
// individually, using the SAME instrument the shared gate delegates to
// (tree-sitter over TypeScript, `regex` node type) rather than a text scan.
//
// The population is DERIVED: every `real-elixir-analyzer*` under src/ast, this
// lane's oracle, this lane's instruments, and this lane's fixtures. A new file
// beside any of them is picked up without editing a list.
//
// Usage:  bun run validation/m14/elixir/elixir-no-regex.ts
// Exit 0 = zero regex literals across the declared population.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join, relative } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = join(import.meta.dir, "../../..")
function headCommit(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" }
}

// The lane's own files, DERIVED by walking the directories that hold them.
function walkDir(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
  let ents: any[]
  try { ents = readdirSync(dir, { withFileTypes: true }) as any[] } catch { return out }
  for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walkDir(p, keep, out); continue }
    if (e.isFile() && keep(e.name)) out.push(p)
  }
  return out
}

const population: string[] = [
  ...walkDir(join(ROOT, "src/ast"), (n) => n.indexOf("real-elixir-analyzer") === 0 && n.endsWith(".ts")),
  ...walkDir(join(ROOT, "script/m14/oracles"), (n) => n.indexOf("elixir") === 0 && n.endsWith(".ts")),
  ...walkDir(join(ROOT, "validation/m14/elixir"), (n) => n.endsWith(".ts")),
  ...walkDir(join(ROOT, "validation/m14/fixtures/elixir"), (n) => n.endsWith(".ex") || n.endsWith(".exs")),
]

const parser = await ASTEngine.getParser("typescript")
const rows: Array<{ file: string; regexLiterals: number; regexConstructors: number; bytes: number; sha256_16: string }> = []
let totalRegex = 0
let totalCtor = 0
let unreadable = 0

for (const f of population) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { unreadable++; continue }
  const tree = parser.parse(content)
  let re = 0
  let ctor = 0
  // Iterative walk: the census is recursive in the shared core, and a deeply
  // nested fixture would be a stack-depth question nobody needs to ask.
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === "regex") re++
    // RegExp("...") — a constructor call is the same capability by another
    // spelling, and counting only the literal form is how a "0 regexes" claim
    // hides one.
    if (node.type === "new_expression" || node.type === "call_expression") {
      const name = node.childForFieldName?.("constructor") ?? node.childForFieldName?.("function")
      if (name && name.text === "RegExp") ctor++
    }
    for (let i = 0; i < node.childCount; i++) stack.push(node.child(i))
  }
  totalRegex += re
  totalCtor += ctor
  rows.push({ file: relative(ROOT, f), regexLiterals: re, regexConstructors: ctor, bytes: content.length, sha256_16: createHash("sha256").update(content).digest("hex").slice(0, 16) })
}

const artifact = {
  tool: "validation/m14/elixir/elixir-no-regex.ts",
  lane: "ELIXIR_FIX2",
  subjectCommit: headCommit(),
  // The population, declared, so "0 regexes" is never read as "0 regexes
  // everywhere" (honesty contract, "an instrument must declare the population it
  // covered"). Derived by readdir, never hand-written.
  population: {
    derived: true,
    roots: ["src/ast (real-elixir-analyzer*)", "script/m14/oracles (elixir*)", "validation/m14/elixir (*.ts)", "validation/m14/fixtures/elixir (*.ex, *.exs)"],
    filesScanned: rows.length,
    unreadable,
  },
  instrument: "tree-sitter TypeScript AST; `regex` node type plus RegExp constructor calls. NOT a text scan.",
  totalRegexLiterals: totalRegex,
  totalRegExpConstructors: totalCtor,
  rows: rows.sort((a, b) => (a.file < b.file ? -1 : 1)),
}
writeFileSync(join(import.meta.dir, "elixir-no-regex.json"), JSON.stringify(artifact, null, 2))

for (const r of rows) console.log(`${String(r.regexLiterals + r.regexConstructors).padStart(3)}  ${r.file}`)
console.log(`\nfiles scanned: ${rows.length} of ${population.length} in the derived population${unreadable ? ` (${unreadable} unreadable)` : ""}`)
console.log(`regex literals: ${totalRegex}    RegExp constructors: ${totalCtor}`)
console.log("artifact: validation/m14/elixir/elixir-no-regex.json")
if (totalRegex + totalCtor > 0) process.exit(2)