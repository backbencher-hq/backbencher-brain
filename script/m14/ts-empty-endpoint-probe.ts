/**
 * R7 CHASE — where do the census's non-zero "empty endpoints" come from?
 *
 * The 4-corpus census printed emptyEndpoints 0 / 0 / 2 / 3 (element-plus, rxjs,
 * nest, typeorm). The honesty contract's "Silence is guilt" rule makes a
 * non-zero count a finding, so it gets chased to a file and a line rather than
 * carried forward. This probe prints the offending edges verbatim.
 *
 * Zero regular expressions. String equality and index arithmetic only.
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../src/ast/pool-worker"
import { isDeclarationFile, isTsSource, isFallbackResult } from "./ts-lane-corpus"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const REPO = argOf("--repo") ?? "nest"
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(512 * 1024))

const dir = path.join(CR, REPO)
const admitted: string[] = []
for (const rel of execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean).sort()) {
  if (!isTsSource(rel) || isDeclarationFile(rel)) continue
  const abs = path.join(dir, rel)
  try { if (fs.statSync(abs).size > MAX_BYTES) continue } catch { continue }
  admitted.push(abs)
}
console.log(`population ${REPO}: ${admitted.length} admitted implementation files (cap ${MAX_BYTES} B)`)

const hits: string[] = []
let parsed = 0, failed = 0, fallback = 0
for (const abs of admitted) {
  let r: any
  try { r = await parseFile(abs, dir) } catch { failed++; continue }
  parsed++
  if (isFallbackResult(r)) { fallback++; continue }
  for (const rel of r.relationships ?? []) {
    const s = rel.source ?? ""
    const t = rel.target ?? ""
    if (s !== "" && t !== "") continue
    const label = String(rel.type ?? rel.relationshipType ?? "?")
    hits.push(`${path.relative(dir, abs)}  [${label}]  src=${JSON.stringify(s)}  tgt=${JSON.stringify(t)}  line=${rel.line_number ?? "absent"}  ev=${(rel.metadata as any)?.evidenceClass ?? "absent"}`)
  }
}
console.log(`parsed ${parsed}  failed ${failed}  regex-fallback ${fallback}`)
console.log(`\nEMPTY-ENDPOINT EDGES: ${hits.length}`)
for (const h of hits) console.log("  " + h)
