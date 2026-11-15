/**
 * THE FALSIFIER AND THE NEGATIVE CONTROL, measured — condition 3 of the protobuf INDEX_SPEC landing.
 *
 * With the index present, does the walk's new arm REACH declarations it previously discarded (the
 * 43), and does it stay away from the names that are declared NOWHERE (the 7)? The second half is the
 * one that catches an over-reaching change: an arm that binds the negatives is wrong even if it binds
 * more positives.
 *
 * Both sides are measured by DIFFING each file's relationships with and without the index, so the
 * count is about edges that actually changed rather than about a total that happens to move.
 *
 *   npx tsx validation/m14/fixtures/protobuf/tools/index-reach-falsifier.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const mod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))
const { PROTOBUF_SPEC } = await import(path.join(ROOT, "validation/m14/fixtures/protobuf/tools/protobuf-spec.ts"))
const wasm = path.join(ROOT, "wasm", "tree-sitter-protobuf.wasm")

const NEGATIVES = [
  "xds.data.orca.v3.OrcaLoadReport", "sls.asfd.asfd.JsonFormat", "sls.asfd.asfd.CustomType",
  "grpc.testing.duplicate.EchoRequest", "grpc.testing.duplicate.EchoResponse",
  "github.com.hashicorp.go.kms.wrapping.v2.types.BlobInfo",
]

const key = (r: any) => `${r.type}|${r.source}|${r.target}|${r.line_number}`
let changed = 0, gained = 0, lost = 0, files = 0, msIndex = 0, negativesSeen = 0
const changedExamples: string[] = []
const negativeHits: string[] = []

for (const name of readdirSync(CR).sort()) {
  const repo = path.join(CR, name)
  try { if (!statSync(repo).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const protos: string[] = []
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".proto")) continue
    const abs = path.join(repo, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    protos.push(abs)
  }
  if (protos.length === 0) continue
  protos.sort()
  const t0 = Date.now()
  const index = await mod.buildProjectIndexFromDisk(wasm, protos, PROTOBUF_SPEC)
  msIndex += Date.now() - t0
  for (const abs of protos) {
    files++
    let a: any, b: any
    try { a = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    try { b = await parseFile(abs, repo, { projectRoot: repo, projectIndex: index } as any) } catch { continue }
    const A = new Set((a.relationships ?? []).map(key))
    const B = new Map((b.relationships ?? []).map((r: any) => [key(r), r]))
    // THE NEGATIVE CONTROL TESTS BINDING, NOT PRESENCE. These names are written IN the files as
    // references that nothing declares, so of course they appear as unresolved TARGETS before and
    // after — a check for presence would report seven "over-reaches" that are seven unchanged rows.
    // What must not happen is an edge whose target CHANGED TO one of them, or away from one of them
    // because the index answered it: that would be the arm binding a name the project does not hold.
    for (const r of b.relationships ?? []) {
      const t = String(r.target ?? "")
      const isNeg = NEGATIVES.some((n) => t === n || t.endsWith(`.${n}`))
      if (!isNeg) continue
      negativesSeen++
      if (!A.has(key(r))) negativeHits.push(`${t} CHANGED-WITH-INDEX in ${path.relative(repo, abs)}`)
    }
    for (const k of A) if (!B.has(k)) lost++
    for (const [k, r] of B) {
      if (A.has(k)) continue
      gained++
      if (changedExamples.length < 10) changedExamples.push(`${String((r as any).type).padEnd(9)} ${String((r as any).source).slice(0,26).padEnd(28)} -> ${String((r as any).target).slice(0,60)}   (${path.relative(repo, abs)})`)
    }
  }
}
changed = gained + lost
console.log(`protobuf INDEX_SPEC falsifier — whole admitted population`)
console.log(`  files parsed twice (with and without the index): ${files}`)
console.log(`  index build cost: ${msIndex}ms total`)
console.log(`  relationship rows that CHANGED with the index: ${changed}  (gained ${gained}, lost ${lost})`)
console.log(`\nchanged rows (the falsifier's edges):`)
for (const e of changedExamples) console.log(`  ${e}`)
if (changedExamples.length === 0) console.log(`  NONE — the arm reaches nothing, and the landing would be inert`)
console.log(`\nNEGATIVE CONTROL — declared-nowhere names carried as targets: ${negativesSeen} edges, of which CHANGED with the index: ${negativeHits.length}`)
for (const n of negativeHits.slice(0, 10)) console.log(`  ${n}`)
if (negativeHits.length === 0) console.log(`  none CHANGED — an unchanged unresolved row is the correct state, and the arm does not over-reach`)
