#!/usr/bin/env npx tsx
/**
 * SIZE — the protobuf `uses` class: where is the name declared, and does a candidate exist AT ALL?
 *
 * ## The two questions, which are different problems
 *
 * `uses` is 13,482 edges: 11,446 resolved · **1,065 ambiguous** · **971 unresolved** (residual 15.1%).
 * Ambiguity is *"which declaration"*; unresolved is *"no declaration"*. They are split separately here
 * because they earn different remedies.
 *
 * ## The classification, per edge, over the edge's own PROJECT (a repository — production's scope)
 *
 *   SAME-FILE-ONE     exactly 1 declaration of the name in the edge's own file
 *   SAME-FILE-MULTI   more than 1 in the edge's own file
 *   CROSS-FILE-ONLY   none in the own file, at least one elsewhere in the repo
 *   NO-CANDIDATE      nothing in the repo declares the name at all
 *
 * ## The cross-check that makes it credible
 *
 * The gate counts `ambiguous` BY DECLARATION and `unresolved` as "nothing answers", over the same
 * project scope. So this probe's own totals must reproduce the gate's two columns:
 *
 *   NO-CANDIDATE      should equal the gate's `unresolved` for `uses`
 *   MULTI (any shape) should equal the gate's `amb(decl)` for `uses`
 *
 * If they do not, this instrument is measuring a neighbouring class and the split means nothing. That
 * check is printed, not assumed.
 *
 * ## And a note the lead asked to carry
 *
 * `twin` 3,580 against `intended` 0 is NOT evidence of wrongness: `uses` is a READ-SITE type, and the
 * intent column is silent for it by construction (`LINE_IS_TARGET_LINE` covers contains/exports only).
 * Nothing here reads the twin column.
 *
 * Run: npx tsx validation/m14/fixtures/protobuf/probe-uses-split.ts
 */

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

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

// ── the key space: name -> repo -> {file -> count} ──────────────────────────────────────────
type Decl = Map<string, Map<string, number>>                       // file -> count
const byName = new Map<string, Map<string, Decl>>()                 // name -> repo -> file -> count
const fileNames = new Map<string, Set<string>>()                    // abs -> names it declares

for (const f of files) fileNames.set(f.abs, new Set())
for (const f of files) {
  let res: any
  try { res = await ASTEngine.parseFile(f.abs, readFileSync(f.abs, "utf8")) } catch { continue }
  const names = fileNames.get(f.abs)!
  for (const s of res?.symbols ?? []) {
    for (const n of [s?.name, s?.qualifiedName]) {
      if (typeof n !== "string" || !n) continue
      names.add(n)
      let repos = byName.get(n)
      if (!repos) byName.set(n, (repos = new Map()))
      let decls = repos.get(f.repo)
      if (!decls) repos.set(f.repo, (decls = new Map()))
      decls.set(f.abs, (decls.get(f.abs) ?? 0) + 1)
    }
  }
}

type Bucket = "SAME-FILE-ONE" | "SAME-FILE-MULTI" | "CROSS-FILE-ONLY" | "NO-CANDIDATE"
const tally: Record<Bucket, number> = { "SAME-FILE-ONE": 0, "SAME-FILE-MULTI": 0, "CROSS-FILE-ONLY": 0, "NO-CANDIDATE": 0 }
/** resolved/ambiguous/unresolved as the GATE would bucket them, for the cross-check. */
const gateBucket = { resolved: 0, ambiguous: 0, unresolved: 0 }
const noCandidateTargets = new Map<string, number>()
const noCandidateShape = { dotted: 0, bare: 0 }
let uses = 0

for (const f of files) {
  let res: any
  try { res = await ASTEngine.parseFile(f.abs, readFileSync(f.abs, "utf8")) } catch { continue }
  for (const e of res?.relationships ?? []) {
    if (String(e?.type) !== "uses") continue
    uses++
    const t = String(e?.target ?? "")
    const repos = byName.get(t)
    const decls = repos?.get(f.repo)
    const inRepo = decls ? [...decls.values()].reduce((a, b) => a + b, 0) : 0
    const inFile = decls?.get(f.abs) ?? 0

    let b: Bucket
    if (inRepo === 0) { b = "NO-CANDIDATE"; noCandidateTargets.set(t, (noCandidateTargets.get(t) ?? 0) + 1); if (t.includes(".")) noCandidateShape.dotted++; else noCandidateShape.bare++ }
    else if (inFile === 1 && inRepo === 1) b = "SAME-FILE-ONE"
    else if (inFile > 1) b = "SAME-FILE-MULTI"
    else if (inFile === 1) b = "SAME-FILE-ONE"
    else b = "CROSS-FILE-ONLY"
    tally[b]++

    // the gate's reading of the same facts
    if (inRepo === 0) gateBucket.unresolved++
    else if (inRepo > 1) gateBucket.ambiguous++
    else gateBucket.resolved++
  }
}

console.log("=".repeat(92))
console.log("SIZE — protobuf `uses`: where the name is declared, and whether a candidate exists at all")
console.log("=".repeat(92))
console.log(`population: ${files.length} .proto files across ${new Set(files.map((f) => f.repo)).size} repos`)
console.log(`uses edges: ${uses}`)
console.log("")
console.log("WHERE THE NAME IS DECLARED (per project = repository):")
for (const k of ["SAME-FILE-ONE", "SAME-FILE-MULTI", "CROSS-FILE-ONLY", "NO-CANDIDATE"] as Bucket[]) {
  console.log(`  ${k.padEnd(17)} ${String(tally[k]).padStart(6)}  (${uses ? (100 * tally[k] / uses).toFixed(1) : "-"}%)`)
}
console.log("")
console.log("CROSS-CHECK against the gate's own columns (this probe must reproduce them):")
console.log(`  this probe  ambiguous (multi) ${gateBucket.ambiguous}   unresolved (no candidate) ${gateBucket.unresolved}   single ${gateBucket.resolved}`)
console.log(`  the gate    amb(decl)          1,065   unresolved                  971   resolved 11,446   <-- uses row`)
console.log("")
console.log("THE UNRESOLVED CLASS — does a candidate exist AT ALL?")
console.log(`  NO-CANDIDATE (nothing in the repo declares the name): ${tally["NO-CANDIDATE"]}`)
console.log(`    of those, DOTTED targets: ${noCandidateShape.dotted}   BARE: ${noCandidateShape.bare}   (zig's equivalent was 87.6% dotted/external/file-shaped)`)
console.log(`  distinct no-candidate targets: ${noCandidateTargets.size}`)
console.log("top no-candidate targets:")
for (const [t, n] of [...noCandidateTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${t}`)
process.exit(0)
