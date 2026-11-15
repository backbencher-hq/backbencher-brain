/**
 * AMBIGUITY SPLIT — which of the three buckets this lane's ambiguous targets fall into.
 *
 * ## What the shared arbiter measures, precisely
 *
 * `script/m14/incoming-check.ts` registers every published symbol under BOTH its `name` and
 * its `qualifiedName` in one `Map<string, SymbolKind[]>`, and calls a target **ambiguous**
 * when that map holds **more than one distinct KIND** for the target string:
 *
 *     const hits = published.get(tgt)
 *     if (!hits || hits.length === 0) { row.unresolvedTargets++; continue }
 *     if (hits.length > 1) row.ambiguousTargets++
 *
 * Two consequences, and this file exists to measure both rather than assume them:
 *
 *   1. "ambiguous" is NOT "more than one declaration". Two symbols published under one
 *      string with the SAME kind are counted RESOLVED. So the arbiter's number is a
 *      lower bound on name collision, and a collision census has to be written to be
 *      reported at all.
 *   2. in THIS analyzer a symbol's kind is decided by its VALUE — `object` publishes
 *      `SymbolKind.Class`, everything else publishes `SymbolKind.Property`
 *      (`src/ast/real-json-analyzer.ts:440`). So a name is kind-ambiguous exactly when the
 *      same string is an object somewhere in the sample and a non-object somewhere else.
 *      That is a statement about the DATA, and it is the sharpest possible statement:
 *      the target string is not a unique identifier for a declaration.
 *
 * ## The three buckets the round brief asks for
 *
 * For each distinct ambiguous target string, every published symbol backing it is
 * collected with (file, line, kind, bare name, qualifiedName, scope), and the string is
 * filed under exactly one bucket:
 *
 *   A  INTRA-FILE — more than one distinct symbol in ONE file. Two declarations in the same
 *                  document share a published name. If the analyzer has a position for
 *                  them it failed to use it, and the fix is in this lane.
 *   B  CROSS-FILE, FILE IS SUFFICIENT — the candidates span more than one file, and within
 *                  each file exactly ONE candidate. Adding the file to the published name
 *                  separates them completely. The cause is that a JSON qualified path is
 *                  DOCUMENT-INTERNAL: `documentName()` (line 1606) returns the basename
 *                  without its extension, so `package.repository` means "the `repository`
 *                  key of the file called `package`" and two repositories have one.
 *   C  CROSS-FILE, FILE IS NOT SUFFICIENT — the candidates span more than one file AND at
 *                  least one file holds more than one candidate. Adding the file does not
 *                  close it, so it is not a naming fix; it is a scoping failure inside a
 *                  single document.
 *
 * B is a finding about the PUBLISHED-NAME CONTRACT, not about this analyzer: the doc
 * already states the contract as "the basename WITHOUT its extension", and changing it
 * would rewrite every qualified name in the corpus. C is the bucket that is unambiguously
 * this lane's. A is too.
 *
 * ## Regex-free: string and path-segment tests only. It reads no source text at all —
 * it consumes what production `parseFile` published.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/json/ambiguity-split.ts <file-list> [--json]
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

/** Store label -> ontology name. Both spellings of the same enum member are accepted,
 *  because `src/ast/types.ts` and `src/ast/engine.ts` disagree and the arbiter accepts both. */
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

/** One published symbol backing an ambiguous target string. */
type Backing = {
  file: string
  line: number
  kind: string
  /** The symbol's own bare key, which is NOT the target string for a qualified target. */
  name: string
  qualifiedName: string
  scope: string
}

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const listFile = argv.find((a) => !a.startsWith("--"))
if (!listFile) {
  console.error("usage: npx tsx ambiguity-split.ts <file-list> [--json]")
  process.exit(2)
}

const files = readFileSync(listFile, "utf8")
  .split("\n")
  .filter(Boolean)

/** target string -> every published symbol registered under it. */
const backing = new Map<string, Backing[]>()
/** target string -> the distinct kinds registered under it, which is the arbiter's test. */
const kinds = new Map<string, Set<string>>()
const edgesByType = new Map<string, number>()
const targetsByType = new Map<string, Set<string>>()
/** An edge target string -> the set of types that name it. */
const typesNaming = new Map<string, Set<string>>()

/** The corpus repo a file belongs to, so two repositories' identically-named files print
 *  as different rows. `basename(dirname)` collapsed them, which made `B`'s evidence look
 *  like one file when it is N. */
function repoOf(f: string): string {
  return path.basename(path.dirname(path.dirname(f)))
}
function relOf(f: string): string {
  return f.slice(f.lastIndexOf(path.basename(path.dirname(path.dirname(f)))) + path.basename(path.dirname(path.dirname(f))).length + 1)
}

async function main(): Promise<void> {
  const projectPath = path.dirname(files[0])
  let symbols = 0
  let degraded = 0
  const parseFailures: string[] = []

  const addBacking = (key: string, b: Backing): void => {
    const list = backing.get(key)
    if (list) list.push(b)
    else backing.set(key, [b])
    const k = kinds.get(key)
    if (k) k.add(b.kind)
    else kinds.set(key, new Set([b.kind]))
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
      const b: Backing = {
        file: f,
        line: Number(s?.startLine ?? s?.line_number ?? s?.line ?? -1),
        kind: String(s?.kind ?? ""),
        name,
        qualifiedName: String(s?.qualifiedName ?? ""),
        scope: String(s?.scope ?? ""),
      }
      addBacking(name, b)
      const q = b.qualifiedName
      if (q.length > 0 && q !== name) addBacking(q, b)
    }

    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
      if (!label) continue
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
      if (tgt.length === 0) continue
      if (src === tgt) continue
      edgesByType.set(label, (edgesByType.get(label) ?? 0) + 1)
      let ts = targetsByType.get(label)
      if (!ts) targetsByType.set(label, (ts = new Set()))
      ts.add(tgt)
      let tn = typesNaming.get(tgt)
      if (!tn) typesNaming.set(tgt, (tn = new Set()))
      tn.add(label)
    }
  }

  // ---- the split ---------------------------------------------------------------------
  type Bucket = "A_intra_file" | "B_cross_file_file_sufficient" | "C_cross_file_file_insufficient"
  const buckets = new Map<Bucket, string[]>()
  const addBucket = (b: Bucket, t: string): void => {
    const l = buckets.get(b)
    if (l) l.push(t)
    else buckets.set(b, [t])
  }

  // A name collision census: >1 DISTINCT symbol, which is broader than the arbiter's
  // kind test and is reported alongside it so the two populations are not confused.
  let collisionNames = 0
  let collisionSymbols = 0

  // The population is the strings EDGES NAME — the same population `incoming-check.ts`
  // reports, and the only one where ambiguity has a consequence. A published name no edge
  // ever targets cannot make the reverse walk pick a wrong winner, so counting it would
  // inflate the figure with symbols nothing points at.
  const namedStrings = new Set<string>()
  for (const s of targetsByType.values()) for (const t of s) namedStrings.add(t)

  const ambiguous = [...namedStrings].filter((k) => (kinds.get(k)?.size ?? 0) > 1)
  for (const tgt of ambiguous) {
    const list = backing.get(tgt) ?? []
    // Deduplicate to DISTINCT symbols: a symbol is registered under both `name` and
    // `qualifiedName`, and the same symbol can appear in several positions.
    const distinct: Backing[] = []
    const seen = new Set<string>()
    for (const b of list) {
      const key = `${b.file} ${b.line} ${b.kind} ${b.name} ${b.qualifiedName}`
      if (seen.has(key)) continue
      seen.add(key)
      distinct.push(b)
    }
    const byFile = new Map<string, Backing[]>()
    for (const b of distinct) {
      const l = byFile.get(b.file)
      if (l) l.push(b)
      else byFile.set(b.file, [b])
    }
    if (distinct.length > 1) {
      collisionNames++
      collisionSymbols += distinct.length
    }
    if (byFile.size === 1) addBucket("A_intra_file", tgt)
    else if ([...byFile.values()].every((l) => l.length === 1)) addBucket("B_cross_file_file_sufficient", tgt)
    else addBucket("C_cross_file_file_insufficient", tgt)
  }

  // ---- report ------------------------------------------------------------------------
  const perType: Record<string, { edges: number; distinctTargets: number; ambiguousTargets: number }> = {}
  for (const t of TYPES) {
    const targets = targetsByType.get(t) ?? new Set<string>()
    let amb = 0
    for (const x of targets) if ((kinds.get(x)?.size ?? 0) > 1) amb++
    perType[t] = { edges: edgesByType.get(t) ?? 0, distinctTargets: targets.size, ambiguousTargets: amb }
  }

  const sample = (b: Bucket, n = 8): string[] => (buckets.get(b) ?? []).slice(0, n)

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          files: files.length,
          symbols,
          degraded,
          parseFailures,
          namedTargetStrings: namedStrings.size,
          registeredNames: kinds.size,
          arbiterAmbiguousNames: ambiguous.length,
          collisionNames,
          collisionSymbols,
          buckets: Object.fromEntries([...buckets].map(([k, v]) => [k, v.length])),
          bucketMembers: Object.fromEntries([...buckets]),
          perType,
        },
        null,
        2,
      ),
    )
    return
  }

  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  console.log(`ambiguity split — ${files.length} file(s), ${symbols} symbols, ${degraded} degraded, ${parseFailures.length} parse failures`)
  console.log("")
  console.log(`target strings named by >=1 edge                 : ${namedStrings.size}`)
  console.log(`of those, bound to >=1 published symbol           : ${[...namedStrings].filter((k) => (kinds.get(k)?.size ?? 0) > 0).length}`)
  console.log(`ambiguous by the ARBITER'S TEST (>1 distinct KIND)  : ${ambiguous.length}`)
  console.log(`ambiguous by a NAME COLLISION (>1 distinct symbol)   : ${collisionNames}  backing ${collisionSymbols} symbols`)
  console.log("")
  console.log("THE SPLIT, over the arbiter's ambiguous set:")
  const totalAmb = ambiguous.length
  for (const b of ["A_intra_file", "B_cross_file_file_sufficient", "C_cross_file_file_insufficient"] as const) {
    const n = buckets.get(b)?.length ?? 0
    console.log(
      `  ${pad(b, 34)} ${pad(String(n), 5)} ${pad(
        totalAmb ? ((n / totalAmb) * 100).toFixed(2) + "%" : "-",
        9,
      )}`,
    )
  }
  console.log("")
  for (const b of ["A_intra_file", "B_cross_file_file_sufficient", "C_cross_file_file_insufficient"] as const) {
    console.log(`  ${b}:`)
    for (const t of sample(b)) {
      const list = (backing.get(t) ?? []).filter((x, i, a) => a.findIndex((y) => y.file === x.file && y.line === x.line && y.kind === x.kind && y.name === x.name && y.qualifiedName === x.qualifiedName) === i)
      const filesN = new Set(list.map((x) => x.file)).size
      console.log(`    ${t}  [${list.length} symbol(s) across ${filesN} file(s)]`)
      for (const x of list.slice(0, 4)) {
        console.log(`        ${x.kind.padEnd(10)} line ${String(x.line).padEnd(6)} ${repoOf(x.file)}/${relOf(x.file)}`)
      }
    }
    console.log("")
  }
  console.log("PER TYPE:")
  console.log(pad("type", 16) + pad("edges", 10) + pad("distinctTargets", 18) + "ambiguousTargets")
  console.log("-".repeat(60))
  for (const t of TYPES) {
    const r = perType[t]
    console.log(pad(t, 16) + pad(String(r.edges), 10) + pad(String(r.distinctTargets), 18) + String(r.ambiguousTargets))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})