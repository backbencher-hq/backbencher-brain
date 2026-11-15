/**
 * JSON LANE ADVERSARIAL REVIEW — pass 2. For every type the analyzer EMITS, try to
 * find a case where it is WRONG.
 *
 * ## What this is for
 *
 * `census.ts` answers "how many, and do both endpoints bind". `differential.ts` answers
 * "do two independent implementations agree". Neither of those asks the question that
 * finds defects: **is the label on this edge the RIGHT one, and is the type emitted for
 * the whole construct or only the part of it an earlier audit happened to imagine?**
 *
 * That question has a documented history in this lane. `imports`, `exports`, `extends`,
 * `calls` and `overrides` were each ruled out by an audit that searched for the
 * conventions it already had in mind, and each was later found in the corpus carrying
 * edges. So the failure mode is not "the probe was wrong", it is "the probe asked the
 * question the implementer already knew the answer to". This script therefore asks each
 * type's question in a shape the implementer did NOT choose:
 *
 *   - `references`  — the target taxonomy (resolved pointer / unresolved pointer /
 *                     bare `#` / URL / file). "98.52% resolve" says nothing about whether
 *                     the 1.48% should exist at all.
 *   - `uses`        — the two emission SITES (OpenAPI endpoint vs manifest dependency)
 *                     and whether the endpoint edge is distinguishable from the
 *                     `contains` edge the same pair of symbols already has.
 *   - `extends`     — the SOURCE of every edge. Composition is `allOf`; the question is
 *                     whether the thing that EXTENDS is the schema object or the `allOf`
 *                     array, and whether `allOf` is the only keyword that means a superset
 *                     relation. Both are read off real edges, not assumed.
 *   - `exports` / `calls` / `imports` / `overrides` — form splits and target shapes, and
 *                     whether the endpoint is a symbol the file declares.
 *   - `contains`    — the unresolvable-source class, which the differential records as
 *                     183 UNEXPLAINED array-in-array edges and neither side adjudicates.
 *
 * And then the half that pass 1 could not do, because `extends` was already EMITTED and
 * therefore never audited for completeness: **is `allOf` the only keyword that means a
 * superset relation in this corpus?** A key named `extends` is how `tsconfig.json`
 * inherits, which is a superset relation written as an ordinary object key — the same
 * shape as the manifest `exports` field the lane retracted an earlier ruling over.
 *
 * Every tree probe below runs on the PARSE TREE and asks about a ROLE (is this string the
 * KEY of a `pair`; is the value an object, a string, an array), never about a SHAPE in
 * free text. That is the rule `probes.ts` records and it is not negotiable: a regex for
 * `new Map(` matched JavaScript inside a bash heredoc, and a regex for `extends` matched
 * `class voice` inside a telnet IAC word list. A probe that matches a shape rather than a
 * role produces a number, and the number is worth nothing.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/json/adversarial.ts [--limit N] [--stride N] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

const argv = process.argv.slice(2)
const argOf = (flag: string, d: string) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const LIMIT = Number(argOf("--limit", "0"))
const STRIDE = Number(argOf("--stride", "0"))
const OUT = argOf("--out", "")

// ---------------------------------------------------------------- population
type FileRow = { repo: string; dir: string; rel: string; abs: string }
const population: FileRow[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
      .sort()
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "json") continue
    population.push({ repo: e, dir, rel, abs })
  }
}
const files = STRIDE > 0 ? population.filter((_, i) => i % STRIDE === 0) : LIMIT > 0 ? population.slice(0, LIMIT) : population

// ---------------------------------------------------------------- tallies
type Bucket = { n: number; files: Set<string>; examples: string[] }
const bucket = (m: Map<string, Bucket>, k: string, label: string, ex: string) => {
  const b = m.get(k) ?? { n: 0, files: new Set<string>(), examples: [] }
  b.n++
  b.files.add(label)
  if (b.examples.length < 5) b.examples.push(ex)
  m.set(k, b)
}
const serialise = (m: Map<string, Bucket>) =>
  Object.fromEntries([...m.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, b]) => [k, { occurrences: b.n, files: b.files.size, examples: b.examples }]))

/** Edge-shape tallies, keyed `type::classification`. */
const edgeClasses = new Map<string, Bucket>()
/** Resolution tallies keyed `type::both|sourceOnly|targetOnly|neither`, counted per CLASS. */
const classResolve = new Map<string, { both: number; sourceOnly: number; targetOnly: number; neither: number }>()
/**
 * NAME binding, per type — the question `census.ts` cannot ask.
 *
 * The census counts an endpoint resolved if it matches a symbol by name OR by
 * qualifiedName, because both are available in the analyzer's output. The STORE resolves
 * by NAME (the reason this lane names every edge endpoint with a symbol name rather than a
 * path). So an edge whose endpoint is a path resolves in the census and binds to an
 * ARBITRARY same-named symbol in the store. This tally is the difference between the two,
 * per type, and it is the number a `bb_impact` consumer actually experiences.
 */
const nameBind = new Map<string, { both: number; srcName: number; tgtName: number; neitherName: number; total: number; examples: string[] }>()
/** Distinct endpoint names per type, so ambiguity is a measurement and not an adjective. */
const endpointNameMultiplicity = new Map<string, Map<string, number>>()
/** Per-type per-site tallies from `metadata`, so a type with two sites is not one number. */
const typeSites = new Map<string, Bucket>()


/** Sub-1.0 edges with no machine-readable reason code — honesty contract §4 point 1. */
const subOneWithoutReason = new Map<string, Bucket>()
/** Confidence histogram per type, so a sub-1.0 class is a number and not an impression. */
const confHist = new Map<string, Map<string, number>>()

let parseFailures = 0
const failureExamples: string[] = []

const isUrl = (t: string) => t.startsWith("http://") || t.startsWith("https://")
const DOCUMENT_EXT = ["json", "jsonc", "json5", "yaml", "yml", "avsc", "avdl", "proto"]
const isDocName = (t: string) => {
  const w = t.split("#")[0]
  const d = w.lastIndexOf(".")
  return d >= 0 && DOCUMENT_EXT.includes(w.slice(d + 1).toLowerCase())
}

for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  let r: any
  try {
    r = await parseFile(f.abs, f.dir)
  } catch (e: any) {
    parseFailures++
    if (failureExamples.length < 6) failureExamples.push(`${label}: ${String(e?.message ?? e)}`)
    continue
  }
  const syms = r.symbols ?? []
  const byName = new Set<string>()
  const byQualified = new Set<string>()
  for (const s of syms) {
    byName.add(String(s.name))
    byQualified.add(String(s.qualifiedName ?? s.name))
  }
  const resolves = (v: unknown) => byName.has(String(v)) || byQualified.has(String(v))
  const nameCount = new Map<string, number>()
  for (const s of syms) {
    const n = String(s.name)
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1)
  }
  for (const x of r.relationships ?? []) {
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
    if (!ALL_TYPES.includes(t)) continue
    const m = endpointNameMultiplicity.get(t) ?? new Map<string, number>()
    for (const ep of [String(x.source ?? ""), String(x.target ?? "")]) {
      const c = nameCount.get(ep)
      const cell = c === undefined ? "names no symbol" : c === 1 ? "1 symbol" : `${c} symbols share this name`
      m.set(cell, (m.get(cell) ?? 0) + 1)
    }
    endpointNameMultiplicity.set(t, m)
  }
  const moduleName = (() => {
    const base = f.rel.split("/").pop() ?? "document.json"
    for (const s of [".json", ".jsonc", ".json5"]) if (base.toLowerCase().endsWith(s)) return base.slice(0, base.length - s.length) || "document"
    return base
  })()

  for (const x of r.relationships ?? []) {
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
    if (!ALL_TYPES.includes(t)) continue
    const src = String(x.source ?? "")
    const tgt = String(x.target ?? "")
    const md = (x.metadata ?? {}) as Record<string, any>
    const site = String(md.relationshipType ?? md.exportForm ?? md.callForm ?? md.importForm ?? md.composition ?? (md.redefinition ? "redefinition" : "(none)"))
    bucket(typeSites, `${t}::${site}`, label, `${label}:${x.line_number ?? 0} ${src} -[${t}]-> ${tgt}`)

    // ---- per-type classification, each one a QUESTION about that type's label
    let cls = "other"
    if (t === "references") {
      if (tgt === "#") cls = "bare-hash (document root)"
      else if (tgt.startsWith("#/")) cls = "pointer unresolved (target IS the raw pointer)"
      else if (isUrl(tgt)) cls = "URL (a vocabulary, not a location in this document)"
      else if (isDocName(tgt)) cls = "file name (also emitted as imports)"
      else if (tgt.startsWith(moduleName)) cls = "pointer resolved to a path"
      else cls = "unclassified"
    } else if (t === "uses") {
      cls = site === "json_api_endpoint" ? "OpenAPI endpoint declared by its container" : site === "package_dependency" ? "manifest dependency entry" : `other(${site})`
    } else if (t === "extends") {
      // The QUESTION: is the thing that extends the COMPOSING SCHEMA OBJECT or the
      // `allOf` array? Read off the edge, not off the source. The source of every
      // composition edge is the `allOf` ARRAY (`…allOf`), not the object holding it, so
      // the edge names a path whose LAST SEGMENT is a keyword shared by every schema in
      // the file.
      cls = src.endsWith(".allOf") ? "source is the allOf ARRAY, not the schema object that composes" : `source does NOT end in .allOf (${src.slice(-40)})`
    } else if (t === "exports") {
      cls = site === "manifest_entry_point" ? (tgt === "main" || tgt === "bin" || tgt === "exports" ? `manifest field ${tgt}` : "exports subpath key") : `other(${site})`
    } else if (t === "calls") {
      cls = site === "npm_run_sibling_script" ? "npm/pnpm/yarn/bun run <sibling script>" : `other(${site})`
    } else if (t === "imports") {
      cls = isUrl(tgt) ? "URL target (should not be a file dependency)" : `file target (${isDocName(tgt) ? "document name" : "NOT a document name"})`
    } else if (t === "overrides") {
      cls = tgt.length === 0 ? "EMPTY key (declined by contract, expected 0)" : `named key in one object`
    } else if (t === "contains") {
      cls = /\[\d+\]\[\d+\]$/.test(src) ? "owner is an array element (nested index)" : /\[\d+\]$/.test(src) ? "owner is an array element" : "owner is a key of an object"
    }
    const conf = Number(x.confidence ?? 0)
    const ch = confHist.get(t) ?? new Map<string, number>()
    ch.set(String(conf), (ch.get(String(conf)) ?? 0) + 1)
    confHist.set(t, ch)
    if (conf < 1) {
      const hasReason = md.reasonCode !== undefined || md.evidenceClass !== undefined
      if (!hasReason) bucket(subOneWithoutReason, t, label, `${label}:${x.line_number ?? 0} ${src} -[${t} c=${conf}]-> ${tgt} metadata=${JSON.stringify(md).slice(0, 90)}`)
    }

    const key = `${t}::${cls}`
    bucket(edgeClasses, key, label, `${label}:${x.line_number ?? 0} ${src} -[${t}]-> ${tgt}`)
    const nb = nameBind.get(t) ?? { both: 0, srcName: 0, tgtName: 0, neitherName: 0, total: 0, examples: [] }
    nb.total++
    const sName = byName.has(src)
    const tName = byName.has(tgt)
    if (sName && tName) nb.both++
    else if (sName) nb.srcName++
    else if (tName) nb.tgtName++
    else {
      nb.neitherName++
      if (nb.examples.length < 6) nb.examples.push(`${label}:${x.line_number ?? 0} ${src} -[${t}]-> ${tgt}`)
    }
    nameBind.set(t, nb)

    const cell = classResolve.get(key) ?? { both: 0, sourceOnly: 0, targetOnly: 0, neither: 0 }
    const sOk = resolves(src)
    const tOk = resolves(tgt)
    if (sOk && tOk) cell.both++
    else if (sOk) cell.sourceOnly++
    else if (tOk) cell.targetOnly++
    else cell.neither++
    classResolve.set(key, cell)
  }
}

// ---------------------------------------------------------------- parse-tree probes
//
// These are the completeness questions the verdict loop could not ask, because a type
// that is EMITTED is never audited for whether the WHOLE construct is read.
const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new Parser()
parser.setLanguage(await Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))))

const unquote = (t: string): string => {
  const v = t.trim()
  return v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v
}
const keyOf = (pair: any): string | null => {
  if (pair?.type !== "pair") return null
  const k = pair.childForFieldName?.("key")
  if (!k) return null
  const c = k.namedChildren?.find((x: any) => x.type === "string_content")
  return c ? String(c.text ?? "") : unquote(String(k.text ?? ""))
}
const valueOf = (pair: any): any => pair?.childForFieldName?.("value")

/**
 * PROBE 1 — is `allOf` the ONLY keyword that means a superset relation?
 *
 * The lane emits `extends` for `allOf` and ruled `anyOf`/`oneOf`/`not` alternatives out.
 * That ruling is about COMPOSITION keywords. It says nothing about a key named `extends`,
 * which is not a composition keyword at all: it is how `tsconfig.json` says "inherit this
 * configuration", and inheritance of configuration is a superset relation written as an
 * ordinary object key — the same shape as the manifest `exports` field this lane
 * retracted an earlier `exports` ruling over.
 *
 * The probe is ROLE-aware in the way that matters: it counts a `pair` whose KEY is
 * `extends`, splits by the VALUE'S role, and for a string value reports whether the named
 * document EXISTS on disk next to the file. The existence check is what separates
 * "inherits a configuration file" from "the word appears in a description", and it is a
 * filesystem fact, not a guess.
 */
const extendsKey = new Map<string, Bucket>()
/** The same, restricted to values that name a document which EXISTS beside the file. */
const extendsKeyRealFile = new Map<string, Bucket>()

/**
 * PROBE 2 — a supertype CLAUSE, for `implements`.
 *
 * A supertype clause names a TYPE. A file reference names a FILE. The probe therefore
 * counts a `pair` whose key is a supertype-candidate AND whose value is a string that
 * does NOT name a document, i.e. the one shape that could be a type name, and reports
 * every example so a reader can judge the role rather than trust the count. This is the
 * instrument the gate's `implements` row CANNOT run: it is a grammar inventory, and a
 * grammar has no node type for a keyword.
 */
const SUPERTYPE_CANDIDATE_KEYS = ["implements", "implementsInterfaces", "$implements", "extends", "$extends", "inherits", "inheritsFrom", "superclass", "superClass", "base", "baseClass", "parent", "prototype", "mixin", "satisfies", "conformsTo", "derivedFrom"]
const supertypeClause = new Map<string, Bucket>()

/**
 * PROBE 3 — a CONSTRUCTION, for `instantiates`.
 *
 * `instantiates` needs a value that binds an instance. A `pair` whose key names a
 * constructor and whose value is an OBJECT is the one shape that could be an instance's
 * state; a string value is a name, an array value is a described list. Counted by role,
 * reported with examples.
 */
const CONSTRUCTOR_KEYS = ["new", "constructor", "__init__", "__new__", "init", "instantiate", "create", "factory"]
const construction = new Map<string, Bucket>()

let parsed = 0
let treeErrorFiles = 0
for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  let text: string
  try {
    text = readFileSync(f.abs, "utf8")
  } catch {
    continue
  }
  const tree = parser.parse(text)
  if (!tree) continue
  parsed++
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "ERROR" || n.isMissing) treeErrorFiles++
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
    if (n.type !== "pair") continue
    const k = keyOf(n)
    if (k === null) continue
    const v = valueOf(n)
    const role = !v ? "(absent)" : v.type === "object" ? "object" : v.type === "array" ? "array" : v.type === "string" ? "string" : "scalar"
    if (k === "extends") {
      const where = `${label}:${n.startPosition.row + 1}`
      bucket(extendsKey, `value role = ${role}`, label, `${where} "extends": ${role}`)
      if (role === "string") {
        const target = unquote(String(v.text ?? ""))
        bucket(extendsKey, `string value = ${isUrl(target) ? "a URL" : isDocName(target) ? "a document name" : "a bare word"}`, label, `${where} -> ${target.slice(0, 70)}`)
        const rel = path.resolve(path.dirname(f.abs), target.split("#")[0])
        if (isDocName(target) && existsSync(rel)) {
          bucket(extendsKeyRealFile, `names a document that EXISTS beside the file`, label, `${where} -> ${target.slice(0, 70)}`)
        }
      }
    }
    if (SUPERTYPE_CANDIDATE_KEYS.includes(k)) {
      if (role === "string") {
        const target = unquote(String(v.text ?? ""))
        const kind = isDocName(target) ? "string naming a DOCUMENT (a file reference, not a type)" : isUrl(target) ? "string naming a URL (a vocabulary, not a type)" : "string naming something else — the one shape that could be a TYPE"
        bucket(supertypeClause, `${k} -> ${kind}`, label, `${label}:${n.startPosition.row + 1} "${k}": ${target.slice(0, 60)}`)
      } else {
        bucket(supertypeClause, `${k} -> ${role} value`, label, `${label}:${n.startPosition.row + 1} "${k}": ${role}`)
      }
    }
    if (CONSTRUCTOR_KEYS.includes(k)) {
      bucket(construction, `${k} -> ${role} value`, label, `${label}:${n.startPosition.row + 1} "${k}": ${role}`)
      if (role === "object") {
        const members = (v.namedChildren ?? []).filter((c: any) => c.type === "pair").map((c: any) => keyOf(c)).filter(Boolean) as string[]
        bucket(construction, `${k} -> OBJECT with members [${members.slice(0, 6).join(",")}]`, label, `${label}:${n.startPosition.row + 1}`)
      }
    }
  }
  tree.delete?.()
}

// ---------------------------------------------------------------- report
const out: any = {
  tool: "json lane adversarial review (pass 2)",
  corpusRoot: CR,
  admittedPopulation: population.length,
  sampled: files.length,
  sampleMethod: STRIDE > 0 ? `every ${STRIDE}th file of the (repo, git-path)-sorted admitted population` : LIMIT > 0 ? `deterministic prefix, first ${LIMIT}` : "whole admitted population",
  parseFailures,
  parseFailureExamples: failureExamples,
  edgeClasses: serialise(edgeClasses),
  edgeClassResolution: Object.fromEntries([...classResolve.entries()].sort().map(([k, v]) => [k, v])),
  nameBindingPerType: Object.fromEntries([...nameBind.entries()].sort().map(([k, v]) => [k, v])),
  endpointNameMultiplicity: Object.fromEntries([...endpointNameMultiplicity.entries()].sort().map(([k, v]) => [k, Object.fromEntries([...v.entries()].sort((a, b) => b[1] - a[1]))])),
  typeSites: serialise(typeSites),
  confidenceHistogram: Object.fromEntries([...confHist.entries()].sort().map(([k, v]) => [k, Object.fromEntries(v.entries())])),
  subOneWithoutReasonCode: serialise(subOneWithoutReason),
  treeProbes: {
    parsedFiles: parsed,
    filesWithErrorOrMissingNodes: treeErrorFiles,
    "PROBE1-extends-key": serialise(extendsKey),
    "PROBE1-extends-key-naming-an-existing-file": serialise(extendsKeyRealFile),
    "PROBE2-supertype-clause": serialise(supertypeClause),
    "PROBE3-construction": serialise(construction),
  },
}
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2))

console.log(`json lane adversarial review — population ${population.length}, sampled ${files.length}, parse failures ${parseFailures}, tree-parsed ${parsed}`)
console.log("")
console.log("=== edge classes (type::classification) with endpoint resolution ===")
for (const [k, b] of [...edgeClasses.entries()].sort()) {
  const c = classResolve.get(k)!
  const tot = c.both + c.sourceOnly + c.targetOnly + c.neither
  const bothPct = tot ? ((c.both / tot) * 100).toFixed(2) : "n/a"
  console.log(`${k.padEnd(72)}${String(b.n).padStart(8)} edges ${String(b.files.size).padStart(5)} files  both=${bothPct}% srcOnly=${c.sourceOnly} tgtOnly=${c.targetOnly} neither=${c.neither}`)
  for (const e of b.examples.slice(0, 2)) console.log(`      ${e}`)
}
console.log("")
console.log("")
console.log("=== confidence histogram per type, and sub-1.0 edges with NO reasonCode/evidenceClass ===")
for (const [k, v] of [...confHist.entries()].sort()) console.log(`${k.padEnd(14)} ${Object.entries(v).map(([c, n]) => `c=${c}:${n}`).join("  ")}`)
for (const [k, b] of [...subOneWithoutReason.entries()].sort()) {
  console.log(`  !! ${k}: ${b.n} edges below 1.0 with no reasonCode and no evidenceClass, in ${b.files.size} files`)
  for (const e of b.examples.slice(0, 3)) console.log(`      ${e}`)
}
if (subOneWithoutReason.size === 0) console.log("  (none: every sub-1.0 edge carries a machine-readable code)")
console.log("")
console.log("")
console.log("=== NAME binding per type (what the STORE can resolve; census accepts name OR qualifiedName) ===")
for (const [k, v] of [...nameBind.entries()].sort()) {
  const bothPct = ((v.both / v.total) * 100).toFixed(2)
  console.log(`${k.padEnd(14)} ${String(v.total).padStart(9)} edges  both-by-NAME ${bothPct.padStart(7)}%  srcOnly ${String(v.srcName).padStart(7)}  tgtOnly ${String(v.tgtName).padStart(6)}  neither ${String(v.neitherName).padStart(6)}`)
  for (const e of v.examples.slice(0, 3)) console.log(`      ${e}`)
}
console.log("")
console.log("=== endpoint NAME multiplicity per type (ambiguity the store cannot see) ===")
for (const [k, v] of [...endpointNameMultiplicity.entries()].sort()) {
  console.log(`${k.padEnd(14)} ` + [...v.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => `${c}:${n}`).join("  "))
}
console.log("")
console.log("=== emission sites per type ===")
for (const [k, b] of [...typeSites.entries()].sort()) console.log(`${k.padEnd(58)}${String(b.n).padStart(9)} ${String(b.files.size).padStart(6)} files`)
console.log("")
console.log("=== PROBE 1: is allOf the only superset relation? `extends` keys ===")
for (const [k, b] of [...extendsKey.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k.padEnd(60)}${String(b.n).padStart(7)} occ ${String(b.files.size).padStart(5)} files`)
  for (const e of b.examples.slice(0, 3)) console.log(`      ${e}`)
}
console.log("  -- restricted to values naming a document that EXISTS beside the file --")
if (extendsKeyRealFile.size === 0) console.log("      (none)")
for (const [k, b] of [...extendsKeyRealFile.entries()].sort()) {
  console.log(`  ${k.padEnd(60)}${String(b.n).padStart(7)} occ ${String(b.files.size).padStart(5)} files`)
  for (const e of b.examples.slice(0, 5)) console.log(`      ${e}`)
}
console.log("")
console.log("=== PROBE 2: supertype-clause candidates, split by the VALUE's role ===")
for (const [k, b] of [...supertypeClause.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k.padEnd(60)}${String(b.n).padStart(7)} occ ${String(b.files.size).padStart(5)} files`)
  for (const e of b.examples.slice(0, 3)) console.log(`      ${e}`)
}
console.log("")
console.log("=== PROBE 3: construction candidates, split by the VALUE's role ===")
for (const [k, b] of [...construction.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) {
  console.log(`  ${k.padEnd(70)}${String(b.n).padStart(7)} occ ${String(b.files.size).padStart(5)} files`)
  for (const e of b.examples.slice(0, 2)) console.log(`      ${e}`)
}
if (OUT) console.log(`\nwrote ${OUT}`)