/**
 * RESOLUTION AUDIT — is an edge's target string ONE declaration, and which symbol is it?
 *
 * ## What the round brief asks and what `ambiguity-split.ts` could not answer
 *
 * The brief names three causes that look identical in a report: B format mismatch, A a name
 * that is not an identifier, C external. `ambiguity-split.ts` counts the AMBIGUOUS set, which
 * is a different population — a target that resolves to exactly one symbol in a DIFFERENT file
 * than the edge's source is not ambiguous and is not counted there, yet it is the case that
 * makes an edge mean the wrong thing. This file measures it.
 *
 * ## The four questions, each over the population of DISTINCT TARGET STRINGS an edge names
 *
 *   unresolved        no published symbol binds the string at all
 *   resolved_same_file      binds, and every binding is in the edge's own file
 *   resolved_other_file     binds, but only in OTHER files — a CROSS-FILE BINDING
 *   ambiguous         binds to >1 distinct kind (the arbiter's own test)
 *
 * `resolved_same_file` is deliberately LOOSE and the report says so, because the loose
 * reading is what let a defect through: a target that binds to eleven symbols, one of them
 * in the demanding file, is counted resolved here while the reverse walk — which matches by
 * name and takes a winner — has ten wrong candidates. So the per-target BINDING COUNT is
 * reported next to the verdict, and `bindings > 1` is the number that says an edge names
 * one specific thing or it does not.
 *
 * A cross-file binding is the finding that matters. The reverse walk matches a target string
 * to a declaration by name, so a `uses` edge that names `lodash` and binds to the lockfile's
 * `node_modules/lodash` entry is not unresolved, not ambiguous, and not an edge to the
 * declaration the document actually referred to. It reports 100% resolution and is wrong.
 *
 * ## B's symptom, tested as the brief states it
 *
 * "most targets containing a `.`, and almost all of them having their FINAL SEGMENT as a
 * published name." So for each unresolved target: is it dotted, and is its final dot-segment
 * published under some other file? That is a measurable pair, and it is what distinguishes a
 * spelling mismatch from a genuinely absent declaration.
 *
 * ## Regex-free: string tests and path segments only. It reads no source text — it consumes
 * what production `parseFile` published.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/json/resolution-audit.ts <file-list> [--json] [--samples N]
 *
 * READ-ONLY with respect to the corpus. Writes nothing.
 */
import * as path from "node:path"
import { readFileSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

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

const ontologyName = (raw: string): string | null => LABEL_ALIASES[raw] ?? null

type Binding = {
  file: string
  line: number
  kind: string
  name: string
  qualifiedName: string
  valueType: string
}

/** What an edge asks for: the target string, and the file that asks. */
type Demand = { file: string; types: Set<string>; edges: number }

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const samplesFlag = argv.indexOf("--samples")
const SAMPLES = samplesFlag >= 0 ? Number(argv[samplesFlag + 1]) || 10 : 10
const listFile = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--samples")
if (!listFile) {
  console.error("usage: npx tsx resolution-audit.ts <file-list> [--json] [--samples N]")
  process.exit(2)
}

const files = readFileSync(listFile, "utf8")
  .split("\n").filter(Boolean)

function repoOf(f: string): string {
  return path.basename(path.dirname(path.dirname(f)))
}
function relOf(f: string): string {
  const marker = path.basename(path.dirname(path.dirname(f)))
  return f.slice(f.lastIndexOf(marker) + marker.length + 1)
}

async function main(): Promise<void> {
  const projectPath = path.dirname(files[0])

  /** name or qualifiedName -> every DISTINCT symbol published under it. */
  const bindings = new Map<string, Binding[]>()
  const kindsOf = new Map<string, Set<string>>()
  /** target string -> who demands it. */
  const demand = new Map<string, Demand>()
  const edgesByType = new Map<string, number>()

  let symbols = 0
  let degraded = 0
  const parseFailures: string[] = []

  const register = (key: string, b: Binding): void => {
    const list = bindings.get(key)
    if (list) {
      for (const x of list) {
        if (x.file === b.file && x.line === b.line && x.kind === b.kind && x.qualifiedName === b.qualifiedName) return
      }
      list.push(b)
    } else bindings.set(key, [b])
    const ks = kindsOf.get(key)
    if (ks) ks.add(b.kind)
    else kindsOf.set(key, new Set([b.kind]))
  }

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
      const b: Binding = {
        file: f,
        line: Number(s?.startLine ?? s?.line_number ?? s?.line ?? -1),
        kind: String(s?.kind ?? ""),
        name,
        qualifiedName: String(s?.qualifiedName ?? ""),
        valueType: String(s?.metadata?.valueType ?? ""),
      }
      register(name, b)
      if (b.qualifiedName.length > 0 && b.qualifiedName !== name) register(b.qualifiedName, b)
    }

    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
      if (!label) continue
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
      if (tgt.length === 0) continue
      if (src === tgt) continue
      edgesByType.set(label, (edgesByType.get(label) ?? 0) + 1)
      const d = demand.get(tgt)
      if (d) {
        d.types.add(label)
        d.edges++
      } else demand.set(tgt, { file: f, types: new Set([label]), edges: 1 })
    }
  }

  // ---- classify every distinct target string an edge names --------------------------
  type Verdict = "unresolved" | "resolved_same_file" | "resolved_other_file" | "ambiguous"
  const verdicts = new Map<string, Verdict>()
  const bindingsOf = new Map<string, number>()
  /** Targets that DO bind in the demanding file, but to more than one symbol. This is the
   *  population `resolved_same_file` hides: the edge reads resolved and the reverse walk has
   *  N-1 wrong candidates. */
  let multiBindingSameFile = 0
  let singleBindingTotal = 0
  const multiBindingList: string[] = []
  const perTypeTotals: Record<string, { edges: number; targets: number; unresolved: number; crossFile: number; ambiguous: number; multiBinding: number }> = {}
  for (const t of TYPES) perTypeTotals[t] = { edges: 0, targets: 0, unresolved: 0, crossFile: 0, ambiguous: 0, multiBinding: 0 }

  const unresolvedList: string[] = []
  const crossFileList: string[] = []
  const ambiguousList: string[] = []

  for (const [tgt, d] of demand) {
    const list = bindings.get(tgt) ?? []
    const distinctKinds = kindsOf.get(tgt)?.size ?? 0
    bindingsOf.set(tgt, list.length)
    let v: Verdict
    if (list.length === 0) {
      v = "unresolved"
      unresolvedList.push(tgt)
    } else if (distinctKinds > 1) {
      v = "ambiguous"
      ambiguousList.push(tgt)
    } else if (list.some((b) => b.file === d.file)) {
      v = "resolved_same_file"
    } else {
      v = "resolved_other_file"
      crossFileList.push(tgt)
    }
    verdicts.set(tgt, v)
    if (v === "resolved_same_file") {
      if (list.length > 1) {
        multiBindingSameFile++
        multiBindingList.push(tgt)
      } else singleBindingTotal++
    }
    for (const t of d.types) {
      perTypeTotals[t].targets++
      if (v === "unresolved") perTypeTotals[t].unresolved++
      else if (v === "resolved_other_file") perTypeTotals[t].crossFile++
      else if (v === "ambiguous") perTypeTotals[t].ambiguous++
      if (v === "resolved_same_file" && list.length > 1) perTypeTotals[t].multiBinding++
    }
  }
  for (const [t, n] of edgesByType) perTypeTotals[t].edges = n

  // ---- THE SAME QUESTION, KEYED BY PROJECT ---------------------------------------------
  //
  // Everything above keys bindings GLOBALLY: one map for all 601 files, so `dotnet-tools.version`
  // published by Argu, Bolero and Deedle counts as three bindings and the target reads
  // ambiguous. That is the right reading for a corpus CENSUS — it answers "is this string one
  // thing anywhere in the corpus" — and the wrong reading for a resolution claim, because bb
  // indexes ONE PROJECT at a time. `bb_graph` on Argu resolves `dotnet-tools.version` against
  // Argu's own symbols, where it binds exactly once.
  //
  // So the global number is not a defect count and this per-project number is not a
  // replacement for it. They answer different questions and BOTH are reported. The finding
  // that matters is the difference: a target that binds many times globally and exactly once
  // per project is a corpus-shape artifact of the sample (601 files from 199 repositories, so
  // basename-derived paths collide across repositories), while a target that binds many times
  // WITHIN one project is a real collision — the name is not an identifier inside the scope
  // that actually has to resolve it.
  //
  // The project of a file is its repository root: CORPUS_ROOT/<repo>/..., which is two
  // directory levels above the file. `repoOf` already computes that basename.
  const bindingsInProject = new Map<string, Binding[]>()
  for (const [key, list] of bindings) {
    for (const b of list) {
      const pk = `${repoOf(b.file)} ${key}`
      const cur = bindingsInProject.get(pk)
      if (cur) cur.push(b)
      else bindingsInProject.set(pk, [b])
    }
  }
  /** Global binding count -> per-project binding count, for the demanding target's project. */
  let uniqueWithinProject = 0
  let multiWithinProject = 0
  let bindsOutsideProjectOnly = 0
  const multiWithinProjectList: string[] = []
  const perTypeWithinProject: Record<string, { targets: number; multi: number }> = {}
  for (const t of TYPES) perTypeWithinProject[t] = { targets: 0, multi: 0 }
  for (const [tgt, d] of demand) {
    const key = `${repoOf(d.file)} ${tgt}`
    const inProject = bindingsInProject.get(key)?.length ?? 0
    const global = bindings.get(tgt)?.length ?? 0
    let verdictWithin: "unresolved" | "unique" | "multi"
    if (inProject === 0) verdictWithin = global === 0 ? "unresolved" : "bindsOutsideProjectOnly"
    else if (inProject === 1) verdictWithin = "unique"
    else verdictWithin = "multi"
    if (verdictWithin === "unique") uniqueWithinProject++
    else if (verdictWithin === "multi") {
      multiWithinProject++
      multiWithinProjectList.push(tgt)
    } else if (verdictWithin === "bindsOutsideProjectOnly") bindsOutsideProjectOnly++
    for (const t of d.types) {
      perTypeWithinProject[t].targets++
      if (verdictWithin === "multi") perTypeWithinProject[t].multi++
    }
  }

  // ---- B's stated symptom, as a pair of measurable facts ------------------------------
  // For an unresolved target: is it dotted, and is its FINAL dot-segment published at all?
  let unresolvedDotted = 0
  let unresolvedDottedFinalSegmentPublished = 0
  for (const t of unresolvedList) {
    if (!t.includes(".")) continue
    unresolvedDotted++
    const final = t.slice(t.lastIndexOf(".") + 1)
    if (final.length > 0 && (bindings.get(final)?.length ?? 0) > 0) unresolvedDottedFinalSegmentPublished++
  }

  // A resolved cross-file binding: does the binding's qualified path even MENTION the
  // demanding file's module name? If not, the string matched by name alone.
  let crossFileNameOnly = 0
  const demandByTarget = new Map<string, Demand>(demand)
  for (const t of crossFileList) {
    const list = bindings.get(t) ?? []
    const d = demandByTarget.get(t)
    if (!d) continue
    const demandModule = path.basename(d.file).replace(/\.(json|jsonc|json5)$/i, "")
    const anyMentions = list.some((b) => {
      const mod = path.basename(b.file).replace(/\.(json|jsonc|json5)$/i, "")
      return b.qualifiedName.startsWith(`${mod}.`) || b.qualifiedName.startsWith(`${mod}[`) || b.qualifiedName === mod
    })
    if (!anyMentions) crossFileNameOnly++
    void demandModule
  }

  const totals = {
    targets: demand.size,
    unresolved: unresolvedList.length,
    resolved_same_file: [...verdicts.values()].filter((v) => v === "resolved_same_file").length,
    resolved_other_file: crossFileList.length,
    ambiguous: ambiguousList.length,
    resolved_same_file_to_one_symbol: singleBindingTotal,
    resolved_same_file_to_many_symbols: multiBindingSameFile,
  }

  const withinProject = {
    unique: uniqueWithinProject,
    multi: multiWithinProject,
    bindsOutsideProjectOnly: bindsOutsideProjectOnly,
    unresolved: totals.unresolved,
    targets: demand.size,
    perType: perTypeWithinProject,
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({
      files: files.length,
      symbols,
      degraded,
      parseFailures,
      totals,
      withinProject,
      bSymptom: {
        unresolvedDotted,
        unresolvedDottedFinalSegmentPublished,
        crossFileBindingsMatchingByNameOnly: crossFileNameOnly,
        resolvedButToManySymbols: multiBindingSameFile,
      },
      perType: perTypeTotals,
      samples: {
        unresolved: unresolvedList.slice(0, SAMPLES),
        resolved_other_file: crossFileList.slice(0, SAMPLES),
        ambiguous: ambiguousList.slice(0, SAMPLES),
        resolvedToManySymbols: multiBindingList.slice(0, SAMPLES),
        multiBindingWithinProject: multiWithinProjectList.slice(0, SAMPLES),
      },
    }, null, 2))
    return
  }

  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  console.log(`resolution audit — ${files.length} file(s), ${symbols} symbols, ${degraded} degraded, ${parseFailures.length} parse failures`)
  console.log("")
  console.log(`distinct target strings named by >=1 edge : ${totals.targets}`)
  console.log(`  resolved in the DEMANDING file           : ${totals.resolved_same_file}`)
  console.log(`     ...to exactly ONE symbol              : ${totals.resolved_same_file_to_one_symbol}`)
  console.log(`     ...to MORE THAN ONE symbol            : ${totals.resolved_same_file_to_many_symbols}   <-- reads resolved, is not`)
  console.log(`  resolved only in ANOTHER file            : ${totals.resolved_other_file}   <-- wrong-file binding`)
  console.log(`  ambiguous (>1 distinct kind)             : ${totals.ambiguous}`)
  console.log(`  unresolved (nothing published)           : ${totals.unresolved}`)
  const named = totals.targets
  const pct = (n: number) => (named ? ((n / named) * 100).toFixed(2) + "%" : "-")
  console.log(`  -- resolving to ANY symbol               : ${pct(totals.resolved_same_file + totals.resolved_other_file + totals.ambiguous)}`)
  console.log(`  -- resolving in the RIGHT file           : ${pct(totals.resolved_same_file)}`)
  console.log(`  -- resolving to ONE declaration          : ${pct(totals.resolved_same_file_to_one_symbol)}`)
  console.log("")
  console.log("THE BRIEF'S B SYMPTOM, as two counts:")
  console.log(`  unresolved targets containing a '.'                        : ${unresolvedDotted}`)
  console.log(`  ...of those, final dot-segment IS published under a file   : ${unresolvedDottedFinalSegmentPublished}`)
  console.log(`  cross-file bindings matching by NAME ALONE (no module in the path): ${crossFileNameOnly}`)
  console.log("")
  console.log("THE SAME TARGETS, KEYED BY PROJECT (repo) INSTEAD OF GLOBALLY:")
  console.log("  A project is one repository. bb indexes ONE project at a time, so this is the")
  console.log("  count that answers 'does an edge name one specific thing where it is resolved'.")
  console.log(`  binds to exactly ONE symbol in its OWN project : ${withinProject.unique}   (${pct(withinProject.unique)})`)
  console.log(`  binds to MORE THAN ONE in its OWN project      : ${withinProject.multi}`)
  console.log(`  binds only OUTSIDE its own project             : ${withinProject.bindsOutsideProjectOnly}`)
  console.log(`  binds nowhere                                  : ${withinProject.unresolved}`)
  console.log(`  -- the global multi-bind figure above is the SAME population spread across`)
  console.log(`     ${totals.resolved_same_file_to_many_symbols - withinProject.multi} repositories, not collisions inside one`)
  console.log("")
  console.log("PER TYPE, PER-PROJECT BINDING (targets charged to every type that names them):")
  console.log(pad("type", 15) + pad("targets", 10) + pad("multiInProject", 16))
  console.log("-".repeat(41))
  for (const t of TYPES) {
    const r = perTypeWithinProject[t]
    console.log(pad(t, 15) + pad(String(r.targets), 10) + String(r.multi))
  }
  console.log("")
  console.log("PER TYPE (edges counted once; a target string is charged to every type that names it):")
  console.log(pad("type", 15) + pad("edges", 10) + pad("targets", 10) + pad("unres", 8) + pad("crossFile", 11) + pad("ambig", 8) + "multiBind")
  console.log("-".repeat(70))
  for (const t of TYPES) {
    const r = perTypeTotals[t]
    console.log(pad(t, 15) + pad(String(r.edges), 10) + pad(String(r.targets), 10) + pad(String(r.unresolved), 8) + pad(String(r.crossFile), 11) + pad(String(r.ambiguous), 8) + String(r.multiBinding))
  }
  for (const [label, list] of [["unresolved", unresolvedList], ["resolved_other_file", crossFileList], ["ambiguous", ambiguousList], ["resolved_to_many_symbols", multiBindingList], ["multi_binding_WITHIN_project", multiWithinProjectList]] as const) {
    console.log("")
    console.log(`${label} (${list.length}), first ${Math.min(SAMPLES, list.length)}:`)
    for (const t of list.slice(0, SAMPLES)) {
      const d = demand.get(t)
      const list2 = bindings.get(t) ?? []
      const where = list2.slice(0, 3).map((b) => `${repoOf(b.file)}/${relOf(b.file)}:${b.kind}${b.valueType ? "/" + b.valueType : ""}`).join(", ")
      console.log(`  ${pad(t, 46)} x${pad(String(list2.length), 3)} asked by ${pad(d ? `${repoOf(d.file)}/${relOf(d.file)} [${[...d.types].join(",")}]` : "?", 70)} -> ${where || "NOTHING"}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})