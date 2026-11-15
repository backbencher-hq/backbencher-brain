// rust #798 — every `impl` symbol whose published name is not a single bare
// identifier. Under the R10 ruling a QUALIFIED path (`std::io::Error`) is a
// legitimate name (the deferred constructor filter reads in-file symbol names),
// so the class must be split before it is called a violation: a names-that-are-
// actually-(possibly-qualified) rust names check, matching F14's R2.
//
// Run: bun script/m14/tmp/rust-798-impl-symbol-names.ts <repoRoot>
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"

const root = process.argv[2]
const files: string[] = []
const walk = (dir: string, depth = 0) => {
  if (depth > 14) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith(".rs")) files.push(p)
  }
}
walk(root)
files.sort()

const parser = await ASTEngine.getParser("rust" as any)
const analyzer = new RealRustAnalyzer()

const BARE = /^[A-Za-z_][A-Za-z0-9_]*$/
// F14 R2, mirrored: a `::`-joined path of rust identifiers, no bare keyword segment.
const KEYWORDS = new Set([
  "as", "break", "const", "continue", "crate", "else", "enum", "extern", "false", "fn",
  "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref",
  "return", "self", "Self", "static", "struct", "super", "trait", "true", "type",
  "unsafe", "use", "where", "while", "async", "await", "dyn", "abstract", "become",
  "box", "do", "final", "macro", "override", "priv", "try", "typeof", "unsized",
  "virtual", "yield", "union",
])
const isRustName = (n: string) => {
  if (!n) return false
  return n.split("::").every((seg) => BARE.test(seg) && !KEYWORDS.has(seg))
}

let impls = 0
let qualified = 0
let nonName = 0
const samples: string[] = []
for (const f of files) {
  const content = fs.readFileSync(f, "utf8")
  let rootNode: any
  try { rootNode = parser.parse(content).rootNode } catch { continue }
  if (!rootNode) continue
  const res: any = await analyzer.analyze(rootNode, content, f)
  const rel = path.relative(root, f)
  for (const s of res.symbols ?? []) {
    if (String(s.kind) !== "impl") continue
    impls++
    const name = String(s.name ?? "")
    if (BARE.test(name)) continue
    if (isRustName(name)) {
      qualified++
      if (samples.length < 60) samples.push(`QUALIFIED  ${JSON.stringify(name)} @ ${rel}:${s.startLine ?? "?"}`)
    } else {
      nonName++
      samples.push(`NON-NAME   ${JSON.stringify(name)} @ ${rel}:${s.startLine ?? "?"}`)
    }
  }
}
console.log(JSON.stringify({ repo: root, files: files.length, impls, qualified, nonName }, null, 1))
for (const s of samples) console.log("  " + s)
