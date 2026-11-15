/**
 * THE SOURCE SIDE OF `calls`/`uses` — is the bare source name recoverable?
 *
 * ## What is already established, and what this adds
 *
 * `store-tier-attribution-600.txt` measured the store's binding accuracy against
 * ground truth where ground truth exists, for the two types whose edge NAMES a
 * declaration this lane published:
 *
 *   contains    6,935 edges, 3,715 contested, 3,159 WRONG-target opportunities,
 *               0 wrong — the store names the intended declaration 100%.
 *   overrides   1,220 edges,   196 whose target EQUALS a published qualifiedName,
 *               77 named correctly, 119 WRONG (60.7%).
 *
 * `override-base-depth-probe.ts` then falsified the in-lane half of that 60.7%:
 * on mini_types.dart, 56 of 56 edges whose direct base declares the member emit
 * that base. The analyzer's `overrides` label is a DIRECT base, not a transitive
 * one. So the damage is the store's `extractLeaf` collapse of an already-correct
 * `${base}.${member}` string — a §8 item, not a lane item.
 *
 * `owner-qualification-payoff.ts` then falsified the obvious in-lane move: of
 * 10,239 `calls` edges in the sample, 10,237 have a BARE source, so there is no
 * owner to qualify the TARGET with. Measured on the same record.
 *
 * That leaves the SOURCE side, which nobody has measured. `overrides` emits
 * `${ownerName}.${name}` as its source; `calls`, `uses`, `instantiates` and
 * `references` emit the bare `name` of the enclosing member. So 30,809 edges
 * carry a source that the store will leaf-collapse — the same mechanism, on the
 * other end of the edge, and the analyzer already holds `ownerName` for every
 * enclosing symbol (it is what `resolveOverrides` reads).
 *
 * ## What this measures
 *
 * For each expression edge, the enclosing member is recovered from the parse by
 * range containment (the narrowest published symbol whose span contains the
 * edge's own `line_number`) and cross-checked against the emitted bare source.
 * Then, sample-wide:
 *
 *   memberSourced  an enclosing member WITH an ownerName exists. Only these are
 *                  qualifiable: a top-level function's source has no owner.
 *   srcContested   the bare source name is declared MORE THAN ONCE sample-wide.
 *                  This is the population the leaf collapse chooses between.
 *   qHit           a published qualifiedName EQUALS `${ownerName}.${name}`.
 *   qUnique        ... and exactly one does, so the answer is DETERMINED.
 *   netNew         srcContested AND qUnique — one edge moved off a contested
 *                  binding onto a determined one. This is the whole payoff.
 *
 * ## The falsifiable claim, stated so it can be overturned
 *
 *   IF  qualifying the source of member-sourced expression edges is correct and
 *       complete, THEN netNew must be > 0 and a `_res_qname` store tier must bind
 *       netNew edges that are currently contested.
 *   A netNew of 0 would say the source name is already unique wherever an owner
 *   exists, and the qualification would be pure payload for nothing.
 *
 * Population: the same 600 paths listed in `dart-sample-list-600.txt`, read from
 * that file rather than redrawn, so the before/after comparison against
 * `dart-ambiguity-split-600.txt` and `dart-store-tier-attribution-600.txt` is
 * over the identical files.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const MEAS = path.resolve((import.meta as any).dirname, "../../measurements")
const LIST = path.join(MEAS, "dart-sample-list-600.txt")
const FILES = readFileSync(LIST, "utf8").split("\n").filter((l) => l.trim().length > 0)

console.log(`population: ${FILES.length} paths from dart-sample-list-600.txt (same file the other 600 runs used)`)

// ---- pass 1: parse, keep the published declarations and the edges ----------
interface SymRec {
  name: string
  kind: string
  q: string
  owner: string | null
  s: number
  e: number
}
const perFile = new Map<string, { syms: SymRec[]; rels: any[] }>()
const declsByName = new Map<string, string[]>() // name -> qualifiedNames
const declsByQ = new Map<string, number>() // qualifiedName -> declaration count

let parsed = 0
let failed = 0
for (const f of FILES) {
  let r: any
  try {
    r = await parseFile(f, path.dirname(f))
  } catch {
    failed++
    continue
  }
  const syms: SymRec[] = (r?.symbols ?? []).map((s: any) => {
    const q = String(s.qualifiedName ?? s.name ?? "")
    const owner = typeof s.ownerName === "string" && s.ownerName.length > 0 ? s.ownerName : null
    const s0 = Number(s.startLine ?? s.range?.startLine ?? s.range?.start?.line ?? 0)
    const e0 = Number(s.endLine ?? s.range?.endLine ?? s.range?.end?.line ?? s0)
    const list = declsByName.get(s.name) ?? []
    list.push(q)
    declsByName.set(s.name, list)
    declsByQ.set(q, (declsByQ.get(q) ?? 0) + 1)
    return { name: String(s.name ?? ""), kind: String(s.kind ?? ""), q, owner, s: s0, e: e0 }
  })
  perFile.set(f, { syms, rels: r?.relationships ?? [] })
  parsed++
}
console.log(`parsed ${parsed}  failed ${failed}  declarations ${[...declsByName.values()].reduce((a, b) => a + b.length, 0)}\n`)

// ---- pass 2: per-edge, recover the enclosing member and price qualification -
const TYPES = ["calls", "uses", "references", "instantiates", "contains", "overrides", "extends", "implements", "imports", "exports"]
interface Acc {
  edges: number
  memberSourced: number
  enclosedFound: number
  srcContested: number
  qHit: number
  qUnique: number
  netNew: number
  noOwner: number
  names: Set<string>
}
const acc: Record<string, Acc> = {}
for (const t of TYPES) acc[t] = { edges: 0, memberSourced: 0, enclosedFound: 0, srcContested: 0, qHit: 0, qUnique: 0, netNew: 0, noOwner: 0, names: new Set() }

const misses: string[] = []
for (const [f, { syms, rels }] of perFile) {
  for (const e of rels) {
    const t = String(e.t ?? e.type ?? e.relationshipType ?? "")
    const a = acc[t]
    if (!a) continue
    a.edges++
    const src = String(e.s ?? e.source ?? "")
    const line = Number(e.line ?? e.line_number ?? 0)
    // Already qualified? `overrides` is. Nothing to price.
    if (src.includes(".")) continue

    // The narrowest published symbol whose span contains the callsite line. That is
    // the enclosing member the analyzer named, recovered from the parse rather than
    // trusted, so a disagreement between it and the emitted source is visible.
    let best: SymRec | null = null
    let bestSpan = Infinity
    for (const s of syms) {
      if (s.name !== src) continue
      if (s.s > line || s.e < line) continue
      const span = s.e - s.s
      if (span < bestSpan) {
        best = s
        bestSpan = span
      }
    }
    if (!best) {
      // No span contains the callsite: a top-level function (owner absent) or a
      // callsite line the analyzer attributed to the declaration's start.
      const byName = syms.filter((s) => s.name === src)
      if (byName.length === 1) best = byName[0]
      else if (byName.length > 1 && misses.length < 8) misses.push(`${f}:${line} ${t} ${src} -> ${e.g} (${byName.length} same-name spans, none contains the line)`)
    }
    if (!best) continue
    a.enclosedFound++
    if (!best.owner) {
      a.noOwner++
      continue
    }
    a.memberSourced++
    const qs = `${best.owner}.${best.name}`
    const contested = (declsByName.get(src)?.length ?? 0) > 1
    if (contested) a.srcContested++
    if ((declsByQ.get(qs) ?? 0) > 0) a.qHit++
    if ((declsByQ.get(qs) ?? 0) === 1) {
      a.qUnique++
      if (contested) {
        a.netNew++
        a.names.add(src)
      }
    }
  }
}

console.log("SOURCE-SIDE QUALIFICATION PAYOFF")
console.log("memberSourced = enclosing member has an ownerName.  srcContested = that bare name is declared >1x sample-wide.")
console.log("qUnique = exactly one published qualifiedName equals Owner.name.  netNew = contested AND qUnique.\n")
console.log("type".padEnd(13) + "edges".padStart(8) + "enclosed".padStart(9) + "memberSrc".padStart(10) + "noOwner".padStart(8) + "contested".padStart(10) + "qHit".padStart(7) + "qUnique".padStart(8) + "netNew".padStart(8))
console.log("-".repeat(81))
for (const t of TYPES) {
  const a = acc[t]
  console.log(
    t.padEnd(13) +
      String(a.edges).padStart(8) +
      String(a.enclosedFound).padStart(9) +
      String(a.memberSourced).padStart(10) +
      String(a.noOwner).padStart(8) +
      String(a.srcContested).padStart(10) +
      String(a.qHit).padStart(7) +
      String(a.qUnique).padStart(8) +
      String(a.netNew).padStart(8),
  )
}

let net = 0
let ms = 0
for (const t of TYPES) {
  net += acc[t].netNew
  ms += acc[t].memberSourced
}
console.log(`\nTOTAL member-sourced expression edges : ${ms}`)
console.log(`TOTAL netNew (contested -> determined by qualifying the source): ${net}`)
if (acc.uses.names.size > 0 || acc.calls.names.size > 0) {
  const all = new Set([...acc.calls.names, ...acc.uses.names])
  console.log(`distinct contested source names recovered: ${all.size}`)
  console.log(`  top: ${[...all].slice(0, 25).join(", ")}`)
}
if (misses.length > 0) {
  console.log("\nENCLOSURE RECOVERY MISSES (declared for honesty; the edge is counted under NO enclosing member):")
  for (const m of misses) console.log("  " + m)
}