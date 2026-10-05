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
  selfLoops: number
}

function blank(): TypeRow {
  return { fired: false, edges: 0, targetsDistinct: 0, ambiguousTargets: 0, unresolvedTargets: 0, selfLoops: 0 }
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
  const published = new Map<string, string[]>() // name -> kinds
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
    // published symbols is not 3 incoming edges; it is ONE edge the reverse walk
    // will attribute to whichever of the 3 its rule picks.
    const hits = published.get(tgt)
    if (!hits || hits.length === 0) {
      row.unresolvedTargets++
      continue
    }
    if (hits.length > 1) row.ambiguousTargets++

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
      const hits = published.get(tgt)
      if (!hits || hits.length === 0) {
        unres++
        continue
      }
      if (hits.length > 1) amb++
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
      pad("type", 16) + pad("fired", 7) + pad("edges", 9) + pad("distinct", 10) + pad("ambiguous", 11) + "unresolved",
    )
    console.log("-".repeat(74))
    for (const t of TYPES) {
      const r = perType[t]
      console.log(
        pad(t, 16) + pad(r.fired ? "yes" : "NO", 7) + pad(String(r.edges), 9) + pad(String(r.targetsDistinct), 10) + pad(String(r.ambiguousTargets), 11) + String(r.unresolvedTargets),
      )
    }
    console.log("-".repeat(74))
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