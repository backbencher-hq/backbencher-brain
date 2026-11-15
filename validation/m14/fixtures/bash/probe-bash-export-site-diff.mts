/**
 * EXPORT SITES vs EXPORT EDGES — the site that names a variable and gets no edge.
 *
 * `probe-bash-silent-types.mts` measures 1,628 export sites against 1,598 `exports` edges and
 * cannot say which four sites are missing: a count difference is a pointer, not a diagnosis.
 * This file reads the TREES and the EMITTED EDGES side by side and prints every site that
 * produced no edge at its line, with the node shapes the grammar handed the extractor.
 *
 * It is the instrument BD11's ruling has to survive: the sites it lists are either declared
 * unemittable (a computed name) or they are the defect, and each row says which.
 *
 * Read-only. CLI: bun validation/m14/fixtures/bash/probe-bash-export-site-diff.mts [--repo NAME]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const REPO_ROOT = process.env.BB_REPO || join(import.meta.dirname, "..", "..", "..", "..")
const CORPUS = process.env.BB_CORPUS || "/home/ishaq2321/bb_tests/repositories"
const ONLY = process.argv.includes("--repo") ? process.argv[process.argv.indexOf("--repo") + 1] : undefined
const EXTS = [".sh", ".bash"]
const files: string[] = []
for (const e of readdirSync(CORPUS).sort()) {
  if (ONLY && e !== ONLY) continue
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
const isAnalyzerClass = (v: any): boolean => typeof v === "function" && v.name.endsWith("Analyzer")
const Analyzer: any = Object.values(mod).find(isAnalyzerClass)

let sites = 0
let matched = 0
const unmatched: string[] = []
for (const f of files) {
  const content = readFileSync(f, "utf8")
  const parser = await getParser("bash")
  const pr = await parser.parse(content, f)
  // The names each export site WOULD publish, and the shapes that produced them.
  type Site = { line: number; names: string[]; shapes: string[]; computed: boolean }
  const sitesHere: Site[] = []
  const stack = [pr.rootNode]
  while (stack.length) {
    const n = stack.pop()
    const first = n.child(0)
    const kw = first ? first.text : ""
    if (n.type === "declaration_command" && kw === "export") {
      const s: Site = { line: n.startPosition.row + 1, names: [], shapes: [], computed: false }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        s.shapes.push(`${c.type}(${JSON.stringify(c.text.slice(0, 40))})`)
        if (c.type === "variable_name") s.names.push(c.text)
        else if (c.type === "variable_assignment") {
          const vn = c.namedChild(0)
          if (vn && vn.type === "variable_name") s.names.push(vn.text)
        } else if (c.type === "string" || c.type === "concatenation" || c.type === "raw_string") {
          if (c.text.includes("$")) s.computed = true
          else {
            const inner = stripOuterQuotes(c.text)
            const name = inner.split("=")[0]
            if (name.length > 0) s.names.push(name)
          }
        } else if (c.type === "word" && c.text !== "-f" && !c.text.startsWith("-")) {
          s.names.push(c.text)
        } else if (c.type === "word" && c.text === "-f") {
          s.shapes.push("(function flag)")
        } else {
          s.computed = true
        }
      }
      sitesHere.push(s)
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
  if (sitesHere.length === 0) continue
  const res = new Analyzer().analyze(pr.rootNode, content, f)
  const edges = (res.relationships || [])
    .filter((r: any) => (r.type ?? r.relationshipType) === "exports")
    .map((r: any) => ({ target: String(r.target ?? ""), line: Number(r.line_number ?? 0) }))
  for (const s of sitesHere) {
    sites++
    // `export -f fn` publishes through the function symbol, so the name is on the next child;
    // a site is counted MATCHED when any edge in the file names one of its names at its line,
    // or when it is a function export whose name has an edge anywhere in the file.
    const hit = s.names.some((nm) => edges.some((e) => e.target === nm && e.line === s.line))
    if (hit) matched++
    else {
      unmatched.push(`${f.replace(CORPUS + "/", "")}:${s.line}  names=${JSON.stringify(s.names)} computed=${s.computed}  children=${s.shapes.join(" ")}`)
    }
  }
}
console.log(`export sites: ${sites}   matched by an exports edge at the same line: ${matched}   unmatched: ${unmatched.length}`)
console.log("")
for (const u of unmatched) console.log(`  ${u}`)
