/**
 * WHERE ARE THE QUOTED EXPORT SITES, and does each one produce an edge?
 *
 * BD11 found the static quoted assignment by difference (1,602 statically nameable sites vs
 * 1,598 edges) but the difference alone does not say WHICH nodes the analyzer failed to read.
 * This is the pointer: for every `export`-headed node in the corpus whose argument is a single
 * string node, print the file, the line, the node shape, the name the site would publish, and
 * the `exports` edges the PRODUCTION path actually emitted for that file.
 *
 * Read-only. CLI: bun validation/m14/fixtures/bash/probe-bash-quoted-export-sites.mts
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const REPO_ROOT = process.env.BB_REPO || join(import.meta.dirname, "..", "..", "..", "..")
const CORPUS = process.env.BB_CORPUS || "/home/ishaq2321/bb_tests/repositories"
const EXTS = [".sh", ".bash"]
const files: string[] = []
for (const e of readdirSync(CORPUS).sort()) {
  const d = join(CORPUS, e)
  try {
    if (!statSync(d).isDirectory()) continue
    execFileSync("git", ["-C", d, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", d, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
    const abs = join(d, rel)
    try {
      if (statSync(abs).size < 400_000) files.push(abs)
    } catch {
      /* absent */
    }
  }
}
files.sort()

const stripOuterQuotes = (s: string): string => {
  if (s.length < 2) return s
  const a = s.charCodeAt(0)
  const b = s.charCodeAt(s.length - 1)
  return (a === 34 || a === 39) && b === a ? s.slice(1, -1) : s
}
const { getParser } = await import(`${REPO_ROOT}/src/ast/engine.ts`)
const mod = await import(`${REPO_ROOT}/src/ast/real-bash-analyzer.ts`)
const Analyzer: any = Object.values(mod).find((v: any) => typeof v === "function" && v.name.endsWith("Analyzer"))

let sites = 0
let edgesTotal = 0
let filesWithSites = 0
for (const f of files) {
  const content = readFileSync(f, "utf8")
  const parser = await getParser("bash")
  const pr = await parser.parse(content, f)
  const hits: { line: number; shape: string; name: string }[] = []
  const stack = [pr.rootNode]
  while (stack.length) {
    const n = stack.pop()
    const first = n.child(0)
    const kw = first ? first.text : ""
    if ((n.type === "declaration_command" || n.type === "command") && kw === "export") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "string" || c.type === "raw_string" || c.type === "concatenation") {
          const text = c.text
          const dyn = text.includes("$") || text.includes("`")
          hits.push({ line: n.startPosition.row + 1, shape: `${n.type}>${c.type}${dyn ? "/dynamic" : "/static"}`, name: dyn ? "(computed)" : stripOuterQuotes(text).split("=")[0] })
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
  if (hits.length === 0) continue
  filesWithSites++
  const res = new Analyzer().analyze(pr.rootNode, content, f)
  const exportsEdges = (res.relationships || []).filter((r: any) => (r.type ?? r.relationshipType) === "exports")
  edgesTotal += exportsEdges.length
  sites += hits.length
  console.log(`${f.replace(CORPUS + "/", "")}  -> ${exportsEdges.length} exports edge(s)`)
  for (const h of hits) console.log(`    line ${String(h.line).padStart(5)}  ${h.shape.padEnd(28)} would publish ${JSON.stringify(h.name)}`)
}
console.log(`\nfiles with a quoted export site: ${filesWithSites}   sites: ${sites}   exports edges in those files: ${edgesTotal}`)
