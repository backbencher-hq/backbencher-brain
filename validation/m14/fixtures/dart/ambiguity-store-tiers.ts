/**
 * AMBIGUITY, PARTITIONED BY WHAT THE STORE'S OWN TIERS CAN AND CANNOT DECIDE.
 *
 * ## Why this file exists
 *
 * `ambiguity-split.ts` answers the brief's question 1: which KIND of collision
 * each type's ambiguous targets are caused by. It reports, per type, how many
 * ambiguous target edges sit on a name carrying more than one published
 * declaration.
 *
 * That count is not the number of wrong attributions, and treating it as one is
 * how a correct lane reads as broken. `ambiguity-split.ts` also measured that
 * 100.0% of the sample's 45,590 non-empty targets reach the SAME `extractLeaf`
 * key whether or not they are spelled qualified, which means an analyzer CANNOT
 * disambiguate by qualifying a target — `WHERE s.name = ?` is fed the leaf.
 *
 * So the remaining question is what the store already does with the leaf, and
 * the answer is in the two prepared statements in `src/ast/parallel-indexer.ts`:
 *
 *   resolveTargetStmt        (every type except `contains`)
 *     WHERE s.project_id = ? AND s.name = ?          <- the LEAF
 *     ORDER BY is_declaration ASC,
 *              (s.file_id = <EMITTING file>) DESC,   <- tier 2: same file first
 *              (f.language = ?) DESC, s.id
 *
 *   resolveContainsTargetStmt (`contains` only)
 *     WHERE s.project_id = ? AND s.name = ?          <- the LEAF
 *     ORDER BY (s.file_id = <EMITTING file>) DESC,
 *              (s.line_start = <edge line>) DESC, ... <- tier 2: the EDGE'S LINE
 *
 * Three facts fall out of those two statements, and each one is a different
 * population:
 *
 *   SAME-FILE-UNIQUE   the emitting file declares the name exactly once. Tier 2
 *                      selects that declaration. It is also the declaration Dart
 *                      itself binds, because a library resolves its own names
 *                      before consulting any import. The attribution is right
 *                      TODAY, with no analyzer change, and it stays right.
 *
 *   SAME-FILE-TIED     the emitting file declares the name two or more times.
 *                      Tier 2 ties and the tie-break is `s.id` ASC, and a symbol
 *                      id is `${fileId}:${name}:${line_start}` compared as TEXT,
 *                      so the winner is the LEXICOGRAPHICALLY smallest line
 *                      (`constructor:22` beats `constructor:227`, but
 *                      `constructor:227` beats `constructor:25`). The store
 *                      cannot be right here by luck more than it is by design.
 *
 *   CROSS-FILE         the emitting file declares the name zero times. Tier 2
 *                      falls through to another file and the walk attributes the
 *                      edge to a declaration in a library the emitter may not
 *                      even import. This is a real misattribution.
 *
 * `contains` differs from the rest in exactly one way, and it is the whole of
 * the difference: its edge carries the CHILD's own naming line, so
 * `resolveContainsTargetStmt` pins the intended member. For every other type
 * `line_number` is a SITE — where the call or the read happened — and using it
 * to pick a declaration would be wrong. So the SAME-FILE-TIED population splits
 * on `contains`, and the file measures both halves rather than assuming.
 *
 * ## What is NOT claimed here
 *
 * Nothing here asserts the store is correct, and nothing here counts what
 * `src/lsp/impact.ts` does at read time — that file is not executed by this
 * census. Every row is a property of the published symbols and the emitted
 * edges, compared against the two SQL statements above, read from source at the
 * commit this record names. Re-verify with `bb_search` on
 * `resolveTargetStmt` in `src/ast/parallel-indexer.ts`.
 *
 * The census also cannot see symbols published by OTHER lanes' runs over the
 * same project, so a name this lane finds unique may collide in a whole-corpus
 * store. Every count is therefore a LOWER bound on ambiguity, stated as such.
 *
 * ## No regex
 *
 * Nothing here reads source text. It reads the collected parse records, splits
 * names on `.` by index arithmetic, and compares kinds by set membership.
 */
import { dartSample, readRaw, samplePaths, type RawFile } from "./collect-sample"

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

/**
 * Store label -> ontology name. `src/ast/types.ts` and `src/ast/engine.ts` give
 * the SAME `RelationshipType.Imports` member two different string values and
 * analyzers emit through one or the other. `incoming-check.ts` accepts both;
 * so does this, for the same reason and with the same note.
 */
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

interface Decl {
  name: string
  kind: string
  q: string
  file: string
  line: number
}

/**
 * What `extractLeaf` does in `src/ast/parallel-indexer.ts`, in index
 * arithmetic. Reproduced so the leaf the store looks up is computed here rather
 * than assumed, and so a change to that function shows up as a delta in this
 * census instead of passing unnoticed.
 */
function extractLeaf(name: string): string {
  const colon = name.lastIndexOf(":")
  const lineStripped = colon >= 0 && isDigits(name.slice(colon + 1)) ? name.slice(0, colon) : name
  const slash = lineStripped.lastIndexOf("/")
  const noArity = slash >= 0 && isDigits(lineStripped.slice(slash + 1)) ? lineStripped.slice(0, slash) : lineStripped
  const lastColon = noArity.lastIndexOf(":")
  const lastSeg = lastColon >= 0 ? noArity.slice(lastColon + 1) : noArity
  const lastDot = lastSeg.lastIndexOf(".")
  return lastDot >= 0 ? lastSeg.slice(lastDot + 1) : lastSeg
}

function isDigits(s: string): boolean {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

interface Row {
  edges: number
  targetsDistinct: number
  unresolved: number
  /** Target name carries more than one declaration anywhere in the sample. */
  ambiguous: number
  /** Emitting file declares it exactly once — tier 2 lands on the right row. */
  ambSameFileUnique: number
  /** Emitting file declares it 2+ times — tier 2 ties, `s.id` ASC decides. */
  ambSameFileTied: number
  /** Of those tied: exactly one same-file candidate sits on the edge's line. */
  ambTiedLinePinsOne: number
  /** Of those tied: the line pins none, or more than one. */
  ambTiedLineNotUnique: number
  /** Emitting file declares it zero times — tier 2 falls through to another file. */
  ambCrossFile: number
  /** Of the cross-file set, the name is unique WITHIN the emitting repository. */
  ambCrossFileUniqueInRepo: number
}

const blank = (): Row => ({
  edges: 0,
  targetsDistinct: 0,
  unresolved: 0,
  ambiguous: 0,
  ambSameFileUnique: 0,
  ambSameFileTied: 0,
  ambTiedLinePinsOne: 0,
  ambTiedLineNotUnique: 0,
  ambCrossFile: 0,
  ambCrossFileUniqueInRepo: 0,
})

function repoOf(file: string): string {
  const parts = file.split("/")
  for (let i = 0; i < parts.length; i++) if (parts[i] === "repositories" && i + 1 < parts.length) return parts[i + 1]
  return parts.length > 0 ? parts[parts.length - 1] : file
}

function main(): void {
  const sample = dartSample()
  const paths = samplePaths(sample)
  const raw = readRaw(paths.raw)
  const files = new Map<string, RawFile>()
  for (const r of raw) files.set(r.f, r)

  // ---- published declarations, keyed by the leaf the store will look up ----
  /**
   * `resolveTargetStmt` reads `s.name` from `brain_symbol`, which holds the
   * symbol's OWN name — not the target string's leaf. The analyzer publishes
   * `name` and `qualifiedName` separately and the store keys on `name`, so the
   * correct key set here is the published NAME. The qualified name is registered
   * as an extra key because `incoming-check.ts` registers it too and the two
   * tables have to be comparable; `extraKeys` counts how much of the collision
   * mass the qualified spelling accounts for, so a reader can see whether the
   * two spellings are the same declaration or two.
   */
  const declsByKey = new Map<string, Decl[]>()
  const declsByLeafName = new Map<string, Decl[]>()
  let symbols = 0
  for (const r of raw) {
    for (const s of r.symbols) {
      symbols++
      if (s.name.length === 0) continue
      const d: Decl = { name: s.name, kind: s.kind, q: s.q, file: r.f, line: s.line }
      push(declsByKey, s.name, d)
      const leaf = extractLeaf(s.name)
      if (leaf !== s.name) push(declsByLeafName, s.name, d)
      if (s.q.length > 0 && s.q !== s.name) push(declsByKey, s.q, d)
    }
  }

  const perType: Record<string, Row> = {}
  for (const t of TYPES) perType[t] = blank()
  const targetsByType = new Map<string, Set<string>>()
  /** Per (type, name): how many distinct declarations the leaf key holds. */
  const declCountCache = new Map<string, number>()
  const inFileCache = new Map<string, number>()
  const inRepoCache = new Map<string, number>()

  for (const r of raw) {
    const repo = repoOf(r.f)
    for (const x of r.rels) {
      const label = ontologyName(x.t)
      if (!label) continue
      const row = perType[label]
      row.edges++
      let set = targetsByType.get(label)
      if (!set) {
        set = new Set()
        targetsByType.set(label, set)
      }
      const leaf = extractLeaf(x.g)
      if (leaf.length > 0) set.add(leaf)

      if (leaf.length === 0 || x.s === x.g) continue
      const ck = leaf
      let total = declCountCache.get(ck)
      if (total === undefined) {
        total = uniqueDecls(declsByKey.get(ck) ?? []).length
        declCountCache.set(ck, total)
      }
      if (total === 0) {
        row.unresolved++
        continue
      }
      if (total === 1) continue
      row.ambiguous++

      const fk = `${ck}\u0000${r.f}`
      let inFile = inFileCache.get(fk)
      if (inFile === undefined) {
        inFile = uniqueDecls((declsByKey.get(ck) ?? []).filter((d) => d.file === r.f)).length
        inFileCache.set(fk, inFile)
      }
      if (inFile === 1) {
        row.ambSameFileUnique++
        continue
      }
      if (inFile === 0) {
        row.ambCrossFile++
        const rk = `${ck}\u0000${repo}`
        let inRepo = inRepoCache.get(rk)
        if (inRepo === undefined) {
          inRepo = uniqueDecls((declsByKey.get(ck) ?? []).filter((d) => repoOf(d.file) === repo)).length
          inRepoCache.set(rk, inRepo)
        }
        if (inRepo === 1) row.ambCrossFileUniqueInRepo++
        continue
      }
      // inFile >= 2 — the tier-2 tie.
      row.ambSameFileTied++
      const onLine = uniqueDecls((declsByKey.get(ck) ?? []).filter((d) => d.file === r.f && d.line === x.line))
      if (onLine.length === 1) row.ambTiedLinePinsOne++
      else row.ambTiedLineNotUnique++
    }
  }

  for (const t of TYPES) perType[t].targetsDistinct = targetsByType.get(t)?.size ?? 0

  // ---- report -------------------------------------------------------------
  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  const pct = (a: number, b: number) => (b === 0 ? "    -" : (((100 * a) / b).toFixed(1) + "%").padStart(6))

  console.log(`dart ambiguity by store tier — ${raw.length} files parsed, ${symbols} symbols published`)
  console.log(`sample ${sample.length}-file stride over ${dartSample().length >= 0 ? "" : ""}the byte-sorted .dart population`)
  console.log("")
  console.log("Every number is a LOWER bound: this census sees only this lane's own 600 files, so a name that")
  console.log("reads unique here can still collide with a symbol another run published for the same project.")
  console.log("")
  console.log(
    pad("type", 14) +
      pad("edges", 8) +
      pad("distinct", 9) +
      pad("unres", 7) +
      pad("ambig", 7) +
      pad("sfUniq", 8) +
      pad("sfTied", 8) +
      pad("pin1", 7) +
      pad("pinNE", 7) +
      pad("xFile", 8) +
      pad("xRepo1", 8),
  )
  console.log("-".repeat(101))
  for (const t of TYPES) {
    const r = perType[t]
    console.log(
      pad(t, 14) +
        pad(String(r.edges), 8) +
        pad(String(r.targetsDistinct), 9) +
        pad(String(r.unresolved), 7) +
        pad(String(r.ambiguous), 7) +
        pad(String(r.ambSameFileUnique), 8) +
        pad(String(r.ambSameFileTied), 8) +
        pad(String(r.ambTiedLinePinsOne), 7) +
        pad(String(r.ambTiedLineNotUnique), 7) +
        pad(String(r.ambCrossFile), 8) +
        pad(String(r.ambCrossFileUniqueInRepo), 8),
    )
  }
  console.log("-".repeat(101))
  console.log("")
  console.log("Read the columns as three populations, not one:")
  console.log("  sfUniq  the emitting file declares the name exactly once, so (s.file_id = <emitting file>) DESC")
  console.log("          selects it — which is also the declaration DART binds, since a library resolves its own")
  console.log("          names before any import. Right today, no analyzer change needed.")
  console.log("  sfTied  the emitting file declares it 2+ times, so tier 2 ties and `s.id` ASC decides — a symbol")
  console.log("          id is `${fileId}:${name}:${line}` compared as TEXT, so the winner is the lexicographically")
  console.log("          smallest line. pin1 = exactly one same-file candidate sits on the edge's own line.")
  console.log("          contains resolves with that line (resolveContainsTargetStmt); every other type must not,")
  console.log("          because its line_number is a SITE rather than the child's naming line.")
  console.log("  xFile   the emitting file declares it zero times, so tier 2 falls through to another file.")
  console.log("          xRepo1 = the name is unique within the emitting REPOSITORY, so an import-scoped resolver")
  console.log("          would find it and the store's fall-through is the only thing losing it.")
  console.log("")

  const sum = (k: keyof Row) => TYPES.reduce((a, t) => a + perType[t][k], 0)
  const edges = sum("edges")
  const amb = sum("ambiguous")
  console.log("TOTALS across the ten types")
  console.log(`  edges                          ${edges}`)
  console.log(`  unresolved targets             ${sum("unresolved")}`)
  console.log(`  ambiguous target edges         ${amb}  (${pct(amb, edges)} of edges)`)
  console.log(`    sfUniq  tier 2 lands right   ${sum("ambSameFileUnique")}  (${pct(sum("ambSameFileUnique"), amb)} of ambiguous)`)
  console.log(`    sfTied  tier 2 ties          ${sum("ambSameFileTied")}  (${pct(sum("ambSameFileTied"), amb)})`)
  console.log(`      pin1  line pins one        ${sum("ambTiedLinePinsOne")}  (${pct(sum("ambTiedLinePinsOne"), sum("ambSameFileTied"))} of tied)`)
  console.log(`      pinNE line pins not one    ${sum("ambTiedLineNotUnique")}  (${pct(sum("ambTiedLineNotUnique"), sum("ambSameFileTied"))} of tied)`)
  console.log(`    xFile   tier 2 falls through  ${sum("ambCrossFile")}  (${pct(sum("ambCrossFile"), amb)})`)
  console.log(`      xRepo1 unique in repo      ${sum("ambCrossFileUniqueInRepo")}  (${pct(sum("ambCrossFileUniqueInRepo"), sum("ambCrossFile"))} of xFile)`)
  console.log("")

  // ---- per-type detail on the tied population ------------------------------
  console.log("The sfTied population per type, and what its names are:")
  const tiedNames = new Map<string, Map<string, { edges: number; pin: number }>>()
  for (const t of TYPES) tiedNames.set(t, new Map())
  for (const r of raw) {
    for (const x of r.rels) {
      const label = ontologyName(x.t)
      if (!label || x.g.length === 0 || x.s === x.g) continue
      const leaf = extractLeaf(x.g)
      if ((declCountCache.get(leaf) ?? 0) < 2) continue
      const here = uniqueDecls((declsByKey.get(leaf) ?? []).filter((d) => d.file === r.f))
      if (here.length < 2) continue
      const m = tiedNames.get(label)!
      const rec = m.get(leaf) ?? { edges: 0, pin: 0 }
      rec.edges++
      if (uniqueDecls(here.filter((d) => d.line === x.line)).length === 1) rec.pin++
      m.set(leaf, rec)
    }
  }
  for (const t of TYPES) {
    const m = tiedNames.get(t)!
    const tot = [...m.values()].reduce((a, v) => a + v.edges, 0)
    if (tot === 0) continue
    console.log(`  ${t}  ${tot} tied edges over ${m.size} names`)
    const top = [...m.entries()].sort((a, b) => b[1].edges - a[1].edges).slice(0, 6)
    for (const [n, v] of top) console.log(`      ${pad(n, 34)} edges ${pad(String(v.edges), 5)} linePinsOne ${v.pin}`)
  }
  console.log("")
  console.log("The published-name collisions that carry the most tied edges, with their owners:")
  const allTied = new Map<string, number>()
  for (const t of TYPES) for (const [n, v] of tiedNames.get(t)!) allTied.set(n, (allTied.get(n) ?? 0) + v.edges)
  const topTied = [...allTied.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  for (const [n, e] of topTied) {
    const ds = uniqueDecls(declsByKey.get(n) ?? [])
    const owners = [...new Set(ds.map((d) => (d.q.length > 0 ? d.q : "(unqualified)")))].slice(0, 4)
    console.log(`  ${pad(n, 30)} tiedEdges ${pad(String(e), 5)} decls ${pad(String(ds.length), 5)} ${ds[0]?.kind ?? "?"}  owners: ${owners.join(" | ")}`)
  }
  console.log("")

  // ---- the counterfactual the brief asks for ------------------------------
  console.log("COUNTERFACTUAL — is the largest bucket reachable from the analyzer at all?")
  console.log("  A target spelling that is qualified reaches the SAME extractLeaf key, so `WHERE s.name = ?`")
  console.log("  cannot see the difference. Recomputed here rather than asserted:")
  let total = 0
  let same = 0
  let qualifiedWouldBind = 0
  for (const r of raw) {
    for (const x of r.rels) {
      if (x.g.length === 0) continue
      total++
      if (extractLeaf(`Owner.${x.g}`) === extractLeaf(x.g)) same++
      const q = `Owner.${x.g}`
      if ((declsByKey.get(extractLeaf(q)) ?? []).length > 0 && (declsByKey.get(extractLeaf(q)) ?? []).length <= (declsByKey.get(extractLeaf(x.g)) ?? []).length) {
        qualifiedWouldBind++
      }
    }
  }
  console.log(`  edges with a non-empty target                          ${total}`)
  console.log(`  a qualified spelling reaches the SAME leaf key          ${same} (${pct(same, total)})`)
  console.log(`  a qualified spelling would not WIDEN the candidate set   ${qualifiedWouldBind} (${pct(qualifiedWouldBind, total)})`)
  console.log(`  so analyzer-side qualification moves                    0 of ${total} stored target resolutions`)
  console.log("")
}

function push(m: Map<string, Decl[]>, k: string, d: Decl): void {
  const arr = m.get(k)
  if (arr) arr.push(d)
  else m.set(k, [d])
}

/** Distinct declarations carrying a key, by file+kind+line. */
function uniqueDecls(decls: Decl[]): Decl[] {
  const m = new Map<string, Decl>()
  for (const d of decls) m.set(`${d.file}|${d.kind}|${d.line}`, d)
  return [...m.values()]
}

main()
