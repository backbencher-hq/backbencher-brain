// The population the lane has never characterized: files the Zig grammar does not
// fully understand.
//
// tree-sitter is error-tolerant, so a file with ERROR nodes still yields a tree
// and the analyzer still publishes relationships for the parts it can read. That
// is why "219 of 3,839" was never a blocker on its own -- but it was also never
// EXPLAINED, and an unexplained population is exactly the thing this lane exists
// to remove. Either the analyzer is silently dropping relationships inside the
// broken region, or the grammar's blind spot is bounded and nameable.
//
// This measures it: how many files carry ERROR nodes, how many ERROR nodes per
// file, and what construct surrounds each one -- because "the grammar fails on
// 219 files" and "the grammar fails on 219 files in FIVE known shapes" are
// different claims, and only the second one can be decided about.
import * as fs from "fs"
import { init, parser } from "./zigw-harness"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const REPOS = ["zig", "zls", "ghostty"]

function collect(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) collect(p, out)
    else if (e.name.endsWith(".zig")) out.push(p)
  }
}

/** The nearest enclosing node that names a construct, for grouping. */
function contextOf(node: any): string {
  const chain: string[] = []
  let q = node.parent
  let hops = 0
  while (q && hops++ < 6) {
    chain.push(q.type)
    q = q.parent
  }
  return chain.slice(0, 3).join(" < ")
}

await init()
const files: string[] = []
for (const r of REPOS) collect(`${CORPUS}/${r}`, files)

const shapes = new Map<string, { files: Set<string>; n: number; sample: string }>()
let dirtyFiles = 0
const dirtyFilesList: string[] = []
let errorNodes = 0
let missingNodes = 0
const perRepo: Record<string, { total: number; dirty: number }> = {}

for (const f of files) {
  const repo = f.slice(`${CORPUS}/`.length).split("/")[0]
  perRepo[repo] ??= { total: 0, dirty: 0 }
  perRepo[repo].total++
  const src = fs.readFileSync(f, "utf8")
  const tree = parser().parse(src)
  let fileErrors = 0
  const walk = (n: any): void => {
    if (n.type === "ERROR" || n.isMissing) {
      if (n.isMissing) missingNodes++
      else {
        errorNodes++
        fileErrors++
        const key = n.isMissing ? `MISSING ${contextOf(n)}` : `ERROR ${contextOf(n)}`
        const prev = shapes.get(key)
        if (prev) {
          prev.n++
          prev.files.add(f)
        } else {
          shapes.set(key, { files: new Set([f]), n: 1, sample: `${f.slice(`${CORPUS}/`.length)}:${n.startPosition.row + 1} ${JSON.stringify(src.slice(n.startIndex, n.endIndex).slice(0, 70))}` })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c)
    }
  }
  walk(tree.rootNode)
  if (fileErrors > 0) {
    dirtyFiles++
    dirtyFilesList.push(f)
    perRepo[repo].dirty++
  }
  tree.delete()
}

console.log(`files: ${files.length}   with ERROR/MISSING nodes: ${dirtyFiles} (${((dirtyFiles / files.length) * 100).toFixed(1)}%)`)
console.log(`ERROR nodes: ${errorNodes}   MISSING nodes: ${missingNodes}`)
console.log(`\nper repo:`)
for (const [r, v] of Object.entries(perRepo)) console.log(`  ${r.padEnd(10)} ${v.dirty}/${v.total} dirty`)
// The DECISION-RELEVANT split. "The grammar has 93 dirty files" is not a finding;
// "the grammar has 93 dirty files, of which N are files that are SUPPOSED to fail
// to compile, M use inline assembly the grammar cannot read, and K are neither" is
// a finding, because only K can hide a dropped relationship in real code.
const buckets: Record<string, string[]> = { "intentionally invalid (compile_errors corpus)": [], "inline asm (a named grammar blind spot)": [], "OTHER \u2014 the only population that can hide a dropped relationship": [] }
for (const f of dirtyFilesList) {
  if (f.includes("/test/cases/compile_errors/") || f.includes("/test/cases/behavior/")) buckets["intentionally invalid (compile_errors corpus)"].push(f)
  else if (fs.readFileSync(f, "utf8").includes("asm ")) buckets["inline asm (a named grammar blind spot)"].push(f)
  else buckets["OTHER \u2014 the only population that can hide a dropped relationship"].push(f)
}
console.log("\nDECISION SPLIT:")
for (const [k, v] of Object.entries(buckets)) {
  console.log(`  ${String(v.length).padStart(3)} files  ${k}`)
  for (const f of v.slice(0, 12)) console.log(`          ${f.slice(`${CORPUS}/`.length)}`)
  if (v.length > 12) console.log(`          ... and ${v.length - 12} more`)
}
console.log(`\nshapes (ERROR/MISSING node by enclosing construct): ${shapes.size}`)
for (const [k, v] of [...shapes].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(v.n).padStart(5)} nodes in ${String(v.files.size).padStart(4)} files  ${k}`)
  console.log(`         e.g. ${v.sample}`)
}
