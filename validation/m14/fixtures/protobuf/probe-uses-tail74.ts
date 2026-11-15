#!/usr/bin/env npx tsx
/**
 * SIZE — the 74: the part of the `uses` NO-CANDIDATE class that is NOT the ruled `google.*` class.
 *
 * ## Why this is separated from the 971
 *
 * The NO-CANDIDATE class is 971 edges. **897 of them (92.4%) are `google.protobuf.*` / `google.rpc.*`
 * — the protobuf WELL-KNOWN TYPES, which protoc ships and no repository needs to vendor.** Those are a
 * RULED CLASS with a count and a falsifier: no rule can find a declaration that does not exist.
 *
 * The remaining **74 (22 `common.*` + 52 tail across 27 targets)** are the only part where a
 * cross-file resolution could plausibly reach: they are repo-local shared packages, and a name like
 * `common.EnterpriseMeta` may well be declared in a SIBLING repository or in a proto root the import
 * did not name.
 *
 * **Putting 897 ruled edges and 74 fixable edges behind one rule would look like one fix and be one
 * fix plus one ruling** — so they are priced separately and this probe measures only the 74.
 *
 * ## What it prices
 *
 * For each of the 74: is the target declared in ANOTHER repository of the corpus? That is the CEILING
 * of a cross-project resolution — a rule that resolves a name against the whole corpus rather than the
 * edge's own project. Targets declared NOWHERE are not reachable by any resolution and belong with the
 * 897 as a ruled class.
 *
 * **The ceiling is stated before anything is written, and nothing is written.**
 *
 * Run: npx tsx validation/m14/fixtures/protobuf/probe-uses-tail74.ts
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

/** name -> repo -> set of files declaring it */
const byName = new Map<string, Map<string, Set<string>>>()
for (const f of files) {
  let res: any
  try { res = await ASTEngine.parseFile(f.abs, readFileSync(f.abs, "utf8")) } catch { continue }
  for (const s of res?.symbols ?? []) {
    for (const n of [s?.name, s?.qualifiedName]) {
      if (typeof n !== "string" || !n) continue
      let repos = byName.get(n)
      if (!repos) byName.set(n, (repos = new Map()))
      let set = repos.get(f.repo)
      if (!set) repos.set(f.repo, (set = new Set()))
      set.add(f.rel)
    }
  }
}

const RULED = (t: string): boolean => t.startsWith("google.protobuf.") || t.startsWith("google.rpc.")

/** the 74's edges: NO-CANDIDATE in the edge's own repo, and not the ruled class */
const tail = new Map<string, { edges: number; repos: Set<string>; declaredIn: Set<string> }>()
let ruledEdges = 0
let tailEdges = 0

for (const f of files) {
  let res: any
  try { res = await ASTEngine.parseFile(f.abs, readFileSync(f.abs, "utf8")) } catch { continue }
  for (const e of res?.relationships ?? []) {
    if (String(e?.type) !== "uses") continue
    const t = String(e?.target ?? "")
    const repos = byName.get(t)
    const inRepo = repos?.get(f.repo)?.size ?? 0
    if (inRepo > 0) continue                       // has a candidate in its own project: not this class
    if (RULED(t)) { ruledEdges++; continue }
    tailEdges++
    let rec = tail.get(t)
    if (!rec) tail.set(t, (rec = { edges: 0, repos: new Set(), declaredIn: new Set() }))
    rec.edges++
    rec.repos.add(f.repo)
    for (const other of repos?.keys() ?? []) rec.declaredIn.add(other)
  }
}

// PACKAGE-RELATIVE RESOLUTION (protobuf's own rule). A reference may be written ELIDED relative to
// the enclosing package scope: `common.EnterpriseMeta` inside `hashicorp.consul.internal.*` names
// `hashicorp.consul.internal.common.EnterpriseMeta`. A first pass of this probe called such targets
// "declared NOWHERE" because it compared against the exact spelling — a NAME test, which is the
// mistake this programme keeps catching. The check below is therefore a SUFFIX match against the
// declaration's QUALIFIED name, which is the shape protobuf's own lookup has.
const qualSuffix = new Map<string, Set<string>>()   // target -> repos declaring it under a qualified name ending with it
for (const f of files) {
  const res: any = await (async () => { try { return await ASTEngine.parseFile(f.abs, readFileSync(f.abs, "utf8")) } catch { return undefined } })()
  for (const sym of res?.symbols ?? []) {
    const q = typeof sym?.qualifiedName === "string" ? sym.qualifiedName : ""
    if (!q) continue
    // every dotted suffix of the qualified name is a spelling a relative reference could use
    const parts = q.split(".")
    for (let i = 0; i < parts.length - 1; i++) {
      const suffix = parts.slice(i).join(".")
      let set = qualSuffix.get(suffix)
      if (!set) qualSuffix.set(suffix, (set = new Set()))
      set.add(f.repo)
    }
  }
}
for (const [t, r] of tail) for (const repo of qualSuffix.get(t) ?? []) r.declaredIn.add(repo)

const reachable = [...tail.entries()].filter(([, r]) => r.declaredIn.size > 0)
const nowhere = [...tail.entries()].filter(([, r]) => r.declaredIn.size === 0)
const reachableEdges = reachable.reduce((a, [, r]) => a + r.edges, 0)
const nowhereEdges = nowhere.reduce((a, [, r]) => a + r.edges, 0)

console.log("=".repeat(94))
console.log("SIZE — the 74: NO-CANDIDATE `uses` edges OUTSIDE the ruled `google.*` class")
console.log("=".repeat(94))
console.log(`population: ${files.length} .proto files across ${new Set(files.map((f) => f.repo)).size} repos`)
console.log("")
console.log(`NO-CANDIDATE class total: ${ruledEdges + tailEdges}  =  ruled google.* ${ruledEdges}  +  THE 74 ${tailEdges}`)
console.log(`distinct targets in the 74: ${tail.size}`)
console.log("")
console.log(`CEILING OF A CROSS-PROJECT RESOLUTION`)
console.log(`  declared in ANOTHER repo (reachable): ${reachableEdges} edges across ${reachable.length} targets`)
console.log(`  declared NOWHERE in the corpus:       ${nowhereEdges} edges across ${nowhere.length} targets  <- ruled, not fixable`)
console.log("")
console.log("REACHABLE — a cross-project rule could bind these:")
for (const [t, r] of reachable.sort((a, b) => b[1].edges - a[1].edges)) {
  console.log(`  ${String(r.edges).padStart(4)}  ${t.padEnd(46)} read in ${[...r.repos].join(",")}   declared in ${[...r.declaredIn].join(",")}`)
}
console.log("")
console.log("NOWHERE — no declaration anywhere; no resolution can reach them:")
for (const [t, r] of nowhere.sort((a, b) => b[1].edges - a[1].edges)) {
  console.log(`  ${String(r.edges).padStart(4)}  ${t.padEnd(46)} read in ${[...r.repos].join(",")}`)
}
process.exit(0)
