/**
 * INCLUDE-CLAIM CROSS-TAB — php's `include`/`require` edges carry a PATH target, and the gate can
 * verify one statement about it: "this target names a file of the project" (`FILE_CLAIM_KEY`),
 * checked against the project's ADMITTED file list. A miss REFUTES, so the claim may only be emitted
 * where it verifies.
 *
 * This reproduces BOTH sides — json's candidate arithmetic, the gate's admitted-file facts — plus the
 * filesystem test the analyzer would gate the claim on, and cross-tabulates them.
 *
 *   npx tsx validation/m14/fixtures/php/tools/include-claim-crosstab.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
// THE PRODUCTION PATH.
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

const repos: { repo: string; files: string[]; admitted: Set<string> }[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const files: string[] = []
  const admitted = new Set<string>()
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".php")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
    admitted.add(rel.split("/").join("/"))
  }
  files.sort()
  if (files.length > 0) repos.push({ repo: dir, files, admitted })
}

/** json's `fileRefCandidate`, transcribed: a literal relative path folded onto the file's directory,
 *  or null when it is not a path (URL, absolute) or escapes the project. */
function candidateFrom(written: string, selfRel: string, toRoot: boolean): string | null {
  const w = written.trim()
  if (w.length === 0 || w.length > 300) return null
  if (w.includes("://") || w.startsWith("/") || w.startsWith("~")) return null
  for (const ch of [" ", "\t", "*", "?", "<", ">", "|", "{", "}", "$"]) if (w.includes(ch)) return null
  const cut = selfRel.lastIndexOf("/")
  const base = toRoot ? "" : cut < 0 ? "" : selfRel.slice(0, cut + 1)
  const out: string[] = []
  for (const seg of (base + w).split("/")) {
    if (seg.length === 0 || seg === ".") continue
    if (seg === "..") { if (out.length === 0) return null; out.pop(); continue }
    out.push(seg)
  }
  return out.length > 0 ? out.join("/") : null
}
const isFile = (p: string): boolean => { try { return statSync(p).isFile() } catch { return false } }

let edges = 0, noCandidate = 0, verify = 0, refute = 0
let fsTrue = 0, fsFalse = 0, fsTrueRefuted = 0, fsFalseVerified = 0
const verifyExamples: string[] = []
const refuteExamples: string[] = []

for (const { repo, files, admitted } of repos) {
  for (const abs of files) {
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    const selfRel = path.relative(repo, abs).split(path.sep).join("/")
    for (const r of res.relationships ?? []) {
      if (String(r.type) !== "imports") continue
      const md = (r.metadata ?? {}) as any
      if (md.relationshipType !== "include_path") continue
      edges++
      const tgt = String(r.target ?? "")
      const cands = [...new Set([candidateFrom(tgt, selfRel, false), candidateFrom(tgt, selfRel, true)].filter((c): c is string => c !== null))]
      if (cands.length === 0) { noCandidate++; continue }
      const hit = cands.find((c) => admitted.has(c)) ?? null
      const fs = cands.some((c) => isFile(path.join(repo, c)))
      if (fs) fsTrue++; else fsFalse++
      if (hit !== null) {
        verify++
        if (verifyExamples.length < 6) verifyExamples.push(`${tgt.padEnd(44)} -> ${hit}   (${selfRel})`)
      } else {
        refute++
        if (refuteExamples.length < 10) refuteExamples.push(`${tgt.padEnd(44)} -> ${cands.join(" | ")}   (${selfRel})`)
      }
      if (fs && hit === null) fsTrueRefuted++
      if (!fs && hit !== null) fsFalseVerified++
    }
  }
}

console.log(`php include-path claim cross-tab — whole admitted population`)
console.log(`include/require imports edges: ${edges}`)
console.log(`  candidate computable and the project VERIFIES it : ${verify}`)
console.log(`  candidate computable but the project REFUTES it  : ${refute}`)
console.log(`  no candidate (URL/absolute/escapes/not a path)   : ${noCandidate}`)
console.log(`\nFS CROSS-TAB: fs test true ${fsTrue} · false ${fsFalse}`)
console.log(`  fs TRUE but gate REFUTES  : ${fsTrueRefuted}`)
console.log(`  fs FALSE but gate VERIFIES: ${fsFalseVerified}`)
console.log(`\nVERIFY examples:`)
for (const e of verifyExamples) console.log(`  ${e}`)
console.log(`\nwould-REFUTE examples:`)
for (const e of refuteExamples) console.log(`  ${e}`)
