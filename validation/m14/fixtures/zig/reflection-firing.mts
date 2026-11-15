/**
 * WHAT THE ANALYZER EMITS AT THE 206 REFLECTION-BUILTIN SITES — the firing half of the
 * pass-24 GAP.
 *
 * `reflection-builtin-probe.mts` counted 989 `@hasDecl`/`@field` call sites on the parse
 * tree and the analyzer source contains none of them. That establishes the construct is
 * present and unread. It does NOT establish what an edge here SHOULD be, and emitting a
 * plausible edge is precisely how a lane fabricates one, so this probe measures the
 * status quo per site instead of asserting a target:
 *
 *   - drive the PRODUCTION entry point (`parseFile` from src/ast/pool-worker.ts), never
 *     `analyze()`, so pool-worker, truncation and the enhancements are all in the path;
 *   - for each named occurrence, list every relationship whose published range covers
 *     that line, so the reader sees what IS there rather than a count of nothing;
 *   - report, per occurrence, whether any emitted edge's TARGET equals the declaration
 *     name the builtin spells as a string.
 *
 * The string name is the interesting half because the container is an ordinary
 * identifier expression: `@hasDecl(S, "a")` reads `S` and asks about `"a"`. The probe
 * keeps the two apart, because they have different owners and only one of them is a
 * declaration the file itself publishes.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/reflection-firing.mts --from <merged.json> [--out p]
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const ROOT = path.resolve(process.cwd())
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const FROM = arg("from", "")
const OUT = arg("out", "")
if (!FROM) {
  process.stderr.write("usage: reflection-firing.mts --from <reflection-merge output.json> [--out p]\n")
  process.exit(64)
}

const merged = JSON.parse(readFileSync(FROM, "utf8")) as {
  occurrences: number
  allOccurrences: {
    builtin: string
    file: string
    line: number
    col: number
    container: string | null
    name: string | null
    namePublishedInFile: boolean | null
  }[]
}

// Only the sites that spell a declaration are in scope here: a `@field(T, 0)` indexes by
// an integer and names nothing, so there is no target to miss.
const named = merged.allOccurrences.filter((o) => o.name !== null)

const byFile = new Map<string, typeof named>()
for (const o of named) {
  const a = byFile.get(o.file)
  if (a) a.push(o)
  else byFile.set(o.file, [o])
}

type SiteRow = {
  builtin: string
  file: string
  line: number
  container: string | null
  name: string
  namePublishedInFile: boolean | null
  /**
   * How many symbols in this file carry the declaration's name. An edge to the name resolves
   * cleanly at one, is AMBIGUOUS above one (deliverable B: an ambiguous target is one edge
   * attributed to one declaration, and counting it as N is how a name collision becomes a
   * wrong refactor), and does not resolve at zero.
   */
  nameResolveArity: number
  /** Whether the CONTAINER argument is a bare identifier naming something this file publishes. */
  containerResolvesInFile: boolean | null
  edgesOnLine: number
  edgesNamingTheDeclaration: number
  edgeTypesOnLine: Record<string, number>
  /** Why each naming edge exists, by the analyzer's own reason code. */
  namingEdgeReasons: Record<string, number>
  targetsOnLine: string[]
}

const rows: SiteRow[] = []
const filesSeen: string[] = []
let parseFailures = 0
let fallbackFiles = 0
let degradedFiles: string[] = []

for (const [rel, sites] of [...byFile.entries()].sort()) {
  const abs = path.join(CR, rel)
  let res: any
  try {
    res = await parseFile(abs, path.dirname(abs))
  } catch (e: any) {
    parseFailures++
    continue
  }
  filesSeen.push(rel)
  if (res?.fallback === true) {
    fallbackFiles++
    degradedFiles.push(rel)
  }
  const rels: any[] = Array.isArray(res?.relationships) ? res.relationships : []
  const syms: any[] = Array.isArray(res?.symbols) ? res.symbols : []
  // Published names, and the arity of each, so "does this target resolve" is a measurement
  // rather than an assumption. `canonicalizePublishedNames` has already run inside parseFile,
  // so these are the names the index actually holds.
  const arity = new Map<string, number>()
  for (const s of syms) {
    const n = String(s?.name ?? "")
    if (!n) continue
    arity.set(n, (arity.get(n) ?? 0) + 1)
  }
  // EDGE-LEVEL, because the line-level view above cannot distinguish "the analyzer did not
  // read this site" from "the analyzer read it and the edge lost a deduplication to a
  // sibling site naming the same declaration". Measured: on the 22 named `@field` sites the
  // line-level view reads 7, and the edge-level view reads 18 sites represented by 7 edges —
  // `zig/test/behavior/member_func.zig:77,78` name `one`/`two`, the reflection edge for each
  // is emitted, and Z52's post-pass collapses one `uses` edge per (source, target) keeping
  // the higher confidence, so the dot-access edge the file already published at line 39/62
  // wins. Reporting 7 as the firing count would understate the pass by 11 sites and would
  // file a working derivation as a miss. So per site, FILE-WIDE:
  //   - does ANY `zig_field_reflection` edge in this file carry this name as its target?
  //   - if not, does ANY edge at all name it? Then the name IS represented in the graph and
  //     the missing reflection reason code is a label question, not a coverage one.
  const reflectionTargets = new Set<string>()
  let reflectionEdgesInFile = 0
  const anyEdgeTargets = new Set<string>()
  for (const r of rels) {
    const tgt = String(r?.target ?? "")
    if (tgt) anyEdgeTargets.add(tgt)
    if (String(r?.metadata?.relationshipType ?? "") === "zig_field_reflection") {
      reflectionEdgesInFile++
      if (tgt) reflectionTargets.add(tgt)
    }
  }
  // ≡ /^[A-Za-z_][A-Za-z0-9_]*$/, the analyzer's own guard, restated here so the report can
  // name WHY a site produced nothing rather than leaving it unexplained.
  const isIdentifierShaped = (t: string): boolean => {
    const isStart = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    const isRest = (c: number) => isStart(c) || (c >= 48 && c <= 57)
    if (!t.length || !isStart(t.charCodeAt(0))) return false
    for (let i = 1; i < t.length; i++) if (!isRest(t.charCodeAt(i))) return false
    return true
  }
  for (const s of sites) {
    const nameArity = arity.get(s.name!) ?? 0
    const containerArity = s.container ? (arity.get(s.container) ?? 0) : 0
    const represented = reflectionTargets.has(s.name!)
    const nonFiringReason = represented
      ? null
      : !isIdentifierShaped(s.name!)
        ? "name-is-not-identifier-shaped: an error-set member, which this corpus reads with @field(anyerror, \"...\")"
        : s.builtin === "@hasDecl"
          ? "existence-test: the construct is a question, not a read, and is deliberately not emitted"
          : anyEdgeTargets.has(s.name!)
            ? "deduplicated: the reflection edge lost Z52's one-uses-edge-per-(source,target) collapse to an edge this file already publishes naming the same declaration"
            : "no edge in this file names this declaration"
    const onLine = rels.filter((r: any) => {
      // The published range is the only positional fact available on a relationship; when a
      // relationship carries no range it cannot be attributed to a line and is not counted here.
      const st = r?.startLine ?? r?.line_number ?? r?.line
      return typeof st === "number" && st === s.line
    })
    const types: Record<string, number> = {}
    const targets: string[] = []
    const reasons: Record<string, number> = {}
    let naming = 0
    for (const r of onLine) {
      const t = String(r?.type ?? "?")
      types[t] = (types[t] ?? 0) + 1
      const tgt = String(r?.target ?? "")
      targets.push(tgt)
      if (tgt === s.name) {
        naming++
        // The reason code is what separates "an edge for THIS read" from "another construct
        // that happens to share the line". A relationship carries no range — only
        // `line_number` — so line agreement alone cannot tell `x.clone()` on the same line as
        // `@hasDecl(T, "clone")` from a read of the declaration `clone`. The analyzer's own
        // metadata does: `zig_function_call` on ghostty/src/config/Config.zig:5206 is
        // `cloneValue -> clone` with callExpression `src.clone(alloc)`, which has nothing to
        // do with the reflection. Publishing 52 sites as "already emitted" on line agreement
        // would have been exactly that error.
        const why = String(r?.metadata?.relationshipType ?? "<none>")
        reasons[why] = (reasons[why] ?? 0) + 1
      }
    }
    rows.push({
      builtin: s.builtin,
      file: rel,
      line: s.line,
      container: s.container,
      name: s.name,
      namePublishedInFile: s.namePublishedInFile,
      nameResolveArity: nameArity,
      containerResolvesInFile: s.container === null ? null : containerArity > 0,
      /** Does the file publish a `zig_field_reflection` edge carrying this name as its target? */
      representedByAReflectionEdge: represented,
      /**
       * …and was that edge attributed to THIS site's line? The two must stay apart, because a
       * file-wide match also fires when a DIFFERENT site in the same file names the same
       * declaration: `ghostty/src/input/Binding.zig:1320` is `@hasDecl(…, "default")` and
       * :1324 is `@field(field.type, "default")`, so the file-wide test marks the existence
       * test "represented" when nothing about it was read. That row is also the deliverable-B
       * ambiguity case — four published symbols in that file share the name `default`.
       */
      reflectionEdgeOnThisLine: reasons.zig_field_reflection > 0,
      reflectionEdgesInFile,
      /** Why this site produced no reflection edge, or null when it did. */
      nonFiringReason,
      edgesOnLine: onLine.length,
      edgesNamingTheDeclaration: naming,
      edgeTypesOnLine: types,
      namingEdgeReasons: reasons,
      targetsOnLine: [...new Set(targets)].slice(0, 12),
    })
  }
}

const withAnyEdge = rows.filter((r) => r.edgesOnLine > 0)
const namingTheDeclaration = rows.filter((r) => r.edgesNamingTheDeclaration > 0)
const publishedSites = rows.filter((r) => r.namePublishedInFile === true)
const publishedNaming = publishedSites.filter((r) => r.edgesNamingTheDeclaration > 0)
const publishedWithEdge = publishedSites.filter((r) => r.edgesOnLine > 0)

const report = {
  instrument: "validation/m14/fixtures/zig/reflection-firing.mts",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  corpusRoot: CR,
  sitesConsidered: named.length,
  sitesMeasured: rows.length,
  filesWithSites: byFile.size,
  filesDrivenThroughParseFile: filesSeen.length,
  parseFailures,
  fallbackFiles,
  degradedFiles,
  sitesWithAnyEdgeOnTheirLine: withAnyEdge.length,
  sitesWithAnEdgeNamingTheDeclaration: namingTheDeclaration.length,
  sitesNamingAPublishedDeclaration: publishedSites.length,
  ofThoseWithAnyEdgeOnTheirLine: publishedWithEdge.length,
  ofThoseWithAnEdgeNamingIt: publishedNaming.length,
  edgeTypeTotalsOnSiteLines: rows.reduce<Record<string, number>>((acc, r) => {
    for (const [t, n] of Object.entries(r.edgeTypesOnLine)) acc[t] = (acc[t] ?? 0) + n
    return acc
  }, {}),
  /**
   * The audit that decides the verdict. Of the sites whose line carries an edge naming the
   * declaration, this is the tally by REASON CODE. A site only counts as already-read if some
   * naming edge's reason code is a reflection read; every other code means the edge is a
   * different construct that shares the line.
   */
  namingEdgeReasonCodes: rows.reduce<Record<string, number>>((acc, r) => {
    for (const [why, n] of Object.entries(r.namingEdgeReasons)) acc[why] = (acc[why] ?? 0) + n
    return acc
  }, {}),
  sitesWithANamingEdgeFromAReflectionReasonCode: rows.filter((r) =>
    Object.keys(r.namingEdgeReasons).some((w) => /reflect|hasdecl|has_decl|field_builtin|zig_reflect/i.test(w)),
  ).length,
  /**
   * THE FIRING NUMBER, and it is edge-level rather than line-level. The line-level tally above
   * (`sitesWithAnEdgeNamingTheDeclaration`) reads 7 of 22 named `@field` sites and is NOT the
   * pass's firing rate: it cannot see an edge published from a sibling site that names the same
   * declaration. `representedByAReflectionEdge` asks the question file-wide, and the sites that
   * produce nothing are then given a NAMED reason rather than counted as misses.
   */
  representedByAReflectionEdge: rows.filter((r) => r.representedByAReflectionEdge).length,
  /**
   * The same question narrowed to the edge's OWN line, so the file-wide figure above cannot be
   * read as "@hasDecl fired once": the one `@hasDecl` site it matches is a sibling `@field`
   * site naming the same declaration four lines away.
   */
  reflectionEdgeOnThisLine: rows.filter((r) => r.reflectionEdgeOnThisLine).length,
  nonFiringReasons: Object.fromEntries(
    [...rows.reduce((m, r) => {
      if (!r.nonFiringReason) return m
      const k = r.nonFiringReason.split(":")[0]
      m.set(k, (m.get(k) ?? 0) + 1)
      return m
    }, new Map<string, number>())].sort((a, b) => b[1] - a[1]),
  ),
  byBuiltin: Object.fromEntries(
    ["@field", "@hasDecl"].map((b) => {
      const rs = rows.filter((r) => r.builtin === b)
      return [
        b,
        {
          sites: rs.length,
          representedByAReflectionEdge: rs.filter((r) => r.representedByAReflectionEdge).length,
          nonFiringReasons: Object.fromEntries(
            [...rs.reduce((m, r) => {
              if (!r.nonFiringReason) return m
              const k = r.nonFiringReason.split(":")[0]
              m.set(k, (m.get(k) ?? 0) + 1)
              return m
            }, new Map<string, number>())].sort((a, b) => b[1] - a[1]),
          ),
        },
      ]
    }),
  ),
  /**
   * The resolvability split, which is what decides whether an edge here is emittable or
   * fabricated. `nameResolveArity` is how many published symbols in the file carry the name:
   * 1 resolves cleanly, >1 is ambiguous (deliverable B), 0 does not resolve (deliverable D).
   */
  resolvabilityByBuiltin: Object.fromEntries(
    ["@field", "@hasDecl"].map((b) => {
      const rs = rows.filter((r) => r.builtin === b)
      const f = rs.filter((r) => r.nameResolveArity === 0).length
      const one = rs.filter((r) => r.nameResolveArity === 1).length
      const amb = rs.filter((r) => r.nameResolveArity > 1).length
      const cOk = rs.filter((r) => r.containerResolvesInFile === true).length
      const cNull = rs.filter((r) => r.containerResolvesInFile === null).length
      return [
        b,
        {
          sites: rs.length,
          nameResolvesUniquely: one,
          nameAmbiguous: amb,
          nameResolvesToNothing: f,
          containerResolvesInFile: cOk,
          containerIsNotABareIdentifier: cNull,
          /** Emittable without claiming a target the graph cannot walk to. */
          emittableUnambiguousTarget: rs.filter((r) => r.nameResolveArity === 1).length,
        },
      ]
    }),
  ),
  rows,
}

console.log(
  JSON.stringify(
    {
      ...report,
      rows: rows.slice(0, 25),
    },
    null,
    2,
  ),
)
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")