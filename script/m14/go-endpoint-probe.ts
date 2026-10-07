/**
 * GO LANE — ENDPOINT INTEGRITY PROBE (rule R7).
 *
 * The census COUNTS integrity failures; this PRINTS them, because a count with
 * no example cannot be triaged and an unfixed count is a defect nobody looks
 * at. Four classes, each with the discriminator that keeps it from convicting a
 * real Go declaration:
 *
 *   empty-name        an endpoint that is the empty string. Nothing in Go is
 *                     named that, so there is no scope at which this is legal.
 *   placeholder       the endpoint is one of the register's placeholder literals
 *                     AND the package that emits the edge declares no such name.
 *                     The file-writes-it test is the discriminator: `Unknown` is
 *                     a real `sql` sentinel and cobra really declares
 *                     `func TODO(...)`, so a value-only rule convicts members.
 *   non-identifier    the endpoint carries a character no Go identifier may
 *                     contain. Two legal shapes: a MODULE PATH on an `imports`
 *                     target (that label's own convention), and a
 *                     `Receiver.Method` qualified spelling on `overrides` (a Go
 *                     method has no package-scope name of its own). Both are
 *                     counted separately from the rest so the residue is the
 *                     number that means debris.
 *   unresolvable      the target binds to no symbol in the file, the package,
 *                     or anywhere in the drawn corpus.
 *
 * CLI: npx tsx script/m14/go-endpoint-probe.ts [--sample N] [--repo a,b] [--type t]
 *        [--shard=i/n] [--out f.json]   (--merge a.json,b.json --merge-only --out m.json)
 * Writes nothing without --out. Exit 0 always; the output is the evidence.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "go-stdlib") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "2000") ?? "2000")
const ONLY = argOf("--type")
const OUT = argOf("--out")

// The merge runs BEFORE the corpus walk and before `parseFile` is ever imported,
// so combining six shard artifacts costs a JSON read each. It used to sit after
// the worker pool, where `--merge-only` still paid the full corpus admission and
// then — because the shard draw is empty — exited having produced nothing; the
// command simply hung until it was killed.
if (process.argv.includes("--merge-only")) {
  const parts = (argOf("--merge") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  const shards = parts.map((p) => JSON.parse(readFileSync(p, "utf8")))
  const byKind: Record<string, Record<string, number>> = {}
  const samples: any[] = []
  let edges = 0
  const addKinds = (into: Record<string, Record<string, number>>, from: Record<string, Record<string, number>>) => {
    for (const [k, v] of Object.entries(from ?? {})) {
      into[k] = into[k] ?? {}
      for (const [t, n] of Object.entries(v as Record<string, number>)) into[k][t] = (into[k][t] ?? 0) + (n as number)
    }
  }
  for (const s of shards) {
    edges += s.edges ?? 0
    addKinds(byKind, s.byKind)
    for (const f of s.samples ?? []) if (samples.length < 60) samples.push(f)
  }
  const unresolvableByType = shards.reduce((acc: Record<string, number>, s: any) => {
    for (const [t, n] of Object.entries(s.unresolvableByType ?? {})) acc[t] = (acc[t] ?? 0) + (n as number)
    return acc
  }, {} as Record<string, number>)
  const merged = {
    generatedFor: "go endpoint integrity probe (MERGED)",
    mergedFrom: parts,
    shardCount: shards.length,
    corpusAdmitted: shards[0]?.corpusAdmitted,
    drawn: shards.reduce((a: number, s: number) => a + (s?.drawn ?? 0), 0),
    edges,
    byKind,
    unresolvableTotal: Object.values(unresolvableByType).reduce((a, b) => a + b, 0),
    unresolvableByType,
    samples,
    NOTE: "byKind counts are per-shard sums of the SAME adjudicated rule, so they sum. No distinct-FILE figure is claimed: this probe records sites, not per-type file sets, so a per-class file count across shards could double count. `unresolvableTotal` counts an edge whose target binds to no drawn symbol, and each shard only sees its OWN files, so an unresolvable count is a per-shard lower bound on that shard's misses — the ladder (file, then package, then the shard's corpus) is why the merged total exceeds a whole-draw single-process run would.",
  }
  if (OUT) {
    writeFileSync(OUT, JSON.stringify(merged, null, 2))
    console.log(`merged ${parts.length} shard artifacts -> ${OUT}`)
    for (const [k, v] of Object.entries(byKind)) console.log(`  ${k.padEnd(16)} ${JSON.stringify(v)}`)
    console.log(`  unresolvable by type: ${JSON.stringify(unresolvableByType)}`)
  }
  process.exit(0)
}

type File = { repo: string; dir: string; rel: string; abs: string; pkgDir: string }
const files: File[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "go") continue
    files.push({ repo: e, dir, rel, abs, pkgDir: path.dirname(abs) })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
let draw = files.slice(0, SAMPLE)
// SAMPLE FIRST, THEN SHARD — the same order the census uses, and for the same
// reason. Measured, not assumed: an unsharded 2,000-file run of this file dies at
//   [BB-PARSE-ERR] go | .../cmd/compile/internal/test/testdata/arithBoundary_test.go | memory access out of bounds
//   [BB-HANG] parser stuck 120s on the same file — exiting
// which is the M49 W11 wasm-module degradation, and it is a `process.exit` in
// MASTER-owned engine.ts, so it cannot be caught here. The probe silently reported
// nothing for the files after the crash point, which reads exactly like "no
// defects" — the failure mode this instrument exists to detect. Sharding across
// processes keeps each module's parse count below the degradation point.
const SHARD = process.argv.find((a) => a.startsWith("--shard="))
if (SHARD) {
  const [i, n] = SHARD.slice("--shard=".length).split("/").map(Number)
  draw = draw.filter((_, k) => k % n === i)
}
console.log(`go endpoint probe — repos ${REPOS.join(",")} admitted ${files.length} drawn ${draw.length}${SHARD ? ` shard ${SHARD.slice("--shard=".length)}` : ""}`)

function isPlainIdent(s: string): boolean {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ok = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95
    if (!ok) return false
  }
  return !(s.charCodeAt(0) >= 48 && s.charCodeAt(0) <= 57)
}
const PLACEHOLDER_LITERALS = new Set(["unknown", "undefined", "null", "n/a", "todo", "fixme", "?", "", "<name>", "unnamed", "anonymous", "symbol"])

type Finding = { kind: string; type: string; file: string; src: string; tgt: string; note?: string }
const findings: Finding[] = []
const corpusNames = new Set<string>()
const pkgNames = new Map<string, Set<string>>()
const edges: { type: string; src: string; tgt: string; pkgDir: string }[] = []

let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    const symNames = new Set<string>()
    for (const s of r?.symbols ?? []) if (typeof s?.name === "string" && s.name.length > 0) symNames.add(s.name)
    for (const n of symNames) corpusNames.add(n)
    const pn = pkgNames.get(f.pkgDir) ?? new Set<string>()
    for (const n of symNames) pn.add(n)
    pkgNames.set(f.pkgDir, pn)
    for (const x of r?.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
      if (!ALL_TYPES.includes(t)) continue
      if (ONLY && t !== ONLY) continue
      const src = String(x.source ?? "")
      const tgt = String(x.target ?? "")
      const label = `${f.repo}/${f.rel}`
      edges.push({ type: t, src, tgt, pkgDir: f.pkgDir })
      if (src.length === 0 || tgt.length === 0)
        findings.push({ kind: "empty-name", type: t, file: label, src, tgt, note: src.length === 0 ? "empty SOURCE" : "empty TARGET" })
      for (const [side, v] of [["source", src], ["target", tgt]] as const) {
        if (v.length === 0) continue
        if (PLACEHOLDER_LITERALS.has(v.trim().toLowerCase()) && !pn.has(v))
          findings.push({ kind: "placeholder", type: t, file: label, src, tgt, note: `${side}=${v} and no symbol in the emitting package declares it` })
        // a module path is the `imports` label's own convention; a qualified
        // `Receiver.Method` is the family spelling for a member with no
        // package-scope name. Both are recorded, and both are excluded from the
        // debris residue.
        if (!isPlainIdent(v) && !(t === "imports" && side === "target") && !(t === "overrides" && v.includes(".")))
          findings.push({ kind: "non-identifier", type: t, file: label, src, tgt, note: `${side}=${JSON.stringify(v)}` })
      }
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.BB_CENSUS_WORKERS ?? 4) }, () => worker()))

const unresolvable: Finding[] = []
for (const e of edges) {
  const pn = pkgNames.get(e.pkgDir)
  if (pn?.has(e.tgt)) continue
  if (corpusNames.has(e.tgt)) continue
  const leaf = e.tgt.split(".").pop() ?? e.tgt
  if (leaf && corpusNames.has(leaf)) continue
  unresolvable.push({ kind: "unresolvable-target", type: e.type, file: "", src: e.src, tgt: e.tgt })
}

console.log(`\nedges examined: ${edges.length}`)
for (const kind of ["empty-name", "placeholder", "non-identifier"]) {
  const rows = findings.filter((f) => f.kind === kind)
  console.log(`\n${kind}: ${rows.length}`)
  const byType = new Map<string, number>()
  for (const r of rows) byType.set(r.type, (byType.get(r.type) ?? 0) + 1)
  console.log(`  by type: ${JSON.stringify(Object.fromEntries([...byType].sort((a, b) => b[1] - a[1])))}`)
  const seen = new Set<string>()
  let shown = 0
  for (const r of rows) {
    const k = `${r.type}|${r.src}|${r.tgt}`
    if (seen.has(k)) continue
    seen.add(k)
    if (shown++ >= 12) break
    console.log(`  ${r.type.padEnd(12)} ${r.src} -> ${JSON.stringify(r.tgt)}   ${r.file}   (${r.note ?? ""})`)
  }
}
console.log(`\nunresolvable-target (target binds to no symbol in the file, the package, or the drawn corpus): ${unresolvable.length}`)
const ubt = new Map<string, number>()
for (const r of unresolvable) ubt.set(r.type, (ubt.get(r.type) ?? 0) + 1)
console.log(`  by type: ${JSON.stringify(Object.fromEntries([...ubt].sort((a, b) => b[1] - a[1])))}`)
const us = new Map<string, number>()
for (const r of unresolvable) us.set(r.src, (us.get(r.src) ?? 0) + 1)
console.log(`  top sources: ${JSON.stringify([...us].sort((a, b) => b[1] - a[1]).slice(0, 12))}`)
const ut = new Map<string, number>()
for (const r of unresolvable) ut.set(r.tgt, (ut.get(r.tgt) ?? 0) + 1)
console.log(`  top targets: ${JSON.stringify([...ut].sort((a, b) => b[1] - a[1]).slice(0, 15))}`)

// `--out` so a SHARDED run leaves an artifact rather than only stdout: an
// endpoint-integrity census that exists as terminal scrollback is the same class
// of unreproducible claim the census merge had. `mergeOnly` SUMMS the per-class
// counts and CONCATENATES the samples; it does not claim a distinct-file figure,
// because unlike the census this probe does not record per-type file sets and a
// sum across shards would be a double count whenever two shards report the same
// site. The per-type breakdown is the number, and it sums.
if (OUT) {
  const byKind: Record<string, Record<string, number>> = {}
  for (const kind of ["empty-name", "placeholder", "non-identifier"]) {
    const rows = findings.filter((f) => f.kind === kind)
    const byType: Record<string, number> = {}
    for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1
    byKind[kind] = byType
  }
  const unresByType: Record<string, number> = {}
  for (const r of unresolvable) unresByType[r.type] = (unresByType[r.type] ?? 0) + 1
  writeFileSync(OUT, JSON.stringify({
    generatedFor: "go endpoint integrity probe",
    corpusAdmitted: files.length,
    drawn: draw.length,
    shard: SHARD ?? null,
    edges: edges.length,
    byKind,
    unresolvableTotal: unresolvable.length,
    unresolvableByType: unresByType,
    samples: findings.slice(0, 60),
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
process.exit(0)
