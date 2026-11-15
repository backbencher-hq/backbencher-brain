/**
 * GraphQL — PROJECT-LEVEL RESOLUTION, so "resolvable" stops meaning "in this file".
 *
 * The corpus sweep reports in-file resolvability, and on the 47-file corpus that
 * is 91.08% with 1,693 unresolved targets — 1,331 of them bare `field_selection`
 * edges. An in-file number is the wrong instrument for the question "does every
 * APPLICABLE relationship resolve?", because a GraphQL schema is routinely split
 * across files: a `.graphql` document selecting `user.login` names a type declared
 * in `types.graphql`, so the single-file view can never resolve it while the
 * PROJECT view can. Judging the analyzer on the in-file number therefore
 * conflates "the analyzer is wrong" with "the analyzer is looking at one file".
 *
 * This probe builds the project symbol table the store would have, then sorts
 * every unresolved target into a decision table:
 *
 *   resolvesUniqueBare   exactly ONE project symbol carries that bare name, so the
 *                        store's bare-name fallback lands on an unambiguous target
 *   resolvableQualified  the metadata names an enclosing type and `Type.name` is a
 *                        real symbol, so the analyzer COULD have qualified it
 *   ambiguous            several project symbols share the bare name, so a bare edge
 *                        is genuinely undecidable and must stay bare or be qualified
 *   dangling             no project symbol has that name at all
 *
 * The two "we could do better" rows are the actionable ones. The other two are
 * the truth about a per-file analyzer and must not be "fixed" by guessing.
 */
import * as fs from "fs"
import * as path from "path"
import { GQL, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm"))))
const { RealGraphqlAnalyzer } = await import(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"))

const dir = process.argv[2] ?? `${GQL}/repos`
const files: string[] = []
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p) } else if (e.name.endsWith(".graphql") || e.name.endsWith(".gql")) files.push(p) } }
walk(dir)
files.sort()

/** The five scalars the SPECIFICATION defines. A schema references them without
 * declaring them, so `x: String` is a resolvable edge to `String` even though no
 * file in the project declares it. Leaving these out turns the spec's own
 * vocabulary into thousands of false "dangling" targets. */
const BUILTIN_SCALARS = new Set(["Int", "Float", "String", "Boolean", "ID"])

/** The three meta-fields the specification defines on every type and on the root
 * query type. Every schema answers them and no schema declares them, so — exactly
 * like the built-in scalars — a reference to one is a true reference that no
 * `brain_symbol` row will ever exist for. */
const INTROSPECTION_FIELDS = new Set(["__typename", "__schema", "__type"])

interface Rel { file: string; type: string; source: string; target: string; role: string; md: any }
const rels: Rel[] = []
const perFileIds = new Map<string, Set<string>>()
const bare = new Map<string, string[]>()   // bare name -> symbol ids that carry it
const exact = new Set<string>()           // fully-qualified ids
/**
 * Every spelling a relationship SOURCE may legitimately use, built from SYMBOLS
 * ONLY. Added by the final master review after it shipped an edge whose source
 * (`role`) was not a symbol: the corpus sweep measured unresolved TARGETS, so
 * "does this edge have a source that exists?" had no check anywhere, and a
 * relationship with a dangling source is a fact about nothing. Building the table
 * from symbols and nothing else is what makes the check bite — a name that occurs
 * only as a relationship source is reported, not excused.
 */
const sourceSpelling = new Set<string>()
/** per-file set of BARE symbol names, so a bare source can be judged for uniqueness */
const bareSourceSpellings = new Map<string, Set<string>>()
const qualified = new Map<string, string[]>() // "Type.name" -> ids

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const tree = parser.parse(src)
  const r = new RealGraphqlAnalyzer().analyze(tree.rootNode, src, f)
  const ids = new Set<string>()
  for (const s of r.symbols) {
    if (typeof s.name !== "string" || !s.name) continue
    ids.add(s.name)
    exact.add(s.name)
    // A symbol is reachable under its OWN name and, when it has an owner, under
    // `owner.name` too — that is how the store's own sweep builds the declared
    // set, and how the analyzer's own qualified field_selection targets are
    // spelled. Both spellings must be in the table or every qualified edge looks
    // dangling.
    const spellings = [s.name, ...(s.ownerName ? [`${s.ownerName}.${s.name}`] : [])]
    for (const spelling of spellings) {
      if (!bare.has(spelling)) bare.set(spelling, [])
      bare.get(spelling)!.push(spelling)
      if (spelling.includes(".")) { if (!qualified.has(spelling)) qualified.set(spelling, []); qualified.get(spelling)!.push(spelling) }
    }
  }
  for (const b of BUILTIN_SCALARS) if (!bare.has(b)) bare.set(b, [b])
  for (const sy of r.symbols) {
    if (typeof sy.name !== "string" || !sy.name) continue
    sourceSpelling.add(sy.name)
    if (sy.ownerName) sourceSpelling.add(`${sy.ownerName}.${sy.name}`)
  }
  // A bare source spelling is only GOOD if it is unique project-wide, exactly as
  // the store's strategy 2 requires for a target. The first version of this check
  // accepted any bare name that appeared on some symbol, and its negative control
  // then FAILED TO FAIL: `role` is the bare name of `UserInput.role` but also of
  // `Account.role`, `Profile.role` and more, so a bare `role` source is ambiguous
  // and the store would not resolve it. A gate that cannot fail is not a gate.
  bareSourceSpellings.set(f, new Set(r.symbols.filter((x: any) => typeof x?.name === "string" && x.name).map((x: any) => x.name)))
  perFileIds.set(f, ids)
  for (const rel of r.relationships) {
    rels.push({ file: f, type: rel.type as string, source: rel.source as string, target: rel.target as string, role: (rel.metadata as any)?.relationshipRole ?? "", md: rel.metadata as any })
  }
}

/**
 * Can the store land a relationship whose SOURCE is this name? The SAME two
 * strategies it uses for a target: the qualified name exactly, or a bare name
 * that is unique project-wide. A source is resolved by the store's symbol lookup,
 * so judging it by a laxer rule than the target would let an unresolvable edge
 * through under a name that happens to exist.
 */
function this_sourceResolves(source: string, file: string): boolean {
  if (BUILTIN_SCALARS.has(source)) return true
  if (exact.has(source)) return true
  if (qualified.has(source)) return true
  const cands = bare.get(source) ?? []
  return cands.length === 1
}

let inFile = 0
let builtin = 0
let specMeta = 0
let resolvesQualifiedDotted = 0
// SOURCE resolvability, added by the final master review after it shipped an edge
// whose source (`role`) was not a symbol. The corpus sweep only ever measured
// unresolved TARGETS, so "did this edge have a source that exists?" had no check at
// all — and a relationship with a dangling source is a fact about nothing.
const unknownSources: Rel[] = []
// The `metadata.fileLevel` exemption, added because this gate failed at 1,472 and
// every one of the 1,472 was an `exports` edge whose source is the literal `"(file)"`.
//
// That is NOT the CSS defect the lane already fixed, and treating it as one would have
// been the wrong fix. CSS's `@import` was a genuine dangling-by-construction source and
// moved off the literal BECAUSE it carried no flag (real-css-analyzer.ts:2029-2038, citing
// ledger M60 R7 "no placeholder literals in name-bearing fields"). The graphql `exports`
// source carries `metadata.fileLevel = true`, which is the M60/#910 store contract for a
// module-level edge whose source is the importing FILE rather than a symbol: the store
// rewrites `source_external` to the project-relative path on exactly that flag, and `zig`
// spells the same source `"(file)"`. So these edges are joinable at the store and only
// unjoinable against this probe's own symbol set, which is the probe being narrower than
// the contract it is checking.
//
// It is COUNTED and not folded away, because the two cases must stay distinguishable: if
// an edge lost its flag, or an unflagged edge started using the literal, the count moves
// and the gate says so. A silent exemption would let a real regression through and still
// print zero.
const fileLevelSources: Rel[] = []
const rows = { resolvesUniqueBare: [] as Rel[], resolvableQualified: [] as Rel[], ambiguous: [] as Rel[], dangling: [] as Rel[] }
for (const rel of rels) {
  // 0. does the SOURCE name a symbol at all? Checked first, and separately from
  //    the target, because a target that resolves says nothing about the source.
  if (!this_sourceResolves(rel.source, rel.file)) {
    if (rel.md?.fileLevel === true) fileLevelSources.push(rel)
    else unknownSources.push(rel)
  }
  const own = perFileIds.get(rel.file)!
  if (own.has(rel.target)) { inFile++; continue }
  if (rel.target.includes(".")) {
    // A DOTTED target is the analyzer's deliberate `Type.field` qualification, and
    // it is the store's strategy 1 — an exact qualified-name match. It resolves
    // only if that qualified name is a real symbol, so it is decided here rather
    // than skipped: skipping it (the first version of this probe) counted every
    // qualified edge as neither resolvable nor unresolved and flattered the
    // headline by ~40 points.
    if (exact.has(rel.target)) resolvesQualifiedDotted++
    else if (bare.has(rel.target) && (bare.get(rel.target)!.length ?? 0) > 0) resolvesQualifiedDotted++
    else rows.dangling.push(rel)
    continue
  }
  if (BUILTIN_SCALARS.has(rel.target)) { builtin++; continue }
  if (INTROSPECTION_FIELDS.has(rel.target)) { specMeta++; continue }
  const cands = bare.get(rel.target) ?? []
  if (cands.length === 1) rows.resolvesUniqueBare.push(rel)
  else if (cands.length > 1) {
    const enc = rel.md?.enclosingType
    if (enc && qualified.has(`${enc}.${rel.target}`)) rows.resolvableQualified.push(rel)
    else rows.ambiguous.push(rel)
  } else {
    const enc = rel.md?.enclosingType
    if (enc && qualified.has(`${enc}.${rel.target}`)) rows.resolvableQualified.push(rel)
    else rows.dangling.push(rel)
  }
}

const total = rels.length
const n = (a: Rel[]) => a.length
const pct = (a: number) => `${((a / total) * 100).toFixed(2)}%`
console.log(`files=${files.length} symbols=${exact.size} relationships=${total}`)
const bySourceRole: Record<string, number> = {}
for (const r of unknownSources) bySourceRole[r.role] = (bySourceRole[r.role] ?? 0) + 1
const fileLevelByRole: Record<string, number> = {}
for (const r of fileLevelSources) fileLevelByRole[r.role] = (fileLevelByRole[r.role] ?? 0) + 1
console.log(`unresolved SOURCES             ${String(unknownSources.length).padStart(6)}  ${((unknownSources.length / total) * 100).toFixed(2)}%   (a relationship whose source is not a symbol is a fact about nothing)`)
console.log(`  of which fileLevel-contracted ${String(fileLevelSources.length).padStart(5)}  ${pct(fileLevelSources.length)}   (metadata.fileLevel = true — M60/#910: the source IS the file and the STORE resolves it to the project-relative path on that flag; counted, not hidden)`)
console.log(`in-file resolvable            ${String(inFile).padStart(6)}  ${pct(inFile)}`)
console.log(`resolvable to a BUILT-IN scalar ${String(builtin).padStart(6)}  ${pct(builtin)}   (spec types: Int Float String Boolean ID)`)
console.log(`resolvable as a SPEC meta-field ${String(specMeta).padStart(6)}  ${pct(specMeta)}   (__typename __schema __type — every schema has them, no file declares them)`)
console.log(`resolvable as a QUALIFIED name ${String(resolvesQualifiedDotted).padStart(6)}  ${pct(resolvesQualifiedDotted)}   (Type.field — the store's strategy 1, an exact qualified match)`)
// "Resolvable" = what the STORE's own two strategies can land, mirrored exactly:
// an in-file or project symbol, a spec name no file can declare, or a bare name
// that is unique. Everything else is counted honestly BELOW rather than folded in.
const projectResolvable = inFile + builtin + specMeta + resolvesQualifiedDotted + rows.resolvesUniqueBare.length + rows.resolvableQualified.length
console.log(`PROJECT resolvable            ${String(projectResolvable).padStart(6)}  ${pct(projectResolvable)}   (the STORE's own two strategies: qualified exact, then bare-if-unique)`)
console.log("")
console.log("=== the previously-unresolved targets, decided at project scope ===")
console.log(`  resolvesUniqueBare           ${String(n(rows.resolvesUniqueBare)).padStart(6)}  the store's bare-name fallback is unambiguous`)
console.log(`  resolvableQualified         ${String(n(rows.resolvableQualified)).padStart(6)}  metadata names a type and Type.name EXISTS -> the analyzer could have qualified it`)
console.log(`  ambiguous                   ${String(n(rows.ambiguous)).padStart(6)}  several symbols share the name -> a bare edge is undecidable`)
console.log(`  dangling                    ${String(n(rows.dangling)).padStart(6)}  no project symbol has that name`)

const hist = (arr: Rel[]) => { const h: Record<string, number> = {}; for (const r of arr) h[r.role] = (h[r.role] ?? 0) + 1; return Object.fromEntries(Object.entries(h).sort((a, b) => b[1] - a[1])) }
console.log(`\n  resolvableQualified by role: ${JSON.stringify(hist(rows.resolvableQualified))}`)
console.log(`  ambiguous          by role: ${JSON.stringify(hist(rows.ambiguous))}`)
console.log(`  dangling           by role: ${JSON.stringify(hist(rows.dangling))}`)

console.log(`\n=== sample: resolvableQualified (the actionable class) ===`)
for (const r of rows.resolvableQualified.slice(0, 12)) console.log(`  ${path.basename(r.file)}:${r.md?.line ?? "?"} ${r.source} -> ${r.target} enclosingType=${r.md?.enclosingType} role=${r.role}`)
const danglingSpec = rows.dangling.filter((r) => INTROSPECTION_FIELDS.has(r.target))
const danglingReal = rows.dangling.filter((r) => !INTROSPECTION_FIELDS.has(r.target))
console.log(`\n=== the dangling, split by WHY ===`)
console.log(`  (spec meta-fields were already counted as resolvable above, so none remain here: ${danglingSpec.length})`)
console.log(`  genuinely undeclared       ${String(danglingReal.length).padStart(6)}`)
const byFile: Record<string, number> = {}
for (const r of danglingReal) { const k = path.basename(r.file); byFile[k] = (byFile[k] ?? 0) + 1 }
console.log(`  the undeclared ones by file: ${JSON.stringify(Object.fromEntries(Object.entries(byFile).sort((a, b) => b[1] - a[1])))}`)

const danglingDotted = rows.dangling.filter((r) => r.target.includes("."))
const danglingBare = rows.dangling.filter((r) => !r.target.includes("."))
console.log(`  of which the target is QUALIFIED (Type.field): ${danglingDotted.length}`)
console.log(`  of which the target is BARE:                   ${danglingBare.length}`)
const dRole: Record<string, number> = {}
for (const r of danglingDotted) dRole[r.role] = (dRole[r.role] ?? 0) + 1
console.log(`  the qualified ones by role: ${JSON.stringify(dRole)}`)
console.log(`\n=== sample: dangling (all) ===`)
for (const r of rows.dangling.slice(0, 12)) console.log(`  ${path.basename(r.file)} ${r.source} -> ${r.target} role=${r.role}`)
console.log(`\n=== sample: ambiguous ===`)
for (const r of rows.ambiguous.slice(0, 12)) console.log(`  ${path.basename(r.file)} ${r.source} -> ${r.target} candidates=${(bare.get(r.target) ?? []).length} role=${r.role}`)

// Persist the decision table, so a doc can cite it and doc-truth can re-derive it.
const outDir = path.join(GQL, "out")
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, "project-resolution.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  files: files.length,
  projectSymbols: exact.size,
  relationships: total,
  inFileResolvable: inFile,
  qualifiedNameResolvable: resolvesQualifiedDotted,
  builtinScalarResolvable: builtin,
  specMetaFieldResolvable: specMeta,
  resolvesUniqueBare: rows.resolvesUniqueBare.length,
  resolvableQualified: rows.resolvableQualified.length,
  ambiguous: rows.ambiguous.length,
  dangling: rows.dangling.length,
  projectResolvable: projectResolvable,
  projectResolvablePct: +((projectResolvable / total) * 100).toFixed(2),
  specVocabulary: {
    builtinScalars: [...BUILTIN_SCALARS],
    introspectionFields: [...INTROSPECTION_FIELDS],
    note: "names the SPECIFICATION defines and no file can declare, so no brain_symbol row will ever exist for them; the store's two strategies therefore cannot land these, and that is a property of the store, not of the edge",
  },
  storeStrategyMirrored: "parallel-indexer.ts resolveRelationships: strategy 1 qualified-name exact (_res_qname), strategy 2 bare name only when cnt = 1 (_res_name) — this probe's resolvable/resolvesUniqueBare/ambiguous split is that same rule",
  note: "ambiguous is NOT a defect: the store refuses a bare name unless it is unique, so an edge like `id` (305 candidate owners) is undecidable by design and the analyzer is right to leave it bare",
  unresolvedSources: unknownSources.length,
  unresolvedSourcesByRole: bySourceRole,
  unresolvedSourceSamples: unknownSources.slice(0, 10).map((r) => ({ file: path.basename(r.file), source: r.source, target: r.target, role: r.role })),
  fileLevelSources: fileLevelSources.length,
  fileLevelSourcesByRole: fileLevelByRole,
  fileLevelSourcesNote: "sources carrying metadata.fileLevel = true, which is the M60/#910 store contract for a module-level edge whose source is the importing FILE rather than a symbol — the store rewrites source_external to the project-relative path on that flag. Counted separately from unresolvedSources and NOT exempt from it silently: an edge that loses the flag, or an unflagged edge that starts using the same literal, moves this number and fails the gate.",
  danglingByFile: danglingReal.reduce((a: Record<string, number>, r) => { const k = path.basename(r.file); a[k] = (a[k] ?? 0) + 1; return a }, {}),
}, null, 2))
console.log(`  (written to out/project-resolution.json)`)

const bad = rows.resolvableQualified.length
if (unknownSources.length) {
  console.error(`\nGATE FAILED: ${unknownSources.length} relationship(s) name a SOURCE that is not a symbol.`)
  console.error(`by role: ${JSON.stringify(bySourceRole)}`)
  for (const r of unknownSources.slice(0, 10)) console.error(`  ${path.basename(r.file)} ${r.source} -> ${r.target} (${r.role})`)
}
if (bad) {
  console.error(`\nGATE FAILED: ${bad} relationship(s) name an enclosing type that EXISTS project-wide but were still emitted bare.`)
  console.error(`The analyzer can prove those, so it must qualify them: it does this everywhere else.`)
}
process.exitCode = bad === 0 && unknownSources.length === 0 ? 0 : 1
