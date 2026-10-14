/**
 * INCOMING CHECK — can the graph walk TO a declaration, not just FROM it?
 *
 * ## Why this file exists
 *
 * Everything measured so far is OUTGOING: one file in, edges out. That answers
 * "what does this file reference" and not "what references this declaration".
 *
 * The consequence is concrete and it is a lie the graph tells. `src/lsp/impact.ts`
 * does bounded reverse-dependency traversal, and it gets its reverse edges by
 * SCANNING OUTGOING EDGES AND MATCHING TARGETS. No inbound edge is stored
 * anywhere; the schema holds none. So the reverse walk is only as good as the
 * target-matching, and three failure modes follow from that:
 *
 *   1. a declaration nobody in the corpus names has NO incoming edges — correct,
 *      but indistinguishable from a declaration whose references were never
 *      emitted;
 *   2. a name collision makes an edge look like an incoming edge to the WRONG
 *      declaration. zig measured this: 759 edges whose source bound to a
 *      non-callable symbol while its census read "dangling 0.00%", because the
 *      census resolves BY NAME and a name collision resolves;
 *   3. a target the analyzer emitted as a HOPELESS STRING — an external package,
 *      a path, a builtin — looks identical to a target that was never indexed.
 *
 * None of these is visible in an outgoing count. This file measures the incoming
 * side directly, per declaration, from a single-file index rather than by scanning
 * a corpus.
 *
 * ## What it measures, per type
 *
 *   fired            — the type produced at least one edge anywhere
 *   targetsDistinct  — how many DISTINCT declarations are named by a target
 *   ambiguousTargets — a target string that resolves to MORE THAN ONE published
 *                      symbol. This is the number that matters: each one is a place
 *                      where the reverse walk will pick a winner by a rule nobody
 *                      chose, and the graph will attribute an incoming edge to a
 *                      declaration that never mentioned it.
 *   unresolvedTargets— a target string that resolves to NO published symbol
 *   selfLoops        — source == target
 *   orphanDecls      — a published declaration that NOTHING names. In a language
 *                      whose files are independent (a script, a config file), a
 *                      high orphan rate is CORRECT and not a defect; the rate is
 *                      reported so a reader can tell the two cases apart rather
 *                      than assuming a low rate is required.
 *
 * ## The applicable-shape problem
 *
 * Incoming coverage is NOT uniform across a language, and a flat number would hide
 * that. A language where one file declares everything (`main.tf`) has a real
 * incoming graph. A language of 3,000-line classes referenced only by name has a
 * sparse one that is nonetheless complete. So this reports the shape and does not
 * pass or fail on a threshold; the threshold is a judgement about the language and
 * belongs to the lane that measured it.
 *
 * ## Usage
 *
 *   npx tsx script/m14/incoming-check.ts <lang> <file> [<file> ...]
 *   npx tsx script/m14/incoming-check.ts --json <lang> <file> ...
 *
 * READ-ONLY with respect to the corpus. Writes nothing.
 */
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

/**
 * The ten ontology type names, as the STORE spells them on a relationship row.
 *
 * The zig lane found the bug in an earlier version of this file: the table was
 * keyed on "brain_import", which is the value `src/ast/types.ts` gives
 * RelationshipType.Imports — while `src/ast/engine.ts` gives the SAME member the
 * value "imports". Two files, one enum member, two values. Analyzers import
 * RelationshipType from engine, so a relationship row carries "imports", so this
 * instrument matched nothing and reported imports as 0 in EVERY language while
 * emitting it. A table that is wrong in a way that always reads zero is worse than
 * no table, because the zero looks like a finding.
 *
 * Resolution is deliberately NOT done by picking one. Both spellings are accepted
 * below, so the instrument is correct whichever a given analyzer uses.
 */
const TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const

/** Store label -> ontology name. Both `imports` spellings are accepted. */
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls",
  call: "calls",
  uses: "uses",
  contains: "contains",
  composition: "contains",
  part_of: "contains",
  imports: "imports",
  brain_import: "imports",
  references: "references",
  depends_on: "references",
  related: "references",
  exports: "exports",
  provides: "exports",
  extends: "extends",
  inheritance: "extends",
  implements: "implements",
  implementation: "implements",
  overrides: "overrides",
  override: "overrides",
  instantiates: "instantiates",
}

/** Map whatever label a row carries onto the ontology name, or null if unknown. */
const ontologyName = (raw: string): string | null => LABEL_ALIASES[raw] ?? null

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const ARGS = argv.filter((a) => !a.startsWith("--"))

type TypeRow = {
  fired: boolean
  edges: number
  targetsDistinct: number
  ambiguousTargets: number
  unresolvedTargets: number
  /**
   * EDGES WHOSE TARGET CANNOT BE A LOCAL BINDING (dependency member, Node
   * builtin, runtime global, lib type). The fleet gate's rule
   * (`script/m14/incoming-gate.ts:38`) is that such an edge is not a resolution
   * claim: the lane states the reference cannot bind here. Counted separately so
   * the statement is visible rather than subtracted silently.
   */
  markedExternal: number
  /**
   * Candidate DECLARATIONS per target: distinct declaring FILES, counting one
   * file as one candidate. A name declared as both a type and its runtime
   * binding in one file is ONE declaration (TypeScript declaration merging), and
   * a `declare global { ... }` AUGMENTATION is not a competing declaration when
   * the corpus also has a real one. Max over the type's targets, and `ambiguous`
   * is `>= 2` — measured 2026-10-09: the kind-based rule counted `Observable`
   * ambiguous against its own 94 augmentations (510 `instantiates` edges).
   */
  maxDeclaringFiles: number
  /** `unresolvedTargets` with the marker IGNORED — the raw number, kept so the
   *  exemption can never hide how many edges the marker covers. */
  unresolvedRaw: number
  selfLoops: number
}

/**
 * The keys the fleet gate reads as a declared-external marker, verbatim from
 * `script/m14/incoming-gate.ts:105` — one vocabulary fleet-wide, because a lane
 * that invents its own key is a lane the gate cannot hear.
 */
const EXTERNAL_KEYS = [
  "zigExternalRef",
  "nimStdlibModule",
  "isExternal",
  "isExternalTarget",
  "external",
  "externalRef",
  "isStdlib",
  "stdlibModule",
  "moduleNamingEdges",
  "markAsExternal",
]

/** Marker present at the edge's top level or in its metadata; arrays count when non-empty. */
function hasExternalMarker(rel: any): boolean {
  const md = rel?.metadata && typeof rel.metadata === "object" ? rel.metadata : {}
  for (const key of EXTERNAL_KEYS) {
    for (const holder of [rel, md]) {
      const v = holder?.[key]
      if (v === true) return true
      if (Array.isArray(v) && v.length > 0) return true
    }
  }
  return false
}

function blank(): TypeRow {
  return { fired: false, edges: 0, targetsDistinct: 0, ambiguousTargets: 0, unresolvedTargets: 0, markedExternal: 0, maxDeclaringFiles: 0, unresolvedRaw: 0, selfLoops: 0 }
}

async function main(): Promise<void> {
  if (ARGS.length < 2) {
    console.error("usage: npx tsx script/m14/incoming-check.ts [--json] <lang> <file> [<file> ...]")
    process.exit(2)
  }
  const lang = ARGS[0]
  const files = ARGS.slice(1)
  const projectPath = path.dirname(files[0])

  // Index every file given. The incoming question is only meaningful against a
  // known universe: a target absent from this set is either external or
  // unpublished, and those are DIFFERENT answers, reported separately.
  const published = new Map<string, string[]>() // name -> kinds (for reporting)
  /** name -> distinct declaring files, non-augmentation declarations only */
  const sites = new Map<string, Set<string>>()
  /** name -> distinct declaring files among `declare global` AUGMENTATIONS only */
  const augSites = new Map<string, Set<string>>()
  /**
   * Candidate declarations for a target: distinct declaring files. Augmentations
   * are consulted only when no non-augmentation declaration exists anywhere in
   * the corpus, because an augmentation extends a declaration rather than
   * competing with it — and when a name is declared ONLY by augmentations (rxjs's
   * `Observable`, whose polyfill block and 93 operator augmentations are all
   * `declare global`), the distinct FILES still answer how many places a reverse
   * walk could land on.
   */
  const candidatesFor = (name: string): number => {
    const real = sites.get(name)
    if (real && real.size > 0) return real.size
    return augSites.get(name)?.size ?? 0
  }
  const declaredNames: string[] = []
  const rels: any[] = []
  let symbols = 0
  let degraded = 0
  const parseFailures: string[] = []

  for (const f of files) {
    let r: any
    try {
      r = await parseFile(f, projectPath)
    } catch (e) {
      parseFailures.push(`${f}: ${(e as Error)?.message ?? e}`)
      continue
    }
    if (!r) {
      parseFailures.push(`${f}: no result`)
      continue
    }
    if (r.fallback === true) degraded++

    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      symbols++
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      declaredNames.push(name)
      const kind = String(s?.kind ?? "")
      const arr = published.get(name)
      if (arr) {
        if (!arr.includes(kind)) arr.push(kind)
      } else {
        published.set(name, [kind])
      }
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== name) {
        const qa = published.get(q)
        if (qa) {
          if (!qa.includes(kind)) qa.push(kind)
        } else published.set(q, [kind])
      }
      // Candidate declarations: one per FILE, because TypeScript declaration
      // merging means a type plus its runtime binding in one file is ONE
      // declaration. `isAugmentation` (a `declare global` block) goes to its own
      // map, consulted only when the corpus has no non-augmentation declaration
      // of that name at all.
      const aug = (s as { metadata?: { isAugmentation?: boolean } })?.metadata?.isAugmentation === true
      const holder = aug ? augSites : sites
      for (const key of q.length > 0 && q !== name ? [name, q] : [name]) {
        const set = holder.get(key) ?? new Set<string>()
        set.add(f)
        holder.set(key, set)
      }
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) rels.push({ rel, file: f })
  }

  // A symbol is INCOMING when some edge names it. Counted per type, because a
  // declaration named only by `exports` is reachable by a different route than one
  // named only by `calls`, and `bb_impact` walks different edge types.
  const named = new Map<string, Set<string>>()
  const perType: Record<string, TypeRow> = {}
  for (const t of TYPES) perType[t] = blank()

  for (const { rel } of rels) {
    const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (!label) continue
    const row = perType[label]

    const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    row.edges++

    if (tgt.length === 0) continue
    if (src === tgt) {
      row.selfLoops++
      continue
    }

    // AMBIGUITY is the number this file exists to produce. A target naming 3
    // candidate declarations is not 3 incoming edges; it is ONE edge the reverse
    // walk will attribute to whichever of the 3 its rule picks. A CANDIDATE is a
    // declaring file: a type plus its runtime binding in one file is one
    // declaration (declaration merging), and augmentations are not candidates at
    // all when a non-augmentation declaration exists.
    const cands = candidatesFor(tgt)
    const rawUnresolved = cands === 0
    if (rawUnresolved) row.unresolvedRaw++
    // A marked edge's target is external BY DECLARATION (a dependency, a Node
    // builtin, a runtime global, a lib type — the analyzer's own proof, recorded
    // on the row). It is reported as such and is not counted against resolution;
    // the raw count above keeps the size of that set auditable.
    if (hasExternalMarker(rel)) {
      row.markedExternal++
      continue
    }
    if (rawUnresolved) {
      row.unresolvedTargets++
      continue
    }
    if (cands > 1) row.ambiguousTargets++
    if (cands > row.maxDeclaringFiles) row.maxDeclaringFiles = cands

    let set = named.get(tgt)
    if (!set) {
      set = new Set<string>()
      named.set(tgt, set)
    }
    set.add(label)
  }

  for (const t of TYPES) perType[t].fired = perType[t].edges > 0

  // Per-type distinct-target and incoming-declaration counts need the set per
  // type, so recompute from `rels` with a type filter.
  for (const t of TYPES) {
    const targets = new Set<string>()
    let amb = 0
    let unres = 0
    for (const { rel } of rels) {
      const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
      if (label !== t) continue
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      if (tgt.length === 0) continue
      if (hasExternalMarker(rel)) continue
      const cands = candidatesFor(tgt)
      if (cands === 0) {
        unres++
        continue
      }
      if (cands > 1) amb++
      targets.add(tgt)
    }
    perType[t].targetsDistinct = targets.size
    perType[t].ambiguousTargets = amb
    perType[t].unresolvedTargets = unres
  }

  const totalDistinct = named.size
  const orphans = declaredNames.filter((n) => !named.has(n)).length
  const ambiguousNames = [...named.keys()].filter((n) => (published.get(n)?.length ?? 0) > 1)

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          lang,
          files: files.length,
          symbols,
          degraded,
          parseFailures,
          distinctIncomingTargets: totalDistinct,
          orphanDeclarations: orphans,
          orphanRate: declaredNames.length ? orphans / declaredNames.length : 0,
          ambiguousTargetNames: ambiguousNames,
          perType,
        },
        null,
        2,
      ),
    )
  } else {
    const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
    console.log(`incoming check — ${lang}, ${files.length} file(s), ${symbols} symbols`)
    console.log(`degraded parses: ${degraded}   parse failures: ${parseFailures.length}`)
    if (parseFailures.length) for (const f of parseFailures.slice(0, 5)) console.log(`  ${f}`)
    console.log("")
    console.log(
      pad("type", 16) + pad("fired", 7) + pad("edges", 9) + pad("distinct", 10) + pad("ambiguous", 11) + pad("unresolved", 12) + pad("external", 10) + "unres(raw)",
    )
    console.log("-".repeat(92))
    for (const t of TYPES) {
      const r = perType[t]
      console.log(
        pad(t, 16) + pad(r.fired ? "yes" : "NO", 7) + pad(String(r.edges), 9) + pad(String(r.targetsDistinct), 10) + pad(String(r.ambiguousTargets), 11) + pad(String(r.unresolvedTargets), 12) + pad(String(r.markedExternal), 10) + String(r.unresolvedRaw),
      )
    }
    console.log("-".repeat(92))
    console.log("")
    console.log("`external` = unpublished target carrying a declared-external marker (dependency,")
    console.log("Node builtin, runtime global). It is a STATEMENT, not a resolution, and is not")
    console.log("counted against `unresolved`. `unres(raw)` is the same column with the marker")
    console.log("ignored, kept so the exemption can never hide its own size. Rule: incoming-gate.ts:38.")
    console.log("")
    console.log(`distinct declarations named by at least one edge : ${totalDistinct}`)
    console.log(`declarations nothing names (orphans)             : ${orphans} of ${declaredNames.length}`)
    console.log(`  In a language whose files are independent, a high orphan rate is CORRECT.`)
    console.log(`  A low one is not required and its absence is not a defect.`)
    console.log(`target names resolving to >1 published symbol      : ${ambiguousNames.length}`)
    if (ambiguousNames.length) {
      console.log("  Each is a place the reverse walk picks a winner by a rule nobody chose:")
      for (const n of ambiguousNames.slice(0, 8)) console.log(`    ${n} -> ${(published.get(n) ?? []).join(", ")}`)
      if (ambiguousNames.length > 8) console.log(`    … and ${ambiguousNames.length - 8} more`)
    }
    console.log("")
    console.log("An ambiguous target is ONE edge that the reverse walk will attribute to ONE declaration.")
    console.log("It is not N edges. Counting it as N is how a name collision becomes a wrong refactor.")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})