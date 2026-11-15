#!/usr/bin/env npx tsx
/**
 * SIZE — the protobuf `imports` class: how many of the 1,574 name a `.proto` the population carries?
 *
 * ## The cause
 *
 * A protobuf import is a FILE PATH — `import "google/protobuf/timestamp.proto";` — and the store's
 * key space is DECLARATIONS. A path can never answer against it, so the type is 100% unresolved by
 * construction (1,574 of 1,574). Seven lanes share the cause (the lead's tally: 14,890 edges).
 *
 * ## The question this answers, BEFORE any claim is written
 *
 * A file claim REFUTES on a miss and `extFAIL` must stay 0, so the claimable subset must be counted
 * first — it is the CEILING, not a target. bash measured its own equivalent at 44 of 787 (5.6%) and
 * declined; yaml's turned 82% of its `extQ` into a fix. protobuf's number is unknown.
 *
 * ## Resolution, deliberately generous so the number is a CEILING rather than a guess
 *
 * An import path is resolved against an IMPORT ROOT, which protoc takes from `-I`, not from the file's
 * own directory. The population carries no `-I` list, so three candidate readings are tried and the
 * edge counts as CARRIED if ANY hits:
 *
 *   ROOT-RELATIVE   `<repo>/<path>`                       — the import root is the repository root
 *   FILE-RELATIVE   `<dir(importing file)>/<path>`        — the import root is the file's own directory
 *   SUFFIX          any admitted file in the SAME repo whose repo-relative path ends with `/<path>`
 *                   — the import root is somewhere between, which is what a vendored
 *                     `third_party/google/protobuf/timestamp.proto` looks like
 *
 * An edge that misses all three is REFUTED under every root, so the split is a real ceiling.
 *
 * ## The residue, named
 *
 * `google/protobuf/*.proto` are the WELL-KNOWN TYPES, which protoc ships and no repository needs to
 * vendor. They are counted separately, and whether the importing repo vendors them is reported, because
 * that is what decides whether they are a ruled class or a fixable one.
 *
 * Run: npx tsx validation/m14/fixtures/protobuf/probe-imports-split.ts
 */

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WELL_KNOWN = "google/protobuf/"

/** The population, by the gate's own rule: git-tracked, `.proto`, <= 1 MiB. */
interface F { abs: string; repo: string; rel: string }
const files: F[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".proto")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
    files.push({ abs, repo: name, rel })
  }
}

/** repo -> the set of that repo's admitted relative paths (for ROOT-RELATIVE and SUFFIX). */
const byRepo = new Map<string, Set<string>>()
for (const f of files) {
  let s = byRepo.get(f.repo)
  if (!s) byRepo.set(f.repo, (s = new Set()))
  s.add(f.rel)
}

let imports = 0
let carried = 0
let refuted = 0
const how = { root: 0, file: 0, suffix: 0 }
let wkImports = 0, wkCarried = 0, wkRefuted = 0
let otherImports = 0, otherCarried = 0, otherRefuted = 0
const refutedTargets = new Map<string, number>()
const wkVendoredRepos = new Set<string>()
const refutedExamples: string[] = []

for (const f of files) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  let res: any
  try { res = await ASTEngine.parseFile(f.abs, text) } catch { continue }
  const repoFiles = byRepo.get(f.repo) ?? new Set<string>()
  const dir = path.posix.dirname(f.rel)

  for (const e of res?.relationships ?? []) {
    if (String(e?.type) !== "imports") continue
    imports++
    const p = String(e?.target ?? "")
    const isWK = p.startsWith(WELL_KNOWN)
    if (isWK) wkImports++; else otherImports++

    // ROOT-RELATIVE
    let hit: "root" | "file" | "suffix" | undefined
    if (repoFiles.has(p)) hit = "root"
    else if (dir && dir !== "." && repoFiles.has(`${dir}/${p}`)) hit = "file"
    else {
      for (const cand of repoFiles) if (cand.endsWith(`/${p}`)) { hit = "suffix"; break }
    }

    if (hit) {
      carried++; how[hit]++
      if (isWK) { wkCarried++; wkVendoredRepos.add(f.repo) } else otherCarried++
    } else {
      refuted++
      if (isWK) wkRefuted++; else otherRefuted++
      refutedTargets.set(p, (refutedTargets.get(p) ?? 0) + 1)
      if (refutedExamples.length < 12) refutedExamples.push(`${f.repo}/${f.rel} -> ${p}`)
    }
  }
}

console.log("=".repeat(92))
console.log("SIZE — protobuf `imports`: the claimable subset (CEILING), verify vs refute")
console.log("=".repeat(92))
console.log(`population: ${files.length} .proto files across ${byRepo.size} repos (the gate's own admission rule)`)
console.log(`imports edges: ${imports}`)
console.log("")
console.log(`  CARRIED  the path resolves to an admitted .proto  -> a claim could VERIFY: ${carried} (${imports ? (100 * carried / imports).toFixed(1) : "-"}%)`)
console.log(`      by resolution: ROOT-RELATIVE ${how.root} · FILE-RELATIVE ${how.file} · SUFFIX ${how.suffix}`)
console.log(`  REFUTED  no admitted .proto answers under any root -> a claim would FAIL: ${refuted} (${imports ? (100 * refuted / imports).toFixed(1) : "-"}%)`)
console.log("")
console.log("WELL-KNOWN TYPES (`google/protobuf/*`) — the named residue:")
console.log(`  edges ${wkImports} of ${imports} (${imports ? (100 * wkImports / imports).toFixed(1) : "-"}%)`)
console.log(`    carried by a vendored copy: ${wkCarried}   refuted: ${wkRefuted}`)
console.log(`    repos vendoring them: ${wkVendoredRepos.size > 0 ? [...wkVendoredRepos].join(", ") : "NONE — no repo in the corpus carries a copy"}`)
console.log(`  non-well-known imports: ${otherImports}   carried ${otherCarried}   refuted ${otherRefuted}`)
console.log("")
console.log(`distinct refuted targets: ${refutedTargets.size}`)
console.log("top refuted targets:")
for (const [t, n] of [...refutedTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${t}`)
console.log("")
console.log("refuted examples:")
for (const e of refutedExamples) console.log(`  ${e}`)
process.exit(0)
