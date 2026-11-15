#!/usr/bin/env bun
/**
 * CLEAN lane — WHO WAS RESOLVING THAT ROW BEFORE?
 *
 * ## The question
 *
 * `gate-residue-delta.ts` counts rows that appeared and disappeared between two dumps. A row that
 * APPEARS is the interesting half of a phantom-declaration fix: the gate resolves on
 * `declCount === 1` ALONE (`classifyEdge`, `incoming-rule.ts` — no kind compatibility test), so a
 * container symbol named after its instance's TARGET TYPE made every reference to that name in the
 * project read `resolved`. Delete the container and those references have no declaration at all, so
 * the row REAPPEARS in the dump — as an honest `externalVerified` where the edge carries a claim the
 * project can confirm, and as `unresolved` where nothing can carry it. **THE DUMP IS 'NOT `resolved`',
 * NOT 'RESIDUAL'**: `externalVerified` rows are in it (measured: 10163 = 2906 amb + 2972 unresolved +
 * 4285 extOK), so a rising dump does not mean a rising gap, and the added rows are printed BY OUTCOME
 * for exactly that reason.
 *
 * That reading is only admissible if every added row can be attributed to a name a container used
 * to publish. So this probe does exactly that, and nothing else:
 *
 *   1. reconstructs the PRE-FIX container names from the CURRENT run's symbols. The fix is a
 *      NAMING change — `processInstance` now publishes `<target>::instance` — so the name the
 *      same declaration published before the fix is that name with the suffix removed. Nothing is
 *      guessed from the source text: the container and its target are read from the analyzer's own
 *      output, which is what the gate counted.
 *   2. takes the added rows (after-dump minus before-dump) and asks, per row, whether its
 *      (project, target) is one of those reconstructed names;
 *   3. reports the remainder BY NAME, because a residue this probe cannot attribute is a finding in
 *      its own right and must not be rounded into a percentage.
 *
 * ## What it does NOT claim
 *
 * It does not re-classify an edge and it does not judge a resolution: the before-run's outcome for
 * an added row is not in this probe's hands (the row was NOT in the before-dump — that is what
 * "added" means — so the before-run called it `resolved`, an external verification or a binding
 * verification, and only a full re-run of the gate on the pre-fix analyzer could say which). The
 * attribution is a NAME-level statement: this target was published by a container, and is now
 * published by nothing.
 *
 * Usage:
 *   bun validation/m14/fixtures/clean/phantom-attribution.mts \
 *     --before=<gate --dump file (pre-fix)> --after=<gate --dump file (post-fix)> [--json=<out>] [--limit=N]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const CORPUS = arg("corpus") ?? process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const BEFORE = arg("before")
const AFTER = arg("after")
const JSON_OUT = arg("json")
const LIMIT = Number(arg("limit") ?? "0")
const MAX_BYTES = 1024 * 1024
if (!BEFORE || !AFTER) {
  console.error("usage: phantom-attribution.mts --before=<dump> --after=<dump> [--json=<out>] [--limit=N]")
  process.exit(2)
}

// ---------------------------------------------------------------------------
// the population, discovered the same way the gate's rows are addressed
// ---------------------------------------------------------------------------
type FileRec = { abs: string; repo: string; rel: string }
const files: FileRec[] = []
for (const entry of fs.readdirSync(CORPUS)) {
  const repoRoot = path.join(CORPUS, entry)
  try { if (!fs.statSync(repoRoot).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!/\.(icl|dcl)$/.test(rel)) continue
    const abs = path.join(repoRoot, rel)
    try { if (fs.statSync(abs).size > MAX_BYTES) continue } catch { continue }
    files.push({ abs, repo: repoRoot, rel })
  }
}
const population = LIMIT > 0 ? files.slice(0, LIMIT) : files

// ---------------------------------------------------------------------------
// 1 · the containers, and the names they used to publish
// ---------------------------------------------------------------------------
const INSTANCE_SUFFIX = "::instance"
type Container = { file: string; repo: string; name: string; target: string; line: number | null }
const containers: Container[] = []
let symbols = 0
let parsed = 0
let failed = 0
for (const f of population) {
  let r: any
  try { r = await parseFile(f.abs, f.repo, { projectRoot: f.repo } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  for (const s of r.symbols ?? []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    symbols++
    const kind = String(s?.kind ?? "")
    const snippet = String(s?.snippet ?? "").trimStart()
    // THE SAME CONTAINER PREDICATE THE CENSUS USES: kind + the declaration it was minted from. It is
    // independent of the SPELLING, which is the point — this probe must find the container on both
    // sides of a naming fix.
    const isContainer = (kind === "impl" || kind === "class" || kind === "interface") && snippet.startsWith("instance")
    if (!isContainer) continue
    containers.push({
      file: f.abs,
      repo: f.repo,
      name,
      // THE PRE-FIX SPELLING. A container that is not namespaced is ALREADY bare — the after-run of
      // this probe must not pretend such a container changed, so the reconstruction is identity
      // there and the count of non-namespaced containers is printed rather than folded in silently.
      target: name.endsWith(INSTANCE_SUFFIX) ? name.slice(0, -INSTANCE_SUFFIX.length) : name,
      line: Number(s?.startLine ?? s?.range?.startLine ?? s?.line ?? 0) || null,
    })
  }
}
const namespaced = containers.filter((c) => c.name.endsWith(INSTANCE_SUFFIX)).length
/** project -> pre-fix container names, with the container that published each (for the receipt) */
const publishedBy = new Map<string, Map<string, Container[]>>()
for (const c of containers) {
  let m = publishedBy.get(c.repo)
  if (!m) publishedBy.set(c.repo, (m = new Map()))
  const list = m.get(c.target) ?? []
  list.push(c)
  m.set(c.target, list)
}

// ---------------------------------------------------------------------------
// 2 · the two dumps
// ---------------------------------------------------------------------------
type Row = { label: string; outcome: string; tgt: string; file: string; claim: string }
const read = (p: string): Row[] => {
  const text = fs.readFileSync(p, "utf8")
  if (/\bDUMP TRUNCATED\b/.test(text)) {
    console.error(`${p}: the dump is TRUNCATED — a set difference against it is not a set.`)
    process.exit(2)
  }
  const out: Row[] = []
  for (const line of text.split("\n")) {
    if (!line.startsWith("DUMP\t")) continue
    const p2 = line.split("\t")
    out.push({ label: p2[1] ?? "", outcome: p2[2] ?? "", tgt: p2[3] ?? "", file: p2[4] ?? "", claim: p2[5] ?? "" })
  }
  return out
}
const before = read(BEFORE)
const after = read(AFTER)
const key = (r: Row) => `${r.label}|${r.file}|${r.tgt}`
const beforeKeys = new Set(before.map(key))
const added = after.filter((r) => !beforeKeys.has(key(r)))
const afterKeys = new Set(after.map(key))
const removed = before.filter((r) => !afterKeys.has(key(r)))

// the project a dump path belongs to — the same root the gate used
const repoOf = (abs: string): string => {
  const i = abs.indexOf("/repositories/")
  if (i < 0) return ""
  const rest = abs.slice(i + "/repositories/".length)
  const seg = rest.indexOf("/")
  return seg < 0 ? "" : path.join(abs.slice(0, i + "/repositories/".length), rest.slice(0, seg))
}

// ---------------------------------------------------------------------------
// 3 · attribution
// ---------------------------------------------------------------------------
const attributed: Row[] = []
const unattributed: Row[] = []
for (const r of added) {
  const repo = repoOf(r.file)
  if (publishedBy.get(repo)?.has(r.tgt)) attributed.push(r)
  else unattributed.push(r)
}

const byTarget = new Map<string, number>()
for (const r of attributed) byTarget.set(r.tgt, (byTarget.get(r.tgt) ?? 0) + 1)
const unattributedTargets = new Map<string, number>()
for (const r of unattributed) unattributedTargets.set(r.tgt, (unattributedTargets.get(r.tgt) ?? 0) + 1)

// ---------------------------------------------------------------------------
// 4 · the removed rows, read through the SAME lens
// ---------------------------------------------------------------------------
// A removed row is either a name whose only declaration was a phantom (so the row is now gone
// because the name RESOLVES against a real declaration that was always there), or a name whose
// phantom WAS the only declaration (so the row must have re-appeared as an added row — the
// `onlyPhantom` shape, counted below). The two are separated by whether a real declaration of the
// name remains in the project, which this probe CAN read: every symbol that is not a container.
const realNames = new Map<string, Set<string>>()
for (const f of population) {
  let r: any
  try { r = await parseFile(f.abs, f.repo, { projectRoot: f.repo } as any) } catch { continue }
  if (!r) continue
  for (const s of r.symbols ?? []) {
    const n = String(s?.name ?? "")
    if (!n) continue
    const kind = String(s?.kind ?? "")
    const snippet = String(s?.snippet ?? "").trimStart()
    if ((kind === "impl" || kind === "class" || kind === "interface") && snippet.startsWith("instance")) continue
    let set = realNames.get(f.repo)
    if (!set) realNames.set(f.repo, (set = new Set()))
    set.add(n)
    const q = String(s?.qualifiedName ?? "")
    if (q && q !== n) set.add(q)
  }
}
let removedWithRealLeft = 0
let removedWithoutRealLeft = 0
const removedWithoutReal: Row[] = []
for (const r of removed) {
  const repo = repoOf(r.file)
  if (realNames.get(repo)?.has(r.tgt)) removedWithRealLeft++
  else { removedWithoutRealLeft++; removedWithoutReal.push(r) }
}

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`
console.log(`population: ${parsed} parsed of ${population.length} sampled (failed ${failed}) — symbols ${symbols}`)
console.log(`containers: ${containers.length} (namespaced '${INSTANCE_SUFFIX}': ${namespaced}, bare: ${containers.length - namespaced})`)
console.log(`pre-fix names reconstructed (distinct, per project): ${[...publishedBy.values()].reduce((s, m) => s + m.size, 0)} in ${publishedBy.size} project(s)`)
// THE EXPORTS DROP'S OWN DENOMINATOR. `exports` edges are emitted per (file, exported name), so the
// number of edges a naming change can remove is the number of distinct (file, pre-fix name) pairs —
// NOT the number of containers and not the number of names. Printed because the gate's exports column
// moved 4834 -> 4596 and that difference has to be reconciled against THIS number rather than assumed.
const fileTargetPairs = new Set(containers.map((c) => `${c.file}\u0000${c.target}`))
console.log(`distinct (file, pre-fix container name) pairs: ${fileTargetPairs.size} — the ceiling on ` +
  `\`exports\` edges a naming change can remove (one per pair)`) 
console.log("")
console.log(`BEFORE ${BEFORE}: ${before.length} non-resolved rows`)
console.log(`AFTER  ${AFTER}: ${after.length} non-resolved rows`)
console.log(`added rows: ${added.length} · removed rows: ${removed.length}`)
console.log("")
// THE CLAIM SPLIT, read from the dump's own claim column. An added row carrying an external claim is
// a row that had a CLAIM the phantom was displacing; one carrying none is a row whose only support
// was the phantom's declaration count. The two are different findings and are never summed as one.
const claimSplit = new Map<string, number>()
for (const r of added) claimSplit.set(r.claim || "-", (claimSplit.get(r.claim || "-") ?? 0) + 1)
console.log("ADDED ROWS — attributed to a name a container used to publish:")
console.log(`  attributed   ${String(attributed.length).padStart(5)}  (${pct(attributed.length, added.length)} of added)`)
console.log(`  unattributed ${String(unattributed.length).padStart(5)}  (${pct(unattributed.length, added.length)} of added)`)
if (byTarget.size) {
  console.log(`  distinct attributed targets: ${byTarget.size} — ${[...byTarget.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n} ${c}`).join(" · ")}`)
}
if (unattributedTargets.size) {
  console.log(`  UNATTRIBUTED targets (${unattributedTargets.size} distinct) — every one must be read:`)
  for (const [n, c] of [...unattributedTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    const ex = unattributed.find((r) => r.tgt === n)!
    console.log(`    ${n} ×${c}  [${ex.outcome}] @ ${ex.file.replace(CORPUS + "/", "")}`)
  }
}
console.log(`  claim kind on the added rows: ${[...claimSplit.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ")}`)
// BY OUTCOME, because "the dump grew" and "the gap grew" are different statements: an
// `externalVerified` row is a row that LEFT `resolved` and LANDED on evidence.
const outcomeSplit = new Map<string, number>()
for (const r of added) outcomeSplit.set(r.outcome, (outcomeSplit.get(r.outcome) ?? 0) + 1)
console.log(`  outcome of the added rows:      ${[...outcomeSplit.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ")}`)
console.log("")
console.log("REMOVED ROWS — did a real declaration of the target remain?")
console.log(`  removed, a real declaration remains: ${removedWithRealLeft}  (the ambiguity/resolution the phantom was inflating is gone)`)
console.log(`  removed, NO real declaration remains: ${removedWithoutRealLeft}  (the row cannot be a resolution — it must be an edge that is no longer emitted)`)
for (const r of removedWithoutReal.slice(0, 20)) {
  const repo = repoOf(r.file)
  const wasPhantom = publishedBy.get(repo)?.has(r.tgt) === true
  console.log(`    ${r.label} ${r.tgt} [${r.outcome}] @ ${r.file.replace(CORPUS + "/", "")}${wasPhantom ? "  (the phantom was its ONLY declaration)" : ""}`)
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    measuredAt: new Date().toISOString(),
    population: { parsed, sampled: population.length, failed, symbols },
    containers: {
      total: containers.length,
      namespaced,
      bare: containers.length - namespaced,
      reconstructedNames: Object.fromEntries([...publishedBy].map(([repo, m]) => [path.basename(repo), [...m.keys()].sort()])),
      fileTargetPairs: fileTargetPairs.size,
    },
    dumps: { before: { file: BEFORE, rows: before.length }, after: { file: AFTER, rows: after.length } },
    added: {
      total: added.length,
      attributed: attributed.length,
      unattributed: unattributed.length,
      attributedTargets: Object.fromEntries([...byTarget].sort((a, b) => b[1] - a[1])),
      claimKinds: Object.fromEntries([...claimSplit].sort((a, b) => b[1] - a[1])),
      outcomes: Object.fromEntries([...outcomeSplit].sort((a, b) => b[1] - a[1])),
      unattributedTargets: Object.fromEntries([...unattributedTargets].sort((a, b) => b[1] - a[1])),
      unattributedExamples: unattributed.slice(0, 200),
    },
    removed: {
      total: removed.length,
      realDeclarationRemains: removedWithRealLeft,
      noRealDeclarationRemains: removedWithoutRealLeft,
      noRealDeclarationExamples: removedWithoutReal.slice(0, 200),
    },
  }, null, 2) + "\n")
  console.log(`\nwrote ${JSON_OUT}`)
}
