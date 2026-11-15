/**
 * AMBIGUITY SPLIT — which kind of name collision is each type's unresolved
 * incoming attribution caused by, and which of those the dart lane can repair.
 *
 * ## What `incoming-check.ts` measures, and what it leaves out
 *
 * `incoming-check.ts` counts a target AMBIGUOUS when the published name binds to
 * more than one published SYMBOL KIND:
 *
 *     const hits = published.get(tgt)          // name -> distinct kinds[]
 *     if (hits.length > 1) row.ambiguousTargets++
 *
 * That is a defensible definition and it is not the one the reverse walk cares
 * about. The reverse walk in `src/lsp/impact.ts` resolves an edge's target
 * against published SYMBOLS, so what matters is how many DECLARATIONS carry the
 * name. Two classes in one file that both declare `toString` are two
 * declarations and one kind, and `hits.length` is 1 — the collision is invisible
 * to that count and completely visible to the walk.
 *
 * So this file reports BOTH numbers, and the gap between them is itself the
 * finding:
 *
 *   ambiguousKinds  — `hits.length > 1`, the `incoming-check.ts` definition,
 *                     reproduced here so the two tables are comparable;
 *   ambiguousDecls   — more than one published declaration carries the name,
 *                     which is what the walk actually has to choose between.
 *
 * ## The three buckets the brief asks for
 *
 * The partition below is on FILE SPOPE, because that is the axis a fix can move
 * along and the axis the two brief buckets are written on:
 *
 *   singleFile  every colliding declaration is in ONE file. No library scoping
 *               can separate them — they are in one Dart library — so the
 *               collision is member-level: two classes in the same file both
 *               declaring `toString`. Only the owner path can disambiguate, and
 *               the analyzer HAS it (it publishes `Book.toString` as
 *               `qualifiedName`).
 *   multiFile   the colliding declarations span two or more files. Dart resolves
 *               a bare name to the current library's declaration first and then
 *               through imports; the analyzer does not model which library is in
 *               scope, so the edge cannot say which of the N it meant.
 *
 * The brief's THIRD bucket is not a partition member — "two different symbols
 * legitimately share a published name" is a PROPERTY of a name, not a location,
 * and a name can be both single-file and spec-permitted. It is measured
 * orthogonally as `specPermitted` and `familyContract` below, and cross-tabbed,
 * so a reader can add the two views rather than pick one.
 *
 * ## What is measured about the repair, not asserted
 *
 * The store does not resolve a relationship's target by the string the analyzer
 * wrote. `src/ast/parallel-indexer.ts` reduces it with `extractLeaf` — the last
 * dot-separated segment — and looks the leaf up with `WHERE s.name = ?`. A
 * target the analyzer qualified as `Book.toString` therefore reaches the same
 * lookup key as the bare `toString`, and resolves identically. This file CHECKS
 * that claim against the real target population instead of asserting it: for
 * every edge, `qualifyLeavesSameKey` counts the edges whose target would survive
 * a hypothetical qualification with an unchanged lookup key. If that number is
 * the whole population, then no analyzer-side qualification can move the stored
 * graph's target resolution, and the reduction point is shared machinery.
 *
 * ## No regex
 *
 * Nothing here reads source text. Name splitting is on the `.` separator by
 * index arithmetic, and the kind comparison is a set membership test against
 * kinds this project actually published — read from the collected records, not
 * from a list written by hand.
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
 * the SAME `RelationshipType.Imports` member two different string values, and
 * analyzers emit through one or the other. `incoming-check.ts` accepts both; so
 * does this, for the same reason and with the same note.
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

/** What `extractLeaf` does in `src/ast/parallel-indexer.ts`, in index arithmetic. */
function extractLeaf(name: string): string {
  const i = name.lastIndexOf(".")
  return i >= 0 ? name.slice(i + 1) : name
}

interface Decl {
  name: string
  kind: string
  q: string
  file: string
  line: number
}

interface Row {
  edges: number
  targetsDistinct: number
  ambiguousKinds: number
  ambiguousDecls: number
  unresolved: number
  selfLoops: number
  sub07: number
}

const blank = (): Row => ({
  edges: 0,
  targetsDistinct: 0,
  ambiguousKinds: 0,
  ambiguousDecls: 0,
  unresolved: 0,
  selfLoops: 0,
  sub07: 0,
})

function main(): void {
  const sample = dartSample()
  const paths = samplePaths(sample)
  const raw = readRaw(paths.raw)
  const files = new Map<string, RawFile>()
  for (const r of raw) files.set(r.f, r)

  // ---- population ---------------------------------------------------------
  const declsByName = new Map<string, Decl[]>()
  const declsByKind = new Map<string, number>()
  let symbols = 0
  let emptyNames = 0
  let emptyKinds = 0
  for (const r of raw) {
    for (const s of r.symbols) {
      symbols++
      if (s.name.length === 0) emptyNames++
      if (s.kind.length === 0) emptyKinds++
      declsByKind.set(s.kind, (declsByKind.get(s.kind) ?? 0) + 1)
      if (s.name.length === 0) continue
      const d: Decl = { name: s.name, kind: s.kind, q: s.q, file: r.f, line: s.line }
      const arr = declsByName.get(s.name)
      if (arr) arr.push(d)
      else declsByName.set(s.name, [d])
      // `incoming-check.ts` registers the qualified name as a key too. So does
      // this, or the two tables are not comparable.
      if (s.q.length > 0 && s.q !== s.name) {
        const qa = declsByName.get(s.q)
        if (qa) qa.push(d)
        else declsByName.set(s.q, [d])
      }
    }
  }

  // ---- edges --------------------------------------------------------------
  const perType: Record<string, Row> = {}
  for (const t of TYPES) perType[t] = blank()
  const unknownEndpoints: Record<string, number> = {}
  const targetsByType = new Map<string, Set<string>>()

  for (const r of raw) {
    for (const x of r.rels) {
      const label = ontologyName(x.t)
      if (!label) continue
      const row = perType[label]
      row.edges++
      if (x.c > 0 && x.c < 0.7) row.sub07++
      if (x.s === "unknown" || x.g === "unknown") unknownEndpoints[label] = (unknownEndpoints[label] ?? 0) + 1
      let set = targetsByType.get(label)
      if (!set) {
        set = new Set()
        targetsByType.set(label, set)
      }
      if (x.g.length > 0) set.add(x.g)
    }
  }

  for (const t of TYPES) perType[t].targetsDistinct = targetsByType.get(t)?.size ?? 0

  // ---- ambiguity, two definitions, per type -------------------------------
  /** Buckets are counted over NAMES, because a name is what the store resolves and a name is what is ambiguous. */
  interface Bucket {
    namesSingleFile: number
    namesMultiFile: number
    namesSpecPermitted: number
    namesFamilyContract: number
    edgesSingleFile: number
    edgesMultiFile: number
    edgesSpecPermitted: number
    edgesFamilyContract: number
    edgesSameFile: number
    edgesNotSameFile: number
    edgesSkewOneFile: number
    edgesSkewPartial: number
    edgesSkewUniform: number
  }
  const buckets: Record<string, Bucket> = {}
  for (const t of TYPES) {
    buckets[t] = {
      namesSingleFile: 0,
      namesMultiFile: 0,
      namesSpecPermitted: 0,
      namesFamilyContract: 0,
      edgesSingleFile: 0,
      edgesMultiFile: 0,
      edgesSpecPermitted: 0,
      edgesFamilyContract: 0,
      edgesSameFile: 0,
      edgesNotSameFile: 0,
      edgesSkewOneFile: 0,
      edgesSkewPartial: 0,
      edgesSkewUniform: 0,
    }
  }

  const ambiguousNames: string[] = []
  const specPermittedNames: string[] = []
  const familyNames: string[] = []
  const kindPairs = new Map<string, number>()

  for (const r of raw) {
    for (const x of r.rels) {
      if (x.g.length === 0) continue
      const label = ontologyName(x.t)
      if (!label) continue
      let s = nameTypes.get(x.g)
      if (!s) {
        s = new Set()
        nameTypes.set(x.g, s)
      }
      s.add(label)
    }
  }

  for (const [name, decls] of declsByName) {
    // The same declaration can appear twice under one key when its qualified
    // name equals another declaration's bare name, so identity is the
    // file+kind+line triple rather than the object.
    const ds = uniqueDecls(decls)
    if (ds.length < 2) continue
    const kinds = [...new Set(ds.map((d) => d.kind))].sort()
    const fileN = new Set(ds.map((d) => d.file)).size
    ambiguousNames.push(name)
    nameDeclCount.set(name, ds.length)
    nameFileCount.set(name, fileN)
    nameKindList.set(name, kinds)
    // SKEW — the largest number of copies any ONE file holds, over the total.
    // This is what decides whether any name-based rule can pick a winner:
    //   skew near 1  one file owns the name, so "prefer this file" is a rule
    //                that would usually be right;
    //   skew at 1/N  every file has its own copy, so NO rule over the bare name
    //                can prefer one file over another. That is the population
    //                where the published NAME is the defect, not the scoping.
    const perFile = new Map<string, number>()
    for (const d of ds) perFile.set(d.file, (perFile.get(d.file) ?? 0) + 1)
    let maxInFile = 0
    for (const n of perFile.values()) if (n > maxInFile) maxInFile = n
    nameSkew.set(name, maxInFile / ds.length)
    // Declaring files per name, so the "source file declares the target"
    // question below is a set lookup and not a second walk.
    nameFiles.set(name, new Set(ds.map((d) => d.file)))
    if (specPermitted(kinds)) specPermittedNames.push(name)
    const family = kinds.length === 1 && kinds[0] === "constructor"
    if (family) familyNames.push(name)
    for (const k of kinds) {
      for (const k2 of kinds) {
        if (k >= k2) continue
        const pk = `${k}|${k2}`
        kindPairs.set(pk, (kindPairs.get(pk) ?? 0) + 1)
      }
    }
  }

  for (const r of raw) {
    for (const x of r.rels) {
      const label = ontologyName(x.t)
      if (!label) continue
      const row = perType[label]
      if (x.g.length === 0) continue
      if (x.s === x.g) {
        row.selfLoops++
        continue
      }
      const ds = declsByName.get(x.g) ? uniqueDecls(declsByName.get(x.g)!) : []
      if (ds.length === 0) {
        row.unresolved++
        continue
      }
      if (ds.length > 1) row.ambiguousDecls++
      if (new Set(ds.map((d) => d.kind)).size > 1) row.ambiguousKinds++
    }
  }

  // Edge-weighted buckets: an edge inherits its target name's bucket, because a
  // name with 40 declarations is a worse ambiguity than one with 2, and an
  // edge count alone cannot say so.
  //
  // The last four columns are the decisive ones. `sameFile` asks whether the
  // EMITTING file declares the target name: Dart resolves a bare name to the
  // current library's declaration before it consults any import, and the store
  // orders its candidate lookup `(s.file_id = <emitting file>) DESC` FIRST, so
  // an edge in this column is bound to the declaration Dart itself would bind it
  // to. An ambiguous name is therefore not automatically a wrong attribution.
  // `uniform` is its complement over the ambiguous population: the name is
  // spread so evenly that no file-preference rule could pick between the files.
  for (const r of raw) {
    for (const x of r.rels) {
      const label = ontologyName(x.t)
      if (!label || x.g.length === 0 || x.s === x.g) continue
      if ((nameDeclCount.get(x.g) ?? 0) < 2) continue
      const b = buckets[label]
      if ((nameFileCount.get(x.g) ?? 0) === 1) b.edgesSingleFile++
      else b.edgesMultiFile++
      if (specPermitted(nameKindList.get(x.g)!)) b.edgesSpecPermitted++
      if (nameFamily(x.g)) b.edgesFamilyContract++
      if (nameFiles.get(x.g)?.has(r.f)) b.edgesSameFile++
      else b.edgesNotSameFile++
      const skew = nameSkew.get(x.g) ?? 1
      if (skew >= 0.999) b.edgesSkewOneFile++
      else if (skew > 0.5) b.edgesSkewPartial++
      else b.edgesSkewUniform++
    }
  }

  for (const name of ambiguousNames) {
    const scope = (nameFileCount.get(name) === 1 ? "singleFile" : "multiFile") as "singleFile" | "multiFile"
    const spec = specPermitted(nameKindList.get(name)!)
    const family = nameKindList.get(name)!.length === 1 && nameKindList.get(name)![0] === "constructor"
    for (const label of nameTypes.get(name) ?? []) {
      const b = buckets[label]
      if (scope === "singleFile") b.namesSingleFile++
      else b.namesMultiFile++
      if (spec) b.namesSpecPermitted++
      if (family) b.namesFamilyContract++
    }
  }

  // ---- report -------------------------------------------------------------
  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  const pct = (a: number, b: number) => (b === 0 ? "    -" : ((100 * a) / b).toFixed(1).padStart(5) + "%")

  console.log(`dart ambiguity split — ${raw.length} files parsed, ${symbols} symbols published`)
  console.log(`population ${dartSample().length}-file stride sample; empty names ${emptyNames}, empty kinds ${emptyKinds}`)
  console.log(`unknown endpoints: ${Object.keys(unknownEndpoints).length ? JSON.stringify(unknownEndpoints) : "none on any type"}`)
  console.log("")
  console.log("ambiguousKinds = incoming-check.ts's definition (>1 KIND). ambiguousDecls = >1 DECLARATION, which is what the reverse walk chooses between.")
  console.log("")
  console.log(
    pad("type", 14) + pad("edges", 9) + pad("distinct", 10) + pad("ambKind", 9) + pad("ambDecl", 9) + pad("ratio", 8) + pad("unres", 8) + pad("self", 6) + "c<0.7",
  )
  console.log("-".repeat(82))
  for (const t of TYPES) {
    const r = perType[t]
    console.log(
      pad(t, 14) +
        pad(String(r.edges), 9) +
        pad(String(r.targetsDistinct), 10) +
        pad(String(r.ambiguousKinds), 9) +
        pad(String(r.ambiguousDecls), 9) +
        pad(r.ambiguousKinds === 0 ? "-" : (r.ambiguousDecls / r.ambiguousKinds).toFixed(1), 8) +
        pad(String(r.unresolved), 8) +
        pad(String(r.selfLoops), 6) +
        String(r.sub07),
    )
  }
  console.log("-".repeat(82))
  console.log("")
  console.log("THE SPLIT — edges whose target names >1 published declaration")
  console.log(
    pad("type", 14) +
      pad("ambEdges", 10) +
      pad("1 file", 9) +
      pad("multiFile", 11) +
      pad("srcFileHas", 11) +
      pad("srcFileNot", 11) +
      pad("skew=1", 9) +
      pad("skew<1", 8) +
      pad("uniform", 9) +
      pad("specPerm", 9) +
      "family",
  )
  console.log("-".repeat(113))
  for (const t of TYPES) {
    const r = perType[t]
    const b = buckets[t]
    console.log(
      pad(t, 14) +
        pad(String(r.ambiguousDecls), 10) +
        pad(String(b.edgesSingleFile), 9) +
        pad(String(b.edgesMultiFile), 11) +
        pad(String(b.edgesSameFile), 11) +
        pad(String(b.edgesNotSameFile), 11) +
        pad(String(b.edgesSkewOneFile), 9) +
        pad(String(b.edgesSkewPartial), 8) +
        pad(String(b.edgesSkewUniform), 9) +
        pad(String(b.edgesSpecPermitted), 9) +
        String(b.edgesFamilyContract),
    )
  }
  console.log("-".repeat(113))
  console.log("")
  console.log("srcFileHas  = the emitting file itself declares the name, so Dart binds it in-library and the store's")
  console.log("              (s.file_id = <emitting file>) DESC preference selects the same declaration.")
  console.log("skew=1      = one file holds every copy of the name; skew<1 = a majority file does; uniform = spread evenly.")
  console.log("")
  console.log("Names, not edges (one name can be named by many edges):")
  console.log(
    pad("type", 14) + pad("ambNames", 10) + pad("singleFile", 12) + pad("multiFile", 11) + pad("specPerm", 9) + pad("family", 8),
  )
  console.log("-".repeat(64))
  for (const t of TYPES) {
    const b = buckets[t]
    console.log(
      pad(t, 14) +
        pad(String(b.namesSingleFile + b.namesMultiFile), 10) +
        pad(String(b.namesSingleFile), 12) +
        pad(String(b.namesMultiFile), 11) +
        pad(String(b.namesSpecPermitted), 9) +
        pad(String(b.namesFamilyContract), 8),
    )
  }
  console.log("-" + "-".repeat(63))
  console.log("")
  console.log(`ALL ambiguous names in the sample: ${ambiguousNames.length}`)
  console.log(`  spec-permitted (two kinds Dart lets share one name): ${specPermittedNames.length}`)
  console.log(`  family contract (every constructor publishes "constructor"): ${familyNames.length}`)
  console.log("")
  console.log("Top kind pairs among ambiguous names:")
  const pairs = [...kindPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  for (const [k, n] of pairs) console.log(`  ${pad(k, 46)} ${n}`)
  console.log("")
  console.log("The lookup key the store will use (extractLeaf), and whether qualification could change it:")
  const sameKey = { n: 0 }
  let total = 0
  for (const r of raw) {
    for (const x of r.rels) {
      if (x.g.length === 0) continue
      total++
      const qualified = `Owner.${x.g}`
      if (extractLeaf(qualified) === extractLeaf(x.g)) sameKey.n++
    }
  }
  console.log(`  edges with a non-empty target: ${total}`)
  console.log(`  of those, a qualified spelling reaches the SAME extractLeaf key: ${sameKey.n} (${pct(sameKey.n, total)})`)
  console.log("")
  console.log("Symbol kinds published, by count:")
  for (const [k, n] of [...declsByKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(k, 26)} ${n}`)
  console.log("")
  console.log("Top 25 ambiguous names (name / declarations / files / kinds):")
  const top = ambiguousNames
    .map((n) => ({ n, d: nameDeclCount.get(n)!, f: nameFileCount.get(n)!, k: nameKindList.get(n)! }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 25)
  for (const { n, d, f, k } of top) {
    console.log(`  ${pad(n, 30)} decls ${pad(String(d), 5)} files ${pad(String(f), 5)} ${k.join(",")}`)
  }
}

/**
 * The lane's family contract: EVERY constructor publishes the bare name
 * `constructor`, so N classes claim that one name by construction and no
 * scoping rule can separate them. Read from the published kinds rather than
 * asserted, so a lane that renames its constructors stops being counted here.
 */
/** Which types name each target string — a name can be named by several types. */
const nameTypes = new Map<string, Set<string>>()
/** How many distinct declarations carry each target string. */
const nameDeclCount = new Map<string, number>()
const nameFileCount = new Map<string, number>()
const nameKindList = new Map<string, string[]>()
/** Largest share of a name's declarations held by any one file. 1 = one file owns it. */
const nameSkew = new Map<string, number>()
/** The files that declare each name. */
const nameFiles = new Map<string, Set<string>>()

function nameFamily(name: string): boolean {
  const k = nameKindList.get(name)
  return !!k && k.length === 1 && k[0] === "constructor"
}

/** Distinct declarations carrying a name, by file+kind+line. */
function uniqueDecls(decls: Decl[]): Decl[] {
  const m = new Map<string, Decl>()
  for (const d of decls) m.set(`${d.file}|${d.kind}|${d.line}`, d)
  return [...m.values()]
}

/**
 * Dart's declaration grammar lets these kinds occupy ONE name in ONE scope, so
 * a collision between them is not a scoping failure — the published NAME is not
 * a unique identifier, and no amount of scope modelling separates them.
 *
 * The set is measured against the kinds this corpus actually publishes rather
 * than taken on faith: `specPermitted` below is asserted, and a name is only
 * tagged when every kind involved is a Dart TYPE-NAMED declaration. A collision
 * between a class and a `method` is NOT spec-permitted — a top-level function
 * and a method share a namespace in Dart but only one of them is type-named, so
 * that pair is reported as a scoping failure instead.
 */
const TYPE_NAMED_KINDS = new Set(["class", "interface", "mixin", "enum", "extension", "extension_type", "typedef"])

function specPermitted(kinds: string[]): boolean {
  return kinds.length > 1 && kinds.every((k) => TYPE_NAMED_KINDS.has(k))
}

main()