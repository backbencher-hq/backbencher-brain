// CS-DEEP-13 — the ROW-LEVEL RECONCILIATION for D1/D2/D3, over real corpora.
//
// The lane's rule (C2a, R7–R10, and every closing re-emission in reviews/csharp) is that
// a behavioural change is accounted for exactly: −N rows here, +M rows there, every row
// named, 0 unreconciled, 0 fabricated. A percentage is not an accounting.
//
// This instrument therefore does not print a delta — it prints every ADDED and every
// REMOVED relationship row per file, with its type, target, line and metadata, so each
// one can be matched to a twin. It runs the analyzer TWICE per file: once against the
// PRE-FIX analyzer module (materialised from git at the pre-fix commit) and once against
// the working tree, then diffs the two row sets per file and per label.
//
// The pre-fix module is read from `git show <commit>:<path>` into a temp directory and
// imported through a tiny loader, so the "before" side is the analyzer as it was, not a
// hand-copied approximation of it.
//
// Usage:
//   bun script/m14/tmp/cs-deep-13-reconciliation.ts --before <commit> --list <paths> [limit]
import { execFileSync } from "node:child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}

type Row = { src: string; type: string; target: string; line: number | null; md: string }

function rowsOf(res: any): Row[] {
  return (res.relationships ?? []).map((r: any) => ({
    src: String(r.source ?? ""),
    type: String(r.type ?? r.relationshipType ?? ""),
    target: String(r.target ?? ""),
    line: (r.line_number ?? null) as number | null,
    md: JSON.stringify(r.metadata ?? {}),
  }))
}

function key(r: Row): string {
  return `${r.src}|${r.type}|${r.target}|${r.line}|${r.md}`
}

function symRowsOf(res: any): Row[] {
  return (res.symbols ?? []).map((s: any) => ({
    src: String(s.ownerName ?? ""),
    type: "sym:" + String(s.kind),
    target: String(s.name),
    line: s.range?.startLine ?? null,
    md: JSON.stringify({ v: s.visibility, d: s.decorators, m: s.metadata }),
  }))
}

async function main() {
  const beforeCommit = arg("--before")
  const listFile = arg("--list")
  if (!beforeCommit || !listFile) {
    console.error("usage: cs-deep-13-reconciliation.ts --before <commit> --list <paths> [limit]")
    process.exit(2)
  }
  const limit = Number(arg("--limit") ?? 200)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  // Materialise the PRE-FIX analyzer module next to the tree, so its relative imports
  // (`./engine`, `./override-context`, and engine's own `../tool/brain-log`) resolve
  // exactly as they do in the working tree. A symlink per top-level `src` entry is enough:
  // one real file to override, everything else borrowed by reference.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cs-deep13-"))
  const relAnalyzer = "src/ast/real-csharp-analyzer.ts"
  const beforeSrc = execFileSync("git", ["show", `${beforeCommit}:${relAnalyzer}`], { cwd: ROOT, maxBuffer: 1 << 28 }).toString()
  const stage = path.join(tmp, "src", "ast")
  fs.mkdirSync(stage, { recursive: true })
  fs.writeFileSync(path.join(stage, "real-csharp-analyzer.ts"), beforeSrc)
  for (const entry of fs.readdirSync(path.join(ROOT, "src"), { withFileTypes: true })) {
    const dest = path.join(tmp, "src", entry.name)
    if (dest === stage) continue
    if (entry.isDirectory()) fs.symlinkSync(path.join(ROOT, "src", entry.name), dest, "dir")
    else fs.symlinkSync(path.join(ROOT, "src", entry.name), dest)
  }
  // engine.ts / override-context.ts are imported by the materialised module; the working
  // copies are the ones under test, so borrow them rather than the pre-fix revisions.
  for (const dep of ["engine.ts", "override-context.ts"]) {
    fs.symlinkSync(path.join(ROOT, "src", "ast", dep), path.join(stage, dep))
  }
  const beforeMod: any = await import(path.join(stage, "real-csharp-analyzer.ts"))
  const afterMod: any = await import(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"))

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const added = new Map<string, Row[]>()
  const removed = new Map<string, Row[]>()
  const byLabel = new Map<string, { add: number; rem: number }>()
  let filesTouched = 0
  let payloadRows = 0

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser.parse(src)
    const before = beforeMod.RealCSharpAnalyzer ? new beforeMod.RealCSharpAnalyzer().analyze(tree.rootNode, src, f) : null
    const after = new afterMod.RealCSharpAnalyzer().analyze(tree.rootNode, src, f)
    const b = [...rowsOf(before), ...symRowsOf(before)]
    const a = [...rowsOf(after), ...symRowsOf(after)]
    const bKeys = new Set(b.map(key))
    const aKeys = new Set(a.map(key))
    const rem = b.filter((r) => !aKeys.has(key(r)))
    const add = a.filter((r) => !bKeys.has(key(r)))
    if (rem.length === 0 && add.length === 0) continue
    filesTouched++
    if (rem.length) removed.set(f, rem)
    if (add.length) added.set(f, add)
    for (const r of rem) { const k = `${r.type}`; byLabel.set(k, { add: (byLabel.get(k)?.add ?? 0), rem: (byLabel.get(k)?.rem ?? 0) + 1 }) }
    for (const r of add) { const k = `${r.type}`; byLabel.set(k, { add: (byLabel.get(k)?.add ?? 0) + 1, rem: (byLabel.get(k)?.rem ?? 0) }) }
  }

  const sum = (m: Map<string, Row[]>) => [...m.values()].reduce((a, b) => a + b.length, 0)
  console.log(`pre-fix analyzer materialised from ${beforeCommit}`)
  console.log(`files read: ${files.length}   files with a row change: ${filesTouched}`)
  console.log(`REMOVED rows: ${sum(removed)}    ADDED rows: ${sum(added)}`)
  console.log(`by label: ${JSON.stringify(Object.fromEntries([...byLabel.entries()].sort()))}`)

  const show = (m: Map<string, Row[]>, title: string, cap: number): void => {
    console.log(`\n== ${title}`)
    let n = 0
    for (const [f, rs] of m) {
      for (const r of rs) {
        if (n++ >= cap) { console.log(`   ... (${sum(m) - cap} more)`); return }
        console.log(`   ${path.basename(f)}  ${r.src} -[${r.type}]-> ${JSON.stringify(r.target)} line=${r.line} ${r.md}`)
      }
    }
  }
  show(removed, "REMOVED (every row must have a twin below)", 40)
  show(added, "ADDED", 40)
}

if (import.meta.main) await main()
