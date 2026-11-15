/**
 * sol24-mixes-counters — sums the analyzer's OWN `metadata.mixesIn` counters over the whole admitted
 * solidity population, at PER-FILE scope (no project index).
 *
 * WHY. The spec claims a split of the 124 `using_directive` sites into 4 braced-set, 54 no-host and
 * 66 host-not-declared (per file) / 39 host-not-declared + 27 rows (with the project index). The
 * construct-side split is in the census artifact; THIS reads the analyzer's own buckets, so a reader
 * does not have to trust that the census and the code agree about what was skipped and why.
 *
 * A hold-one-parser loop is the hazard the census header names, so the grammar is acquired PER FILE
 * and the tree is deleted each time.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealSolidityAnalyzer } from "../../../src/ast/real-solidity-analyzer"

const CORPUS = process.env.BB_CORPUS_ROOT ?? path.resolve(import.meta.dir, "../../../.corpus")
const SIZE_CAP = 1024 * 1024 // worker's full-AST cap, the same admission rule the gate uses

/** the gate's own admission rule: git-tracked `.sol` files of every repository under the corpus root */
const rels: string[] = []
for (const name of readdirSync(CORPUS).sort()) {
  const dir = path.join(CORPUS, name)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".sol")) continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > SIZE_CAP) continue
    } catch {
      continue
    }
    rels.push(path.join(name, rel))
  }
}
rels.sort()
if (rels.length === 0) {
  console.error(`no .sol files tracked under ${CORPUS}`)
  process.exit(2)
}

const sum: Record<string, number> = {
  files: 0,
  parsed: 0,
  failed: 0,
  usingSites: 0,
  rows: 0,
  skippedNoHost: 0,
  skippedHostNotDeclared: 0,
  skippedBracedSet: 0,
}
const an = new RealSolidityAnalyzer()
const perFile: string[] = []

for (const rel of rels) {
  const abs = path.join(CORPUS, rel)
  let content = ""
  try {
    content = readFileSync(abs, "utf8")
  } catch {
    sum.failed++
    continue
  }
  const parser: any = await ASTEngine.getParser("solidity")
  let tree: any
  try {
    tree = parser.parse(content, abs)
  } catch (e: any) {
    sum.failed++
    continue
  }
  if (!tree?.rootNode) {
    sum.failed++
    tree?.delete?.()
    continue
  }
  sum.parsed++
  const r: any = an.analyze(tree.rootNode, content, abs)
  const m: any = r?.metadata?.mixesIn
  if (m && Number(m.usingSites ?? 0) > 0) {
    perFile.push(`${rel}: ${m.usingSites} sites, ${m.rows} rows, noHost ${m.skippedNoHost}, hostNotDeclared ${m.skippedHostNotDeclared}, braced ${m.skippedBracedSet}`)
    for (const k of ["usingSites", "rows", "skippedNoHost", "skippedHostNotDeclared", "skippedBracedSet"]) {
      sum[k] += Number(m[k] ?? 0)
    }
  }
  tree.delete()
}

sum.files = rels.length
console.log(`files discovered ${rels.length} · parsed ${sum.parsed} · failed ${sum.failed}`)
console.log(`using_directive sites ${sum.usingSites} = rows ${sum.rows} + noHost ${sum.skippedNoHost} + hostNotDeclared ${sum.skippedHostNotDeclared} + bracedSet ${sum.skippedBracedSet}`)
console.log(`files carrying at least one using_directive: ${perFile.length}`)
for (const l of perFile) console.log("  " + l)
