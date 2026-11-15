/**
 * RESIDUAL MARKER PARTITION — the FULL split of php's residual by the gate's own marker-set rule,
 * and the falsifier tests the lane's rulings rest on.
 *
 * ## Why this exists
 *
 * `incoming-gate.ts` prints "EDGES A MARKER SET EXPLAINS" with **at most 5 marker sets per type**
 * (`printReport`, the `mine` slice) — it is a worklist of the TOP rows, not a partition. Measured
 * on php's own baseline (`validation/m14/results/php-...`, 2026-10-11): `calls` is complete with 5
 * sets (they sum to the type exactly) and `uses` is NOT — 15,152 of its 155,016 edges sit in
 * marker sets the block never prints, and neither the block nor its legend says so. A residual
 * cannot be split "by named cause with counts" from a truncated table, so this probe reproduces
 * the gate's columns exactly and then prints the UNCAPPED partition.
 *
 * ## The acceptance test comes first (§5w: a probe that cannot reproduce the gate is evidence
 *    about the probe)
 *
 * The gate's TABLE 1 is parsed out of a gate log (`BB_GATE_LOG`, default
 * `.tmp-php/gate-baseline.log`) and compared COLUMN BY COLUMN with this walk. Nothing below is
 * read until that check is printed. `EXACT` on every column of every type is the only state in
 * which the partition below is the gate's own table.
 *
 * ## The three falsifier tests
 *
 * 1. `owner_provable` — the composition probe's class that "would REFUTE the qualification rule"
 *    if non-zero. Its predicate is `members.has(owner + "." + target)` where `members` is built
 *    from symbols whose KIND is class/interface/trait/enum — i.e. nested DECLARATIONS, never
 *    members — and the probe's population excludes every edge whose bare target the file's own
 *    symbol table publishes. This probe counts how many edges the predicate can fire on AT ALL
 *    (reachability), and then runs the REACHABLE form of the same question: an owner-carrying edge
 *    with a BARE target whose `<owner>.<target>` the file publishes is a MISS of the rule.
 * 2. `builtin_unclaimed` — counted again, and the internal table's size reported, so a zero can be
 *    read as "the labeller ran" rather than "the table was empty".
 * 3. the local-read phantom — every `uses` edge carrying `metadata.isLocalRead` names a LOCAL
 *    BINDING, and the family contract publishes no locals as symbols (`src/ast/types.ts:148-190`),
 *    so any such edge the key space RESOLVES is a false link and the declaration it lands on is
 *    named here with its kind and file.
 *
 * Usage:
 *   BB_GATE_LOG=.tmp-php/gate-baseline.log npx tsx validation/m14/fixtures/php/tools/residual-marker-partition.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const GATE_LOG = process.env.BB_GATE_LOG ?? path.join(ROOT, ".tmp-php/gate-baseline.log")
const SIZE_CAP = 1024 * 1024

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { phpInternalKind } = await import(path.join(ROOT, "src/ast/php-internal-symbols.ts"))
const { classifyEdge, externalClaimOf, isContainsEdge, tally, emptyOutcomes } = await import(
  path.join(ROOT, "script/m14/incoming-rule.ts")
)
const { BINDING_SEP } = await import(path.join(ROOT, "src/ast/types.ts"))

/**
 * THE SEPARATOR TRIPWIRE, in this probe because the gate's own copy only covers the run it prints
 * for and HANDOFF §6.11 makes it a condition of adopting the separator: `N published keys contain
 * the separator` must be stated BEFORE and AFTER, and if N moves off 0 the binding claims are
 * unfalsifiable rather than verified. Counted the gate's way — over the pooled space and over each
 * project's own space, so a name counts once per space it appears in.
 */
const sepTripwire = { keys: 0, examples: [] as string[] }

type Outcomes = ReturnType<typeof emptyOutcomes>
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

// ── the population: the gate's own discovery, reproduced (git-tracked, present, under the cap) ──
const repos: { repo: string; files: string[] }[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".php")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  files.sort()
  if (files.length > 0) repos.push({ repo: dir, files })
}

type MarkBucket = { resolved: number; amb: number; unres: number; ext: number; bind: number; cause: number }
type Row = {
  edges: number; outs: Outcomes; marks: Map<string, MarkBucket>
}
const rows = new Map<string, Row>()
for (const t of ALL_TYPES) rows.set(t, { edges: 0, outs: emptyOutcomes(), marks: new Map() })

let parsed = 0
const ownerFalsifier = {
  ownerEdges: 0, bareOwnerEdges: 0, qualifiedOwnerEdges: 0,
  /** the composition probe's exact predicate, over ALL edges (reachability of its own test) */
  probePredicateHits: 0, probeMembersSize: 0,
  /** the REACHABLE form: owner-carrying, bare target, `<owner>.<target>` published in the file */
  shouldHaveFired: 0, misses: [] as string[],
}
const localRead = {
  total: 0, resolved: 0, amb: 0, unres: 0, ext: 0,
  boundKinds: new Map<string, number>(), examples: [] as string[],
}
const builtinCensus = { unclaimed: 0, labelled: 0, examples: [] as string[] }
/**
 * THE TABLE'S OWN EDGE, counted. `phpInternalKind` is generated from php-src's 107 `.stub.php`
 * files; a predefined constant declared in C (`main/php.h`, the stream constants) is not in a stub
 * and cannot be generated. Measured offline against a hand-written list of 36 PHP predefined
 * constants: 25 recognised, **11 not** — PHP_INT_MAX · PHP_INT_MIN · PHP_INT_SIZE · PHP_VERSION ·
 * PHP_OS · PHP_SAPI · PHP_FLOAT_EPSILON · PHP_FLOAT_MAX · STDIN · STDOUT · STDERR.
 * An edge naming one of those is NOT `builtin_unclaimed` (the labeller cannot see it) — it falls
 * into `vendor_unknown`, the RULED boundary, with the wrong reason attached. Counted here so the
 * size of that misattribution is a number rather than a caution.
 */
const constShape = new Map<string, number>()

for (const { repo, files } of repos) {
  const decl = new Map<string, number>()
  const kinds = new Map<string, Set<string>>()
  const declPos = new Map<string, { file: string; kind: string }[]>()
  const parsedFiles: { file: string; rels: any[]; syms: any[] }[] = []
  for (const abs of files) {
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    parsed++
    parsedFiles.push({ file: abs, rels: res.relationships ?? [], syms: res.symbols ?? [] })
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? "")
      if (n.length === 0) continue
      const kind = String(s.kind ?? "")
      const bump = (key: string) => {
        decl.set(key, (decl.get(key) ?? 0) + 1)
        let ks = kinds.get(key); if (!ks) kinds.set(key, (ks = new Set())); ks.add(kind)
        const at = declPos.get(key)
        const pos = { file: abs, kind }
        if (!at) declPos.set(key, [pos]); else if (!at.some((d) => d.file === abs && d.kind === kind)) at.push(pos)
        // THE TRIPWIRE, per project key space (the gate's own count).
        if (key.includes(BINDING_SEP)) {
          sepTripwire.keys++
          if (sepTripwire.examples.length < 5) sepTripwire.examples.push(`${path.relative(CR, abs)} :: ${JSON.stringify(key)}`)
        }
      }
      bump(n)
      const q = String(s.qualifiedName ?? "")
      if (q.length > 0 && q !== n) bump(q)
    }
  }
  const facts = (() => {
    const fs = new Set<string>()
    for (const abs of files) { const rel = path.relative(repo, abs); if (rel.length > 0) fs.add(rel.split(path.sep).join("/")) }
    return { packages: new Set<string>(), files: fs, sdkLib: false }
  })()

  for (const { file, rels, syms } of parsedFiles) {
    // the composition probe's `members` set, verbatim (class-kind symbols only)
    const probeMembers = new Set<string>()
    for (const s of syms) {
      const k = String(s.kind ?? "")
      if (!s.ownerName || !["class", "interface", "trait", "enum"].includes(k)) continue
      probeMembers.add(`${s.ownerName}.${s.name}`)
    }
    // the TRUE member table: any owned symbol, any kind
    const trueMembers = new Set<string>()
    for (const s of syms) if (s.ownerName) trueMembers.add(`${s.ownerName}.${s.name}`)
    const qualifiedHere = new Set<string>()
    for (const s of syms) { const q = String(s.qualifiedName ?? ""); if (q.length > 0) qualifiedHere.add(q) }
    ownerFalsifier.probeMembersSize = Math.max(ownerFalsifier.probeMembersSize, probeMembers.size)

    for (const r of rels) {
      const label = String(r.type ?? r.relationshipType ?? "")
      if (!ALL_TYPES.includes(label)) continue
      const row = rows.get(label)!
      row.edges++
      const tgt = String(r.target ?? r.to ?? r.toSymbol ?? "")
      if (tgt.length === 0) continue
      const md = (r.metadata ?? {}) as any
      const claim = externalClaimOf(r)
      const pc = classifyEdge(decl, kinds, tgt, claim, facts as any, isContainsEdge(label))
      tally(row.outs, pc, tgt, label)

      const markKeys = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null)
      markKeys.sort()
      const sig = markKeys.length ? markKeys.join("+") : "(no marker)"
      let b = row.marks.get(sig)
      if (!b) row.marks.set(sig, (b = { resolved: 0, amb: 0, unres: 0, ext: 0, bind: 0, cause: 0 }))
      switch (pc.outcome) {
        case "resolved": b.resolved++; break
        case "ambDeclOnly": case "ambBoth": b.amb++; break
        case "externalVerified": case "externalUnverified": b.ext++; break
        case "bindingVerified": case "bindingRefuted": case "bindingUnverified": b.bind++; break
        case "causeDeclared": case "causeRefuted": b.cause++; break
        default: b.unres++
      }

      // ── FALSIFIER 1: the owner-qualification rule ─────────────────────────────────────────
      const owner = typeof md.owner === "string" ? md.owner : ""
      if (owner.length > 0) {
        ownerFalsifier.ownerEdges++
        if (probeMembers.has(`${owner}.${tgt}`)) ownerFalsifier.probePredicateHits++
        if (tgt.includes(".")) ownerFalsifier.qualifiedOwnerEdges++
        else {
          ownerFalsifier.bareOwnerEdges++
          if (qualifiedHere.has(`${owner}.${tgt}`)) {
            ownerFalsifier.shouldHaveFired++
            if (ownerFalsifier.misses.length < 10) ownerFalsifier.misses.push(`${label} ${String(r.source)} -> ${tgt} (owner ${owner})   ${path.relative(CR, file)}:${r.line_number}`)
          }
        }
        void trueMembers
      }

      // ── FALSIFIER 2: builtins ─────────────────────────────────────────────────────────────
      // THE ADMISSION IS `unresolved` AND NOTHING WEAKER. The first version of this counter used
      // `pc.outcome !== "resolved"`, which also admits AMBIGUOUS edges — and that is a different
      // population with a different meaning. It read 208 and every one of the 10 it printed was an
      // in-file declaration the labeler had CORRECTLY skipped (`end` is `Location::$end`; `serialize`
      // is `CustomScalarType::serialize`; `count` is `SyncPromiseQueue::count`), i.e. edges whose
      // target the project's own key space answers. `builtin_unclaimed` means "the target names
      // NOTHING here and the edge still carries no claim" — a DEFECT — and an ambiguous edge is not
      // that. Caught by reading the printed examples back against the files, not by review.
      if (phpInternalKind(tgt) !== null) {
        if (md.external === true) builtinCensus.labelled++
        else if (pc.outcome === "unresolved") {
          builtinCensus.unclaimed++
          if (builtinCensus.examples.length < 10) builtinCensus.examples.push(`${label} -> ${tgt}  ${path.relative(CR, file)}`)
        }
      } else if (/^[A-Z][A-Z0-9_]{2,}$/.test(tgt) && pc.outcome === "unresolved" && md.external !== true) {
        constShape.set(tgt, (constShape.get(tgt) ?? 0) + 1)
      }

      // ── FALSIFIER 3: the local-read phantom ───────────────────────────────────────────────
      if (md.isLocalRead === true) {
        localRead.total++
        if (pc.outcome === "resolved") {
          localRead.resolved++
          const at = declPos.get(tgt) ?? []
          const kind = at.map((d) => d.kind).join("|") || "?"
          localRead.boundKinds.set(kind, (localRead.boundKinds.get(kind) ?? 0) + 1)
          if (localRead.examples.length < 10) {
            localRead.examples.push(`uses ${String(r.source)} -> ${tgt}  bound to ${kind} at ${at.map((d) => path.relative(CR, d.file)).join(", ") || "?"}   (read at ${path.relative(CR, file)}:${r.line_number})`)
          }
        } else if (pc.outcome === "ambDeclOnly" || pc.outcome === "ambBoth") localRead.amb++
        else if (pc.outcome === "externalVerified" || pc.outcome === "externalUnverified") localRead.ext++
        else localRead.unres++
      }
    }
  }
}

// ── THE ACCEPTANCE CHECK, before any partition is read ─────────────────────────────────────────
type GateRow = { type: string; nums: number[] }
function gateTable1(): Map<string, GateRow> {
  const out = new Map<string, GateRow>()
  let text = ""
  try { text = readFileSync(GATE_LOG, "utf8") } catch { return out }
  for (const line of text.split("\n")) {
    const t = line.trim()
    const parts = t.split(/\s+/)
    if (parts.length < 15) continue
    if (!ALL_TYPES.includes(parts[0]) && parts[0] !== "TOTAL") continue
    const nums = parts.slice(1, 15).map((x) => Number(x.replace(/,/g, "")))
    if (nums.some((n) => !Number.isFinite(n))) continue
    out.set(parts[0], { type: parts[0], nums })
  }
  return out
}
const gate = gateTable1()
const cols = ["edges", "resolved", "collRes", "amb", "ambKind", "unres", "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL"]
const mineOf = (r: Row): number[] => [
  r.edges, r.outs.resolved, r.outs.resolvedAmongCollision, r.outs.ambiguousByDecl, r.outs.ambiguousByKind,
  r.outs.unresolved, r.outs.externalVerified, r.outs.externalUnverified, r.outs.externalRefuted,
  r.outs.bindingVerified, r.outs.bindingUnverified, r.outs.bindingRefuted, r.outs.causeDeclared, r.outs.causeRefuted,
]
console.log(`php residual marker partition — whole admitted population (production path)`)
console.log(`population: ${parsed} files parsed across ${repos.length} repos · gate log ${path.relative(ROOT, GATE_LOG)}`)
// THE SAME COLUMNS THE GATE PRINTS, so a run of this file before and after a change is a legible
// before/after on its own and not only a check against a stored log.
console.log(`\nTABLE 1 AS THIS WALK READS IT (the gate's own column order):`)
console.log(`  ${"type".padEnd(14)} ${cols.map((c) => c.padStart(9)).join(" ")}`)
for (const t of ALL_TYPES) console.log(`  ${t.padEnd(14)} ${mineOf(rows.get(t)!).map((n) => String(n).padStart(9)).join(" ")}`)
const tot = ALL_TYPES.reduce((a, t) => { const m = mineOf(rows.get(t)!); return m.map((v, i) => (a[i] ?? 0) + v) }, [] as number[])
console.log(`  ${"TOTAL".padEnd(14)} ${tot.map((n) => String(n).padStart(9)).join(" ")}`)
const resid = tot[3] + tot[5] + tot[8] + tot[11] + tot[13]
console.log(`  residual ${resid} of ${tot[0]}${tot[0] > 0 ? ` = ${((resid / tot[0]) * 100).toFixed(1)}%` : " (NO POPULATION — a rate over zero edges is not a rate)"}   extFAIL ${tot[8]}   bindFAIL ${tot[11]}   causeFAIL ${tot[13]}`)
console.log(`  separator tripwire: ${sepTripwire.keys} published key(s) contain the separator` +
  (sepTripwire.keys === 0 ? ` (0 required)` : ` — CLAIMS ARE VOID IN THIS POPULATION — ${sepTripwire.examples.join(" · ")}`))
console.log(`\nACCEPTANCE — this walk vs the gate's own TABLE 1 (every column, every type):`)
let allExact = true
console.log(`  ${"type".padEnd(14)} ${cols.map((c) => c.padStart(10)).join("")}`)
for (const t of ALL_TYPES) {
  const g = gate.get(t); const mine = mineOf(rows.get(t)!)
  if (!g) { console.log(`  ${t.padEnd(14)} NO GATE ROW — the acceptance check could not run`); allExact = false; continue }
  const diff = mine.map((v, i) => v - g.nums[i])
  const exact = diff.every((d) => d === 0)
  if (!exact) allExact = false
  console.log(`  ${t.padEnd(14)} ${(exact ? "EXACT" : diff.map((d, i) => (d === 0 ? "" : `${cols[i]}${d > 0 ? "+" : ""}${d}`)).filter(Boolean).join(" ")).padEnd(10)}`)
}
console.log(`  ${allExact ? ">>> THE WALK REPRODUCES THE GATE'S TABLE 1 EXACTLY — the partition below is the gate's own." : ">>> MISMATCH — THE PARTITION BELOW IS EVIDENCE ABOUT THIS PROBE, NOT THE LANE."}`)

// ── THE FULL PARTITION, uncapped ──────────────────────────────────────────────────────────────
console.log(`\nFULL MARKER PARTITION — every marker set, no cap (the gate prints at most 5 per type).`)
console.log(`  ${"type".padEnd(13)} ${"metadata KEYS on the edge".padEnd(56)} ${"edges".padStart(9)} ${"resolved".padStart(9)} ${"amb".padStart(8)} ${"unres".padStart(8)} ${"extClaim".padStart(9)} ${"binding".padStart(8)} cause`)
const dropped: Record<string, { sets: number; edges: number; amb: number; unres: number }> = {}
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  const list = [...r.marks.entries()].sort((a, b) => (b[1].amb + b[1].unres) - (a[1].amb + a[1].unres))
  const top5 = list.slice(0, 5)
  const rest = list.slice(5).filter(([sig, b]) => (b.amb + b.unres) > 0)
  dropped[t] = { sets: rest.length, edges: rest.reduce((a, [, b]) => a + b.resolved + b.amb + b.unres + b.ext + b.bind + b.cause, 0), amb: rest.reduce((a, [, b]) => a + b.amb, 0), unres: rest.reduce((a, [, b]) => a + b.unres, 0) }
  for (const [sig, b] of list) {
    const n = b.resolved + b.amb + b.unres + b.ext + b.bind + b.cause
    console.log(`  ${t.padEnd(13)} ${sig.padEnd(56)} ${String(n).padStart(9)} ${String(b.resolved).padStart(9)} ${String(b.amb).padStart(8)} ${String(b.unres).padStart(8)} ${String(b.ext).padStart(9)} ${String(b.bind).padStart(8)} ${b.cause}`)
  }
}
console.log(`\nWHAT THE GATE'S 5-PER-TYPE CAP DROPS (marker sets with amb+unres > 0, beyond the top 5):`)
for (const t of ALL_TYPES) {
  const d = dropped[t]
  if (d.sets > 0) console.log(`  ${t.padEnd(13)} ${String(d.sets).padStart(3)} marker set(s)   ${String(d.edges).padStart(9)} edges   amb ${d.amb}   unres ${d.unres}`)
}
console.log(`  (a marker set carrying ONLY ext claims and no amb/unres is not printed and not counted here either — see the partition above for those rows.)`)

// ── FALSIFIER 1 ───────────────────────────────────────────────────────────────────────────────
console.log(`\nFALSIFIER 1 — owner_provable, the class the lane doc says "would REFUTE" the qualification rule:`)
console.log(`  owner-carrying edges: ${ownerFalsifier.ownerEdges}  (bare target ${ownerFalsifier.bareOwnerEdges}, already qualified ${ownerFalsifier.qualifiedOwnerEdges})`)
console.log(`  the composition probe's EXACT predicate (members built from class-kind symbols): ${ownerFalsifier.probePredicateHits} hit(s) over ALL edges, largest members-set ${ownerFalsifier.probeMembersSize}`)
console.log(`  >>> a predicate that fires ${ownerFalsifier.probePredicateHits} times over the WHOLE population cannot be a measurement of the unresolved subset.`)
console.log(`  THE REACHABLE FORM of the same question — owner-carrying, BARE target, and the file publishes \`<owner>.<target>\`: ${ownerFalsifier.shouldHaveFired}`)
for (const m of ownerFalsifier.misses) console.log(`     MISS ${m}`)

// ── FALSIFIER 2 ───────────────────────────────────────────────────────────────────────────────
console.log(`\nFALSIFIER 2 — builtin_unclaimed: internal target with NO external label, unresolved: ${builtinCensus.unclaimed}`)
console.log(`  internal-labelled edges seen: ${builtinCensus.labelled}  (the table is populated: phpInternalKind recognises them)`)
for (const e of builtinCensus.examples) console.log(`     ${e}`)
{
  const shaped = [...constShape.entries()].sort((a, b) => b[1] - a[1])
  const total = shaped.reduce((a, [, n]) => a + n, 0)
  console.log(`  CONSTANT-SHAPED targets the table does NOT know and the run did NOT label: ${total}` +
    (shaped.length ? `  — ${shaped.slice(0, 12).map(([n, c]) => `${n}×${c}`).join("  ")}` : ""))
  console.log(`  (these sit in vendor_unknown, the RULED boundary, so the disposition is unchanged — the REASON attached to it is not: they are PHP's own predefined constants, declared in C and absent from the 107 stubs the table is generated from.)`)
}

// ── FALSIFIER 3 ───────────────────────────────────────────────────────────────────────────────
console.log(`\nFALSIFIER 3 — the local-read phantom (\`metadata.isLocalRead\`):`)
console.log(`  edges ${localRead.total}   resolved ${localRead.resolved}   amb ${localRead.amb}   unres ${localRead.unres}   extClaim ${localRead.ext}`)
console.log(`  kinds of the declarations the RESOLVED local reads bind to: ${[...localRead.boundKinds].map(([k, n]) => `${k}:${n}`).join(" ") || "(none)"}`)
for (const e of localRead.examples) console.log(`     PHANTOM ${e}`)
void emptyOutcomes
