/**
 * GraphQL DIFFERENTIAL SCORING — the single comparison the mutation harness
 * reuses, so a mutant is only "caught" if the SAME comparison that passes on
 * the real analyzer fails on the mutant.
 *
 * Truth identity:
 *   symbols        (kind, name, startLine)
 *   relationships  (type, source, target, line_number)
 *   parameters     (symbolKind, symbolName, argName, isOptional, defaultValue)
 *   docstrings     (kind, name, docstring)
 *   metadata       the exact `graphqlDirectives` / rawType facts pinned per case
 *   ranges         (kind, name, startLine:startColumn)
 *   relationshipMetadata
 *                  "type|source|target|line" -> the metadata keys that edge must carry
 *                  (`relationshipType` for the R9 declared-type marker,
 *                  `evidenceClass` for honesty-contract 4.3). A correctly-LABELLED edge
 *                  with its marker stripped is invisible to every other channel, so
 *                  without this row a mutant that strips it survives.
 *
 * The `line_number` in the relationship key is deliberate: the store's
 * relationship identity is (source, target, type, line), so a differential that
 * ignored the line could not tell the two genuine facts of `f(x: Int): Int` from
 * one collapsed row.
 */
import * as fs from "fs"
import * as path from "path"
import { HERE, ROOT } from "../paths.mts"

const TRUTH_PATH = path.join(HERE, "fixtures/ground-truth.json")

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const wasmPath = process.env.GQL_WASM ?? path.join(ROOT, "wasm/tree-sitter-graphql.wasm")
const language: any = await Language.load(fs.readFileSync(wasmPath))
const parser = new ParserClass()
parser.setLanguage(language)

export const TRUTH = JSON.parse(fs.readFileSync(TRUTH_PATH, "utf8"))

export interface Verdict {
  symTp: number; symFp: number; symFn: number
  relTp: number; relFp: number; relFn: number
  paramTp: number; paramFp: number; paramFn: number
  docTp: number; docFp: number; docFn: number
  violations: string[]
  rangeFailures: string[]
  unexpectedParseErrors: string[]
  expectedParseErrors: string[]
  failed: boolean
  failures: string[]
  perFile: Record<string, any>
}

const symKey = (s: any) => `${s.kind}|${s.name}|${s.range.startLine}`
const relKey = (r: any) => `${r.type}|${r.source}|${r.target}|${r.line_number ?? "?"}`

export function evaluate(Analyzer: any): Verdict {
  const v: Verdict = {
    symTp: 0, symFp: 0, symFn: 0,
    relTp: 0, relFp: 0, relFn: 0,
    paramTp: 0, paramFp: 0, paramFn: 0,
    docTp: 0, docFp: 0, docFn: 0,
    violations: [], rangeFailures: [], unexpectedParseErrors: [], expectedParseErrors: [],
    failed: false, failures: [], perFile: {},
  }

  for (const [name, spec] of Object.entries<any>(TRUTH.files)) {
    const src = fs.readFileSync(path.join(HERE, "fixtures", name), "utf8")
    const tree = parser.parse(src)
    if (spec.noParseError && tree.rootNode.hasError) v.unexpectedParseErrors.push(name)
    if (spec.parseError && !tree.rootNode.hasError) v.expectedParseErrors.push(name)

    let res: any
    try {
      res = new Analyzer().analyze(tree.rootNode, src, name)
    } catch (e: any) {
      v.failures.push(`${name}: analyzer THREW ${e?.message ?? e}`)
      continue
    }

    const pf: any = { symTp: 0, symFp: 0, symFn: 0, relTp: 0, relFp: 0, relFn: 0, paramTp: 0, paramFp: 0, paramFn: 0, docTp: 0, docFp: 0, docFn: 0, failures: [] as string[] }

    // ---- symbols: exact set ----
    const expSym = new Set<string>((spec.symbols ?? []).map((x: string[]) => symKey({ kind: x[0], name: x[1], range: { startLine: x[2] } })))
    const gotSym = new Set<string>(res.symbols.map(symKey))
    for (const k of expSym) { if (gotSym.has(k)) { v.symTp++; pf.symTp++ } else { v.symFn++; pf.symFn++; v.failures.push(`${name} SYM false-negative ${k}`); pf.failures.push(`SYM fn ${k}`) } }
    for (const k of gotSym) if (!expSym.has(k)) { v.symFp++; pf.symFp++; v.failures.push(`${name} SYM false-positive ${k}`); pf.failures.push(`SYM fp ${k}`) }
    for (const bad of spec.mustNotEmit?.symbols ?? []) {
      if ([...gotSym].some((k) => k.split("|")[1] === bad)) { v.violations.push(`${name} emitted mustNotEmit symbol "${bad}"`); v.failures.push(`${name} SYM phantom "${bad}"`); pf.failures.push(`SYM phantom ${bad}`) }
    }

    // ---- relationships: (type, source, target, line) ----
    const expRel = new Set<string>((spec.relationships ?? []).map((x: string[]) => `${x[0]}|${x[1]}|${x[2]}|${x[3] ?? "?"}`))
    const gotRel = new Set<string>(res.relationships.map(relKey))
    for (const k of expRel) { if (gotRel.has(k)) { v.relTp++; pf.relTp++ } else { v.relFn++; pf.relFn++; v.failures.push(`${name} REL false-negative ${k}`); pf.failures.push(`REL fn ${k}`) } }
    for (const k of gotRel) if (!expRel.has(k)) { v.relFp++; pf.relFp++; v.failures.push(`${name} REL false-positive ${k}`); pf.failures.push(`REL fp ${k}`) }
    for (const m of spec.mustNotEmit?.relationships ?? []) {
      const k = `${m[0]}|${m[1]}|${m[2]}|${m[3] ?? "?"}`
      if (gotRel.has(k)) { v.violations.push(`${name} emitted mustNotEmit relationship ${k}`); v.failures.push(`${name} REL phantom ${k}`); pf.failures.push(`REL phantom ${k}`) }
    }

    // ---- NO relationship may name nothing. A `uses` edge whose target or source
    //      is the EMPTY STRING is a row the store would write with an empty
    //      `target_external`, and it is reachable: the grammar's recovery for
    //      `broken:` emits a `Type` node whose `Name` is MISSING, so an
    //      `if (typeNode)` guard passes while the resolved name is undefined.
    //      Asserted on EVERY fixture, not only the damaged one, because it is a
    //      property of the emitter rather than of any input.
    for (const r of res.relationships) {
      if (!r.source || !r.target) {
        v.failures.push(`${name} REL ${r.type}|${JSON.stringify(r.source)}->${JSON.stringify(r.target)} names nothing`)
        pf.failures.push(`REL empty endpoint ${r.type}|${r.source}->${r.target}`)
      }
    }

    // ---- the M59 line contract, on every relationship, every file ----
    for (const r of res.relationships) {
      if (typeof r.line_number !== "number" || r.line_number <= 0) {
        v.failures.push(`${name} REL ${r.type}|${r.source}->${r.target} has line_number=${r.line_number} (M59 #825: a real line on every relationship)`)
        pf.failures.push(`REL line ${r.type}|${r.source}->${r.target}=${r.line_number}`)
      }
    }

    // ---- parameters: GraphQL's optionality rule, and the default value ----
    for (const spec2 of spec.parameters ?? []) {
      const hit = res.symbols.find((x: any) => x.kind === spec2.kind && x.name === spec2.name)
      if (!hit) { v.paramFn++; v.failures.push(`${name} PARAM ${spec2.kind}|${spec2.name}: symbol absent`); pf.failures.push(`PARAM missing symbol ${spec2.kind}|${spec2.name}`); continue }
      const got = new Map<string, any>((hit.parameters ?? []).map((p: any) => [`${p.name}|${p.isOptional}|${p.defaultValue ?? ""}`, p]))
      for (const want of spec2.args) {
        const k = `${want[0]}|${want[1]}|${want[2] ?? ""}`
        if (got.has(k)) { v.paramTp++; pf.paramTp++ }
        else { v.paramFn++; v.failures.push(`${name} PARAM ${spec2.kind}|${2 ? spec2.name : spec2.name}(${want[0]}) isOptional=${want[1]} default=${want[2] ?? ""} — not produced`); pf.failures.push(`PARAM fn ${k}`) }
      }
      for (const k of got.keys()) {
        const argName = k.split("|")[0]
        if (!spec2.args.some((a: string[]) => a[0] === argName)) { v.paramFp++; v.failures.push(`${name} PARAM ${spec2.name}(${argName}) not in truth: ${k}`); pf.failures.push(`PARAM fp ${k}`) }
      }
    }

    // ---- docstrings: the VALUE, with escapes resolved and block dedented ----
    for (const want of spec.docstrings ?? []) {
      const hit = res.symbols.find((x: any) => x.kind === want[0] && x.name === want[1])
      if (hit && hit.docstring === want[2]) { v.docTp++; pf.docTp++ }
      else if (!hit) { v.docFn++; v.failures.push(`${name} DOC ${want[0]}|${want[1]}: symbol absent`); pf.failures.push(`DOC fn ${want[0]}|${want[1]}`) }
      else { v.docFn++; v.failures.push(`${name} DOC ${want[0]}|${want[1]} = ${JSON.stringify(hit.docstring)} want ${JSON.stringify(want[2])}`); pf.failures.push(`DOC fn ${want[0]}|${want[1]}`) }
    }

    // ---- ranges: a symbol's range must START on its own keyword and CONTAIN its name ----
    for (const ra of spec.ranges ?? []) {
      const hit = res.symbols.find((x: any) => x.kind === ra[0] && x.name === ra[1])
      if (!hit) { v.rangeFailures.push(`${name} RANGE ${ra[0]} ${ra[1]}: symbol absent`); v.failures.push(`${name} RANGE missing ${ra[0]}|${ra[1]}`); continue }
      const got = `${hit.range.startLine}:${hit.range.startColumn}`
      if (got !== ra[2]) { v.rangeFailures.push(`${name} RANGE ${ra[0]} ${ra[1]}: got ${got} want ${ra[2]}`); v.failures.push(`${name} RANGE ${ra[0]}|${ra[1]} got ${got} want ${ra[2]}`) }
      const seg = src.slice(hit.range.startIndex ?? 0, hit.range.endIndex ?? 0)
      if (!seg.includes(hit.name)) { v.rangeFailures.push(`${name} RANGE ${ra[0]} ${ra[1]}: the range [${seg.slice(0, 40)}] does not contain the name "${hit.name}"`); v.failures.push(`${name} RANGE ${ra[0]}|${ra[1]} does not contain its own name`) }
    }

    // ---- relationship METADATA: the marker that makes the edge findable, and the
    // evidence class that makes "how much of this graph is guesswork" a query.
    //
    // Added 2026-10-03 because two mutants SURVIVED without it: retyping a declared-type
    // edge from `references` back to `uses` is caught by the mustNotEmit pins, but
    // dropping `metadata.relationshipType` off a correctly-labelled `references` edge
    // is invisible to every other channel — the edge is still there, still right, and
    // script/m60/declared-type-refs-census.ts (R9) filters on exactly that key, so the
    // lane would read as PRESENT while a consumer sees nothing. The same is true of
    // `evidenceClass`: 38 sibling analyzers publish it and honesty contract 4.3 asks
    // for the heuristic ratio to be a queryable number.
    for (const [key, want] of Object.entries<any>(spec.relationshipMetadata ?? {})) {
      const hit = res.relationships.find((r: any) => relKey(r) === key)
      if (!hit) { v.failures.push(`${name} RELMETA ${key}: edge absent`); pf.failures.push(`RELMETA absent ${key}`); continue }
      for (const [k, val] of Object.entries<any>(want)) {
        const got = hit.metadata?.[k]
        // Structural, not `!==`. `got !== val` can only ever be true for an ARRAY or
        // an OBJECT, because two arrays holding equal contents are never the same
        // reference — so before this, an array-valued metadata key was UNASSERTABLE:
        // writing the row made the suite fail (`got ["First","Second"] want
        // ["First","Second"]`) and omitting it left the fact unchecked. `importBindings`
        // is exactly that key, and it is the one that distinguishes the
        // comma-separated form `# import First, Second from "..."` — which the deep
        // review found the first measuring probe could not produce at all, because it
        // stopped at the first name. The key that distinguishes the defect was the one
        // key the harness could not compare. Scalar comparison is unchanged.
        const same = Array.isArray(val) || (val !== null && typeof val === "object")
          ? JSON.stringify(got) === JSON.stringify(val)
          : got === val
        if (!same) { v.failures.push(`${name} RELMETA ${key}.${k}: got ${JSON.stringify(got)} want ${JSON.stringify(val)}`); pf.failures.push(`RELMETA ${key}.${k}`) }
      }
    }

    // ---- pinned metadata: directives, rawType, repeatability, locations ----
    for (const md of spec.metadata ?? []) {
      const hit = res.symbols.find((x: any) => x.kind === md.kind && x.name === md.name)
      if (!hit) { v.failures.push(`${name} META ${md.kind}|${md.name}: symbol absent`); continue }
      if (md.graphqlDirectives) {
        const got = JSON.stringify(hit.metadata?.graphqlDirectives ?? [])
        const want = JSON.stringify(md.graphqlDirectives)
        if (got !== want) { v.failures.push(`${name} META ${md.kind}|${md.name}.graphqlDirectives\n         got  ${got}\n         want ${want}`); pf.failures.push(`META directives ${md.name}`) }
      }
      if (md.rawType !== undefined && hit.metadata?.rawType !== md.rawType) { v.failures.push(`${name} META ${md.kind}|${md.name}.rawType got ${JSON.stringify(hit.metadata?.rawType)} want ${JSON.stringify(md.rawType)}`); pf.failures.push(`META rawType ${md.name}`) }
      if (md.repeatable !== undefined && !!hit.metadata?.repeatable !== md.repeatable) { v.failures.push(`${name} META ${md.kind}|${md.name}.repeatable got ${!!hit.metadata?.repeatable} want ${md.repeatable}`); pf.failures.push(`META repeatable ${md.name}`) }
      if (md.locations && JSON.stringify(hit.metadata?.locations ?? []) !== JSON.stringify(md.locations)) { v.failures.push(`${name} META ${md.kind}|${md.name}.locations got ${JSON.stringify(hit.metadata?.locations)} want ${JSON.stringify(md.locations)}`); pf.failures.push(`META locations ${md.name}`) }
      if (md.nullable !== undefined && !!hit.metadata?.nullable !== md.nullable) { v.failures.push(`${name} META ${md.kind}|${md.name}.nullable got ${!!hit.metadata?.nullable} want ${md.nullable}`); pf.failures.push(`META nullable ${md.name}`) }
      if (md.inExtension !== undefined && !!hit.metadata?.inExtension !== md.inExtension) { v.failures.push(`${name} META ${md.kind}|${md.name}.inExtension got ${!!hit.metadata?.inExtension} want ${md.inExtension}`); pf.failures.push(`META inExtension ${md.name}`) }
      if (md.partial !== undefined && !!hit.metadata?.partial !== md.partial) { v.failures.push(`${name} META ${md.kind}|${md.name}.partial got ${!!hit.metadata?.partial} want ${md.partial}`); pf.failures.push(`META partial ${md.name}`) }
    }

    // ---- relationship MULTIPLICITY: two facts that share (type, source,
    // target, line) and differ only in ROLE are two rows the analyzer must
    // emit. The store collapses them (its identity has no role), which is
    // recorded in the review; the analyzer's own output must not pre-empt it.
    for (const [key, count] of Object.entries<any>(spec.relationshipMultiplicity ?? {})) {
      const got = res.relationships.filter((r: any) => relKey(r) === key).length
      if (got !== count) { v.failures.push(`${name} REL MULTIPLICITY ${key}: got ${got} want ${count}`); pf.failures.push(`REL multiplicity ${key}`) }
    }

    // ---- the published identity of an operation the document leaves UNNAMED ----
    // The prefix is the file's own identity plus the operation's ordinal, not a
    // synthetic `anonymous_*` name: `isIndexArtifactName`
    // (src/ast/analysis-exclusions.ts:171) discards anything matching
    // /^(anonymous|anon|unnamed)[_-]/i at store time, so the old name reached the
    // index as 0 rows out of 66 emitted over 750 corpus files.
    for (const [kind, line, prefix] of spec.expectNamePrefix ?? []) {
      const hit = res.symbols.find((x: any) => x.kind === kind && x.range.startLine === line)
      if (!hit) { v.failures.push(`${name} NAMEPREFIX ${kind}@${line}: symbol absent`); continue }
      if (!hit.name.startsWith(prefix)) { v.failures.push(`${name} NAMEPREFIX ${kind}@${line}: "${hit.name}" does not start with "${prefix}" (the identity of an unnamed operation is the file that holds it, plus its ordinal — a name the store's artifact filter discards is not an identity)`); pf.failures.push(`NAMEPREFIX ${kind}@${line}`) }
    }

    // ---- the file-level metadata the engine and the index read ----
    // `complexity` is asserted as an EXACT formula, not merely as "some
    // number": a mutant that halves it must fail, and the house formula for a
    // data language is symbols + relationships (lua, json).
    const expectedComplexity = res.symbols.length + res.relationships.length
    if (res.metadata?.complexity !== expectedComplexity) {
      v.failures.push(`${name} META complexity = ${res.metadata?.complexity}, want symbols+relationships = ${expectedComplexity}`)
      pf.failures.push(`META complexity`)
    }
    const wantKind = TRUTH.documentKind?.[name]
    if (wantKind && res.metadata?.documentKind !== wantKind) {
      v.failures.push(`${name} META documentKind = ${res.metadata?.documentKind}, want ${wantKind}`)
      pf.failures.push(`META documentKind`)
    }

    // ---- exports: exactly the top-level type-system declarations ----
    if (spec.exports) {
      const want = new Set<string>(spec.exports)
      const gotE = new Set<string>(res.exports.map((e: any) => e.name))
      for (const k of want) if (!gotE.has(k)) v.failures.push(`${name} EXPORT missing ${k}`)
      for (const k of gotE) if (!want.has(k)) v.failures.push(`${name} EXPORT unexpected ${k}`)
    }

    v.perFile[name] = pf
  }

  v.failed =
    v.failures.length > 0 || v.violations.length > 0 || v.unexpectedParseErrors.length > 0 ||
    v.expectedParseErrors.length > 0 || v.rangeFailures.length > 0
  return v
}
