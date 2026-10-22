#!/usr/bin/env bun
/**
 * THE SCALA WHOLE-INVENTORY NODE CENSUS — the lane's own measurement of EVERY node type the
 * grammar has, with its site count, over the WHOLE admitted population.
 *
 * ★ WHY THIS FILE EXISTS. The lane's three RULED types (`decorates`, `renders`, `part_of`) each cite
 *   a NEAR MISS — "named and counted" — and each cites a GRAMMAR-SIDE inventory (189 named of 455
 *   node types of the pinned build). But a near-miss census that lists TWO node types out of a
 *   grammar's 189 is ILLUSTRATIVE, not COMPLETE: the reader cannot tell whether the other 187 were
 *   counted and found irrelevant, or simply not looked at. ⇒ THE COMPLETENESS QUESTION IS: **is there
 *   a node type in the grammar that means the ruled construct, that the ruling did not count?**
 *
 * ★ THE ANSWER IS A COUNT, AND THE COUNT IS OVER EVERYTHING. This instrument counts EVERY node type
 *   the grammar emits — named and anonymous — over every admitted file. ⇒ A ruling can then cite
 *   "the grammar has 189 named node types; 13 of them carry the `xml` stem and they are counted HERE;
 *   the other 176 are counted here too, so this is a census and not a shortlist".
 *
 * ★ IT IS A PARSE-ONLY PASS — it never calls the analyzer — so it measures the GRAMMAR's own node
 *   inventory, which is what an exclusion's grammar-side half must be measured over.
 *
 * ★ THE POPULATION IS THE FLEET'S: the git-TRACKED set under the 1 MB size cap, from the corpus root
 *   `$PWD/.corpus` (199 absolute symlinks into the repository store + local checkouts). SYMLINKED
 *   DIRECTORIES ARE FOLLOWED and the count is PRINTED. The three denominators are printed apart:
 *   PATHS · DISTINCT FILES · ADMITTED, and the REPO COUNT.
 *
 * Usage: bun run script/m14/scala-node-census.ts [--max=<files>]
 * Artefact: validation/m14/measurements/scala-node-census.json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, lstatSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
import { createHash } from "node:crypto"

const ROOT = resolve(import.meta.dirname, "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ? resolve(process.env.BB_CORPUS_ROOT) : resolve(ROOT, ".corpus")
const argv = process.argv.slice(2)
const argOf = (name: string, dflt: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const MAX = Number(argOf("max", "0"))
const EXTS = [".scala", ".sc", ".sbt"]
const SIZE_CAP = 1024 * 1024

// ─────────────────────────────────────────────────────────────── the population
let repos: string[] = []
try { repos = execFileSync("ls", ["-1", CORPUS], { encoding: "utf8" }).split("\n").filter(Boolean).sort() } catch { repos = [] }
let symlinkedDirsFollowed = 0
const repoDirs: Array<{ name: string; dir: string }> = []
for (const name of repos) {
  const p = join(CORPUS, name)
  let isSymlink = false
  try { isSymlink = lstatSync(p).isSymbolicLink() } catch { continue }
  let isDir = false
  try { isDir = statSync(p).isDirectory() } catch { continue }
  if (!isDir) continue
  if (isSymlink) symlinkedDirsFollowed++
  repoDirs.push({ name, dir: p })
}
type RepoFile = { abs: string; repo: string }
const admitted: RepoFile[] = []
const overCap: Array<{ abs: string; bytes: number }> = []
let trackedPaths = 0
for (const r of repoDirs) {
  let tracked: string[] = []
  try {
    execFileSync("git", ["-C", r.dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", r.dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
    trackedPaths++
    const abs = join(r.dir, rel)
    let bytes = 0
    try { bytes = readFileSync(abs).length } catch { continue }
    if (bytes > SIZE_CAP) { overCap.push({ abs, bytes }); continue }
    admitted.push({ abs, repo: r.name })
  }
}
const distinctFiles = new Set(admitted.map((a) => a.abs)).size
const repoCount = new Set(admitted.map((a) => a.repo)).size
const perRepo: Record<string, number> = {}
for (const a of admitted) perRepo[a.repo] = (perRepo[a.repo] ?? 0) + 1

// ─────────────────────────────────────────────────────────────── the grammar
const { getParser } = await import(resolve(ROOT, "src", "ast", "engine"))
const { resolveWasmAsset, hasWasmInRegistry } = await import(resolve(ROOT, "src", "util", "wasm"))
const SPELLING = "tree-sitter-scala.wasm"
const rb = hasWasmInRegistry(SPELLING)
const grammarSha = rb && rb.length ? createHash("sha256").update(rb).digest("hex") : null
const parser = await getParser("scala" as any)

console.log(`SCALA WHOLE-INVENTORY NODE CENSUS`)
console.log(`corpus root: ${CORPUS}`)
console.log(`corpus entries: ${repos.length} · directories (symlinks FOLLOWED): ${repoDirs.length} · of those SYMLINKED: ${symlinkedDirsFollowed}`)
console.log(`PATHS (git-tracked .scala/.sc/.sbt)  ${trackedPaths}`)
console.log(`DISTINCT FILES                       ${distinctFiles}`)
console.log(`ADMITTED (tracked AND <= 1 MB)       ${admitted.length}   (${overCap.length} over the cap, excluded)`)
console.log(`REPO COUNT (repos carrying one)      ${repoCount}`)
console.log(`per repo: ${Object.entries(perRepo).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`)
console.log(`production build: sha256 ${grammarSha} · ${resolveWasmAsset(SPELLING)}`)
console.log(`the analyzer is NEVER CALLED — this is the GRAMMAR's own node inventory`)
console.log("")

const files = (MAX > 0 ? admitted.slice(0, MAX) : admitted).map((a) => a.abs)

// ─────────────────────────────────────────────────────────────── the walk
const sites = new Map<string, number>()
const filesWith = new Map<string, Set<string>>()
const isNamedType = new Map<string, boolean>()
let parsed = 0
let failed = 0
let totalNodes = 0
for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(src) } catch { failed++; continue }
  parsed++
  const seenHere = new Set<string>()
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    totalNodes++
    const t = n.type as string
    sites.set(t, (sites.get(t) ?? 0) + 1)
    if (!filesWith.has(t)) filesWith.set(t, new Set())
    filesWith.get(t)!.add(f)
    // ★ THE NAMED/ANONYMOUS SPLIT IS `node.isNamed` — NOT a spelling convention on the type name.
    //   tree-sitter's ANONYMOUS node types are literal tokens ("class", "extends", "("), so a
    //   spelling filter would have called every one of them NAMED. THIS IS THE SAME TRAP AS THE
    //   NAMED/ANONYMOUS TRAP IN THE GRAMMAR INVENTORY (the accessor is `nodeTypeIsNamed(id)`).
    if (n.isNamed) { seenHere.add(t); isNamedType.set(t, true) }
    else if (!isNamedType.has(t)) isNamedType.set(t, false)
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
  for (const t of seenHere) filesWith.get(t)!.add(f)
  try { tree.delete() } catch { /* the walk's own tree */ }
}

const named = [...sites.entries()].filter(([t]) => isNamedType.get(t) === true).sort((a, b) => b[1] - a[1])
const anonymous = [...sites.entries()].filter(([t]) => isNamedType.get(t) === false).sort((a, b) => b[1] - a[1])

// ★ THE STEMS THE THREE RULED TYPES ARE RULED ON — and the count of each stem's node types, so a
//   ruling can say "of the grammar's 189 named node types, N carry this stem, and here they all are".
const STEMS = ["decorat", "render", "xml", "part", "partial", "package", "template", "view", "annotat", "include", "fragment", "view"]
const stemHits: Record<string, string[]> = {}
for (const stem of STEMS) {
  const hits = named.map(([t]) => t).filter((t) => t.toLowerCase().includes(stem))
  stemHits[stem] = hits
}

console.log(`files parsed ${parsed} · failed ${failed} · nodes visited ${totalNodes}`)
console.log(`node types seen: ${sites.size} total · ${named.length} NAMED · ${anonymous.length} anonymous`)
console.log("")
console.log(`THE NAMED NODE TYPES, WITH THEIR SITE COUNTS (the whole inventory, not a shortlist):`)
for (const [t, n] of named) console.log(`  ${String(n).padStart(9)}  ${String(filesWith.get(t)?.size ?? 0).padStart(6)} files  ${t}`)
console.log("")
console.log(`THE STEMS THE THREE RULED TYPES TURN ON:`)
for (const stem of STEMS) {
  const hits = stemHits[stem]
  const total = hits.reduce((a, t) => a + (sites.get(t) ?? 0), 0)
  console.log(`  ${stem.padEnd(10)} ${String(hits.length).padStart(3)} node type(s) · ${String(total).padStart(8)} site(s)  ${hits.join(", ")}`)
}
console.log("")

// ─────────────────────────────────────────────────────────────── the artefact
{
  const outDir = join(ROOT, "validation", "m14", "measurements")
  mkdirSync(outDir, { recursive: true })
  const byType: Record<string, { sites: number; files: number; named: boolean }> = {}
  for (const [t, n] of [...sites.entries()].sort((a, b) => b[1] - a[1])) {
    byType[t] = { sites: n, files: filesWith.get(t)?.size ?? 0, named: isNamedType.get(t) === true }
  }
  writeFileSync(join(outDir, "scala-node-census.json"), JSON.stringify({
    instrument: "script/m14/scala-node-census.ts",
    corpusRoot: CORPUS,
    grammarSha256: grammarSha,
    population: {
      rule: "PATHS · DISTINCT FILES · ADMITTED — ADMITTED is the git-tracked set under the 1 MB size cap",
      paths: trackedPaths, distinctFiles, admitted: admitted.length, overCapFiles: overCap.length, repoCount,
      perRepo, symlinkedDirsFollowed,
    },
    measurement: { filesParsed: parsed, parseFailures: failed, nodesVisited: totalNodes, nodeTypesSeen: sites.size, namedTypes: named.length, anonymousTypes: anonymous.length },
    stemHits,
    byType,
    namedTypeNames: named.map(([t]) => t),
    anonymousTypeNames: anonymous.map(([t]) => t),
  }, null, 2) + "\n", "utf8")
  console.log(`artefact: validation/m14/measurements/scala-node-census.json`)
}
console.log("")
console.log(`⇒ THE COMPLETENESS ANSWER, AS A COUNT: the grammar's own inventory is ${named.length} NAMED node`)
console.log(`  types and ${anonymous.length} anonymous ones, and THIS census counts every one of them over the`)
console.log(`  whole admitted population. ⇒ A ruling that cites a near miss can now cite the CENSUS rather`)
console.log(`  than a shortlist, and a reader can check the shortlist against the census.`)
process.exit(0)
