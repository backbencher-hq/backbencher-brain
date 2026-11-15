// go (round 4) — the third R10 residue: `references|-`.
//
// The R10 census (`bun script/m60/target-spelling-census.ts --lane go --sample
// 2200`) reports the lane as `unruled-separators` with three triples:
// references|-, references|. and references|/. Two of them are explained by
// go-799-reftargets.ts (qualified TYPE text in `references/declared_type` and
// `references/return_type`; import PATHS in a `references` edge carrying
// metadata.isGoImportDep). The hyphen has no such convention: NO legal Go
// identifier contains `-`, so a hyphenated target is either source text or
// debris. A hyphen CAN appear inside recovered text (`len(s) - 1`), so this
// scans the corpus, keeps the files the pinned grammar could not parse, and
// prints every target carrying a hyphen with the line it was read from.
//
// Run: bun script/m14/tmp/go-799-hyphen-targets.ts <repoRoot>
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const root = process.argv[2]
const files: string[] = []
const walk = (dir: string, depth = 0) => {
  if (depth > 16) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "vendor") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith(".go")) files.push(p)
  }
}
walk(root)
files.sort()

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()

// Pass 1: which files does the pinned grammar fail on? (parse only, no analyzer)
const errorFiles: string[] = []
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const st: any[] = [parser.parse(src).rootNode]
  let bad = false
  while (st.length) {
    const n: any = st.pop()
    if (n.type === "ERROR" || n.isMissing) { bad = true; break }
    for (let i = 0; i < n.namedChildCount; i++) st.push(n.namedChild(i))
  }
  if (bad) errorFiles.push(f)
}
console.log(`=== ${files.length} .go files; ${errorFiles.length} parse with ERROR/isMissing`)

// Pass 2: analyze the error files and print every hyphenated target.
let rows = 0
for (const f of errorFiles) {
  const src = fs.readFileSync(f, "utf8")
  const tree: any = parser.parse(src)
  const res: any = await analyzer.analyze(tree.rootNode, src, f)
  const lines = src.split("\n")
  for (const r of (res.relationships ?? []) as any[]) {
    const target = String(r.target ?? "")
    if (!target.includes("-")) continue
    rows++
    const ln = Number(r.line_number ?? 0)
    console.log(
      `  ${String(r.type).padEnd(12)} -> ${JSON.stringify(target).slice(0, 70)} src=${String(r.source)} rt=${String(r.metadata?.relationshipType ?? "-")} @ ${path.relative(root, f)}:${ln} line=${JSON.stringify((lines[ln - 1] ?? "").trim().slice(0, 50))}`,
    )
  }
}
console.log(`=== hyphenated targets in parse-error files: ${rows}`)

// The same question for files the grammar CAN parse: a hyphen can only reach a
// target through a string literal or a comment the lane read as a name.
let cleanRows = 0
for (const f of files) {
  if (errorFiles.includes(f)) continue
  const src = fs.readFileSync(f, "utf8")
  if (!/[A-Za-z0-9_]-[A-Za-z0-9_]/.test(src)) continue
  const tree: any = parser.parse(src)
  const res: any = await analyzer.analyze(tree.rootNode, src, f)
  for (const r of (res.relationships ?? []) as any[]) {
    const target = String(r.target ?? "")
    if (!target.includes("-")) continue
    cleanRows++
    if (cleanRows <= 10) {
      console.log(
        `  [clean-parse] ${String(r.type).padEnd(12)} -> ${JSON.stringify(target).slice(0, 60)} rt=${String(r.metadata?.relationshipType ?? "-")} @ ${path.relative(root, f)}:${r.line_number ?? "?"}`,
      )
    }
  }
}
console.log(`=== hyphenated targets in parse-OK files: ${cleanRows}`)
