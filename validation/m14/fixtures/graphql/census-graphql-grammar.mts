/**
 * GRAPHQL GRAMMAR CENSUS — what the pinned grammar produces, and what the analyzer emits.
 *
 * ## Why this file exists
 *
 * `script/m14/spec/graphql-completeness.json` did not exist, so this lane has never declared its
 * gaps in machine-readable form: the board reads "no spec", which is not the same as zero. A spec
 * written from prose would be the same defect one level down, so this census produces the two
 * numbers the spec's buckets need:
 *
 *   WHAT THE GRAMMAR PRODUCES   every node type observed over the whole admitted corpus, parsed
 *                               through the production path (`getParser` -> `parse`). A type in
 *                               this list and in the analyzer's vocabulary is `handled_verified`;
 *                               a type the grammar produces that the analyzer never consults is a
 *                               candidate `internal_silent` (structural plumbing) and is printed
 *                               so it can be classified rather than ignored.
 *   WHAT THE ANALYZER EMITS     the ten relationship types, with counts, so the firing instrument's
 *                               line is reproducible from this file rather than quoted.
 *
 * The grammar is the VENDORED, PATCHED `tree-sitter-graphql` (`wasm/tree-sitter-graphql.wasm`,
 * sources under `grammars/tree-sitter-graphql/`), whose node types are PascalCase by contract.
 *
 * CLI: bun validation/m14/fixtures/graphql/census-graphql-grammar.mts [--corpus gql-gqlgen] [--all]
 *
 * Read-only.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const REPO_ROOT = process.env.BB_REPO || join(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const ONE_REPO = flag("corpus")
const ALL = argv.includes("--all")
const EXTS = [".graphql", ".gql"]

function walk(dir: string): string[] {
  const out: string[] = []
  const rec = (d: string, depth: number) => {
    if (depth > 20) return
    let ents
    try {
      ents = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".git") rec(p, depth + 1)
      } else if (EXTS.some((x) => e.name.endsWith(x))) {
        try {
          if (statSync(p).size < 1_000_000) out.push(p)
        } catch {
          /* unreadable */
        }
      }
    }
  }
  rec(dir, 0)
  return out
}

/** Tracked files per repository — the population rule the gate uses, so the two are comparable. */
function trackedFiles(repo: string): string[] {
  const dir = join(CR, repo)
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    return walk(dir)
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    return walk(dir)
  }
  const out: string[] = []
  for (const rel of tracked) {
    if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
    const abs = join(dir, rel)
    try {
      if (statSync(abs).size < 1_000_000) out.push(abs)
    } catch {
      /* absent from worktree */
    }
  }
  return out
}

const files = ONE_REPO ? trackedFiles(ONE_REPO) : ALL ? readdirSync(CR).sort().flatMap((r) => trackedFiles(r)) : walk(join(CR, "gql-gqlgen"))
files.sort()

const engine = await import(`${REPO_ROOT}/src/ast/engine.ts`)
const mod = await import(`${REPO_ROOT}/src/ast/real-graphql-analyzer.ts`)
const Analyzer: any = Object.values(mod).find((v: any) => typeof v === "function" && (v as any).name.endsWith("Analyzer"))
if (!Analyzer) throw new Error("no analyzer class exported")
const { getParser } = engine

const ALL_TYPES = ["calls", "extends", "implements", "uses", "imports", "exports", "contains", "references", "overrides", "instantiates"] as const
const nodeTypeFiles = new Map<string, Set<string>>()
const nodeTypeCount = new Map<string, number>()
const edgeCount = new Map<string, number>()
const edgeFiles = new Map<string, Set<string>>()
const symbolKinds = new Map<string, number>()
let parsed = 0
const failures: string[] = []

for (const f of files) {
  let content: string
  try {
    content = readFileSync(f, "utf8")
  } catch {
    failures.push(f)
    continue
  }
  let root: any
  try {
    const parser = await getParser("graphql")
    const pr = await parser.parse(content, f)
    root = pr.rootNode
  } catch (e) {
    failures.push(`${f}: parse ${String(e).slice(0, 60)}`)
    continue
  }
  parsed++
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    nodeTypeCount.set(n.type, (nodeTypeCount.get(n.type) ?? 0) + 1)
    let s = nodeTypeFiles.get(n.type)
    if (!s) nodeTypeFiles.set(n.type, (s = new Set()))
    s.add(f)
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
  let res: any
  try {
    res = new Analyzer().analyze(root, content, f)
  } catch (e) {
    failures.push(`${f}: analyze ${String(e).slice(0, 60)}`)
    continue
  }
  for (const sym of res.symbols ?? []) symbolKinds.set(String(sym.kind), (symbolKinds.get(String(sym.kind)) ?? 0) + 1)
  for (const rel of res.relationships ?? []) {
    const t = String(rel.type ?? rel.relationshipType ?? "")
    if (!ALL_TYPES.includes(t as any)) continue
    edgeCount.set(t, (edgeCount.get(t) ?? 0) + 1)
    let s = edgeFiles.get(t)
    if (!s) edgeFiles.set(t, (s = new Set()))
    s.add(f)
  }
}

console.log(`GRAPHQL GRAMMAR CENSUS  population=${files.length} tracked .graphql/.gql files${ONE_REPO ? ` (repo ${ONE_REPO})` : ALL ? " (all repos)" : ""}`)
console.log(`  parsed=${parsed}  failures=${failures.length}${failures.length ? "  e.g. " + failures.slice(0, 3).join(" | ") : ""}`)
console.log(`  distinct node types observed: ${nodeTypeCount.size}`)
console.log("")
console.log("NODE TYPES BY FILE COUNT (the grammar's actual vocabulary on this corpus):")
for (const [t, n] of [...nodeTypeCount.entries()].sort((a, b) => (nodeTypeFiles.get(b[0])!.size - nodeTypeFiles.get(a[0])!.size) || b[1] - a[1])) {
  console.log(`  ${String(nodeTypeFiles.get(t)!.size).padStart(5)} files / ${String(n).padStart(7)} nodes  ${t}`)
}
console.log("")
console.log("RELATIONSHIPS EMITTED (production path):")
for (const t of ALL_TYPES) {
  const n = edgeCount.get(t) ?? 0
  console.log(`  ${t.padEnd(13)} ${String(n).padStart(7)} edges in ${String(edgeFiles.get(t)?.size ?? 0).padStart(4)} files${n === 0 ? "   <-- SILENT" : ""}`)
}
console.log("")
console.log("SYMBOL KINDS EMITTED:")
for (const [k, n] of [...symbolKinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(7)}  ${k}`)
