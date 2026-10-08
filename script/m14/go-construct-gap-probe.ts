/**
 * GO CONSTRUCT GAP PROBE — does a Go construct that expresses a dependency
 * produce an edge?
 *
 * ## The question, and why reading the analyzer cannot answer it
 *
 * The workstream's GAP verdict is "the language HAS the construct and the
 * analyzer is not reading it". Reading the analyzer tells you which branches
 * exist. It cannot tell you whether a construct that reaches NO branch occurs in
 * the corpus at all — and `overrides` was omitted from Bash for a whole wave on
 * a prose justification while 174 redefinition events sat in the tree.
 *
 * So every probe here is a PARSE-TREE count paired with an EMISSION count from
 * the same file's production `parseFile` result. Construct count 0 is positive
 * evidence of absence. Construct count >0 with edge count 0 is a GAP candidate
 * and is reported as one.
 *
 * ## THE FIRST VERSION OF THIS PROBE WAS WRONG, and the way it was wrong is the
 * reason the shapes below are written down
 *
 * It reported 0 occurrences for generic instantiation, embedded interface,
 * method expression and type conversion — four constructs that occur in the
 * corpus thousands of times. Each cause was a node type I assumed rather than
 * measured, and a probe that reports 0 for a construct the P7b pass counted
 * 1,204 times in the same run is the instrument lying, which is the exact
 * failure this workstream exists to catch. The shapes, from
 * `script/m14/tmp/go-shapes-probe.mts` over a synthetic file and confirmed
 * against the corpus inventory in `validation` artifacts:
 *
 *   generic instantiation      `generic_type` with a `type_arguments` FIELD
 *                              (3,781 nodes) — NOT `index_expression`, which is
 *                              the EXPRESSION form `a[i]` and occurs 77,968
 *                              times. Counting `index_expression` in type
 *                              position would have counted array indexing.
 *   embedded interface         a `constraint_elem` direct child of
 *                              `interface_type` (1,133 nodes). NOT a bare
 *                              `type_identifier` child: the grammar wraps it.
 *                              The same node also carries generics type
 *                              CONSTRAINTS (`~int64 | int64`), so the two are
 *                              counted apart.
 *   method expression          `selector_expression` whose `operand` is a
 *                              `parenthesized_expression` (`(*T).M`). There is
 *                              NO `method_elem` node in this grammar: the
 *                              inventory counts 0 of them across 11,789 files.
 *   type conversion            `type_conversion_expression` (6,061 nodes) for a
 *                              composite/pointer/slice target, and a
 *                              `call_expression` whose `function` is a
 *                              `type_identifier` for a NAMED type target
 *                              (`MyType(x)`). Both are conversions per the spec
 *                              (Conversions) — neither has a function value.
 *   method value               `selector_expression` NOT in call position whose
 *                              `operand` is an `identifier` THAT IS NOT AN
 *                              IMPORTED PACKAGE NAME. The first version tested
 *                              only "operand is an identifier", which is also
 *                              true of `os.Stderr`, and counted 56,938 rows of
 *                              which the samples were `os.Stderr`, `flag.Usage`
 *                              and `zip.Store` — qualified package names, not
 *                              method values. The import table is what
 *                              separates them, and the grammar is what supplies
 *                              it.
 *   defined-type dependency    `type_spec` whose `type` field is a
 *                              `type_identifier`/`qualified_type` THAT IS NOT A
 *                              PREDECLARED TYPE. `type Format int` is 677 rows
 *                              of the first version's count and zero
 *                              dependencies: `int` is predeclared (spec,
 *                              Predeclared identifiers), so the analyzer's
 *                              exclusion of it is correct, not a gap.
 *
 * ## WHAT "EDGE" MEANS FOR EACH PROBE
 *
 * An edge is attributed to a probe by matching its TARGET against the
 * construct's own name, from the same `parseFile` result. A probe whose
 * construct occurs and whose matching edge count is 0 is a GAP candidate. P7b is
 * the labelling question and runs the other way: Go's spec makes conversion and
 * call DISJOINT (a conversion has no function value), so a conversion reaching a
 * `calls` edge is a mislabel rather than a gap, and any row is a finding.
 *
 * ## NO REGEX
 *
 * Zero regular expressions, by the lane's standing rule.
 *
 * USAGE
 *   npx tsx script/m14/go-construct-gap-probe.ts --out gaps.json [--files=N] [--repo=a,b]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1]
  const j = process.argv.find((a) => a.startsWith(`${flag}=`))
  return j ? j.slice(flag.length + 1) : dflt
}
const REPOS = (argOf("--repo", "go-stdlib") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const WANT = Number(argOf("--files", "2000"))
const MAX_BYTES = 512 * 1024
const SKIP = new Set((process.env.BB_GO_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean))
const SAMPLE_CAP = 6

/** Go's PREDECLARED identifiers (spec, Predeclared identifiers). A `type Format
 *  int` declares a new type whose underlying type is `int` — a builtin, not a
 *  dependency on another declaration — so these are excluded from every
 *  type-to-type probe. */
const PREDECLARED = new Set([
  "bool", "string", "error", "any", "comparable", "byte", "rune",
  "int", "int8", "int16", "int32", "int64",
  "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
  "float32", "float64", "complex64", "complex128",
])

type File = { repo: string; dir: string; rel: string; abs: string }
const files: File[] = []
const revisions: Record<string, string> = {}
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { revisions[e] = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    if (SKIP.has(`${e}/${rel}`)) continue
    if (detectLanguageFromPath(abs) !== "go") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : a.repo + "/" + a.rel > b.repo + "/" + b.rel ? 1 : 0))
const stride = Math.max(1, Math.floor(files.length / WANT))
const draw: File[] = []
for (let i = 0; i < files.length && draw.length < WANT; i += stride) draw.push(files[i])
console.log(`go construct gap probe — admitted ${files.length}  drawn ${draw.length} (stride ${stride})`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-go.wasm"))))

const leafOf = (raw: string): string => { const d = raw.lastIndexOf("."); return d === -1 ? raw : raw.slice(d + 1) }
const stripQuoteEnds = (s: string): string => {
  let out = s
  if (out.length) { const f = out.charCodeAt(0); if (f === 34 || f === 96) out = out.slice(1) }
  if (out.length) { const l = out.charCodeAt(out.length - 1); if (l === 34 || l === 96) out = out.slice(0, out.length - 1) }
  return out
}

type Probe = {
  occurrences: number
  files: Record<string, number>
  samples: string[]
  /** names the construct introduces, so an emitted edge can be attributed */
  names: string[]
  edges: number
  edgeSamples: string[]
  note: string
  /** what a non-zero `occurrences` with `edges: 0` would mean */
  wouldBe: string
}
const P = (k: string, note: string, wouldBe: string): Probe => ({ occurrences: 0, files: {}, samples: [], names: [], edges: 0, edgeSamples: [], note, wouldBe })
const probes: Record<string, Probe> = {
  P1_defined_type_dependency: P("P1",
    "`type X Y`, Y a DECLARED type — a new named type over another declaration",
    "a type-to-type dependency with no edge: `references X -> Y` is the family label, and publishing it is a labelling decision, not a lane's"),
  P2_type_alias_dependency: P("P2",
    "`type X = Y` — an alias: same type, different name",
    "an alias edge. Go's spec makes an alias a NAME for a type, so `references` is the same candidate as P1"),
  P3_generic_instantiation: P("P3",
    "`generic_type` in type position — `G[int]`, Go's instantiation of a generic type",
    "an instantiation edge naming the base type. `references X -> G` is emitted today, so the question is whether the TYPE ARGUMENTS get an edge of their own"),
  P3b_generic_type_argument: P("P3b",
    "a type ARGUMENT of an instantiation that is itself a declared type (`Map[Key, Value]` with local Key/Value)",
    "an edge for the argument type. Distinct from P3 because a `references` edge to the base type says nothing about the argument"),
  P4_embedded_interface: P("P4",
    "`constraint_elem` naming an interface — an interface embedding another interface",
    "an `extends` edge, as struct embedding already gets"),
  P4b_type_constraint_union: P("P4b",
    "a generics type CONSTRAINT (`~int64 | int64`) — recorded so P4's count is not inflated by it",
    "nothing in the ontology expresses a type-constraint union; a ruling, not a gap"),
  P5_method_value: P("P5",
    "`x.M` used as a value, NOT called, with `x` a value and not an imported package name",
    "an edge from the binding function to the method. Go's method value binds a method without a call, and the family has no label for it that is not `uses`"),
  P6_method_expression: P("P6",
    "`T.M` with an explicit receiver type — `selector_expression` over a parenthesised or bare type",
    "an edge to the method. Distinct from P5: no receiver VALUE exists"),
  P7_type_conversion: P("P7",
    "`type_conversion_expression` plus a `call_expression` whose function is a type — a CONVERSION, which has no function value",
    "an edge. Per the spec a conversion is not a call, so a `calls` edge here is a MISLABEL, not a gap"),
  P7b_conversion_reaching_calls: P("P7b",
    "a conversion whose target name reached a `calls` edge — the mislabel check",
    "n/a — this probe is the mislabel check and any row is a finding"),
  P8_channel_operation: P("P8",
    "`ch <- v` send and `<-ch` receive",
    "nothing in the ontology expresses a channel operation; a measured absence, and the measurement is what makes it a ruling"),
  P9_select_statement: P("P9",
    "`select { case <-ch: }`",
    "as P8"),
  P10_defer_and_go: P("P10",
    "`defer f()` / `go f()` — the CONTROL: these are calls and must already produce `calls` edges",
    "nothing. A non-zero construct count with zero `calls` edges would mean the control itself is broken and every other row here is void"),
}
const bump = (k: string, label: string, detail: string, name?: string) => {
  const p = probes[k]
  p.occurrences++
  p.files[label] = (p.files[label] ?? 0) + 1
  if (p.samples.length < SAMPLE_CAP) p.samples.push(`${label}: ${detail}`)
  if (name && p.names.length < 4000) p.names.push(name)
}

const t0 = Date.now()
for (const f of draw) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  const t = parser.parse(text)
  if (!t) continue
  const label = `${f.repo}/${f.rel}`
  // The file's IMPORT TABLE: the last path segment of each import path is a
  // package name bound in this file. It is what separates `os.Stderr` (a
  // qualified name) from `s.Save` (a method value) — both are
  // `selector_expression` over an `identifier`.
  const importedNames = new Set<string>()
  {
    const walkImports = (n: any) => {
      if (n.type === "import_spec") {
        const p = stripQuoteEnds(String(n.childForFieldName?.("path")?.text ?? ""))
        const segs = p.split("/")
        const last = segs[segs.length - 1]
        if (last.length) importedNames.add(last)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walkImports(c) }
    }
    walkImports(t.rootNode)
  }
  const walk = (n: any) => {
    switch (n.type) {
      case "type_spec": {
        const ty = n.childForFieldName?.("type")
        const nm = String(n.childForFieldName?.("name")?.text ?? "")
        if (ty && (ty.type === "type_identifier" || ty.type === "qualified_type")) {
          const leaf = leafOf(String(ty.text))
          if (!PREDECLARED.has(leaf) && nm.length) bump("P1_defined_type_dependency", label, `${nm} <- ${String(ty.text)}`, leaf)
        }
        break
      }
      case "type_alias": {
        const ty = n.childForFieldName?.("type")
        const nm = String(n.childForFieldName?.("name")?.text ?? "")
        if (ty && (ty.type === "type_identifier" || ty.type === "qualified_type")) {
          const leaf = leafOf(String(ty.text))
          if (!PREDECLARED.has(leaf) && nm.length) bump("P2_type_alias_dependency", label, `${nm} = ${String(ty.text)}`, leaf)
        }
        break
      }
      case "generic_type": {
        bump("P3_generic_instantiation", label, String(n.text).slice(0, 50), leafOf(String(n.childForFieldName?.("type")?.text ?? "")))
        const args = n.childForFieldName?.("type_arguments")
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const a = args.namedChild(i)
            if (!a) continue
            if (a.type !== "type_identifier" && a.type !== "qualified_type" && a.type !== "generic_type") continue
            const leaf = leafOf(String(a.text))
            if (PREDECLARED.has(leaf)) continue
            bump("P3b_generic_type_argument", label, `${String(n.text).slice(0, 40)} arg ${String(a.text)}`, leaf)
          }
        }
        break
      }
      case "interface_type": {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type !== "constraint_elem") continue
          // A constraint_elem is EITHER an embedded interface name (a
          // type_identifier / qualified_type child) or a constraint EXPRESSION
          // (`~int64 | int64`, whose children are operators and literals).
          let sawName = ""
          for (let j = 0; j < c.namedChildCount; j++) {
            const k = c.namedChild(j)
            if (!k) continue
            if (k.type === "type_identifier" || k.type === "qualified_type" || k.type === "generic_type") sawName = leafOf(String(k.text))
          }
          if (sawName.length) bump("P4_embedded_interface", label, `${label} interface embeds ${sawName}`, sawName)
          else bump("P4b_type_constraint_union", label, `${label} constraint ${String(c.text).slice(0, 40)}`)
        }
        break
      }
      case "type_conversion_expression": {
        const ty = n.childForFieldName?.("type")
        const leaf = leafOf(String(ty?.text ?? ""))
        if (leaf.length) bump("P7_type_conversion", label, `${leaf}(...)`, leaf)
        break
      }
      case "call_expression": {
        const fn = n.childForFieldName?.("function")
        if (fn && (fn.type === "type_identifier" || fn.type === "qualified_type")) {
          const leaf = leafOf(String(fn.text))
          if (!PREDECLARED.has(leaf)) bump("P7_type_conversion", label, `${leaf}(...) [call_expression]`, leaf)
        }
        break
      }
      case "send_statement":
        bump("P8_channel_operation", label, "send")
        break
      case "unary_expression": {
        if (String(n.child(0)?.type ?? "") === "<-") bump("P8_channel_operation", label, "receive")
        break
      }
      case "select_statement":
        bump("P9_select_statement", label, "select")
        break
      case "defer_statement":
      case "go_statement": {
        const inner = n.namedChild(0)
        const fn = inner?.childForFieldName?.("function")
        if (fn) bump("P10_defer_and_go", label, `${n.type} ${leafOf(String(fn.text))}`, leafOf(String(fn.text)))
        break
      }
      case "selector_expression": {
        const par = n.parent
        const inCall = par?.type === "call_expression" && par.childForFieldName?.("function")?.id === n.id
        if (inCall) break
        const sel = String(n.childForFieldName?.("field")?.text ?? "")
        const operand = n.childForFieldName?.("operand")
        if (!sel.length || !operand) break
        if (operand.type === "parenthesized_expression" || operand.type === "type_identifier" || operand.type === "qualified_type") {
          bump("P6_method_expression", label, String(n.text).slice(0, 40), sel)
          break
        }
        // A method value needs a VALUE receiver. An `identifier` operand is
        // ambiguous — it is also how a package name is written — so the import
        // table decides, and the two counts are reported apart.
        if (operand.type === "identifier") {
          if (importedNames.has(String(operand.text))) {
            bump("P4b_type_constraint_union", label, `qualified-name-not-method-value: ${String(n.text).slice(0, 40)}`)
          } else {
            bump("P5_method_value", label, String(n.text).slice(0, 40), sel)
          }
        }
        break
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c)
    }
  }
  walk(t.rootNode)
  t.delete?.()
}
console.log(`construct pass done in ${Date.now() - t0} ms`)

// ── emission pass: does an edge exist, and with what label? ──────────────────
let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    const rels: any[] = r?.relationships ?? []
    const targetsByType = new Map<string, Set<string>>()
    for (const x of rels) {
      const ty = String(x.type ?? x.relationshipType ?? "")
      const s = targetsByType.get(ty) ?? new Set<string>()
      s.add(String(x.target ?? ""))
      targetsByType.set(ty, s)
    }
    const has = (ty: string, name: string): boolean => targetsByType.get(ty)?.has(name) ?? false
    // Attribute every probe's names to whatever labels DID carry them. This is
    // the measurement: a construct whose name appears under a DIFFERENT label is
    // a labelling answer, and one that appears under none is a gap.
    for (const k of Object.keys(probes)) {
      const p = probes[k]
      if (k === "P7b_conversion_reaching_calls" || k === "P4b_type_constraint_union") continue
      for (const name of p.names) {
        let hitLabel = ""
        for (const ty of ["calls", "uses", "references", "instantiates", "extends", "implements", "contains", "overrides", "exports", "imports"]) {
          if (has(ty, name)) { hitLabel = ty; break }
        }
        if (!hitLabel) continue
        if (k === "P10_defer_and_go") {
          if (hitLabel === "calls") { p.edges++; if (p.edgeSamples.length < SAMPLE_CAP * 2) p.edgeSamples.push(`${label} calls -> ${name}`) }
          continue
        }
        if (k === "P7_type_conversion") {
          if (hitLabel === "calls") {
            p.edges++
            if (p.edgeSamples.length < SAMPLE_CAP * 2) p.edgeSamples.push(`${label} calls -> ${name}  MISLABEL: a conversion is not a call`)
            probes.P7b_conversion_reaching_calls.edges++
            if (probes.P7b_conversion_reaching_calls.edgeSamples.length < SAMPLE_CAP * 2) {
              probes.P7b_conversion_reaching_calls.edgeSamples.push(`${label} calls -> ${name} (a conversion has no function value)`)
            }
          } else if (hitLabel === "instantiates" || hitLabel === "references" || hitLabel === "uses") {
            p.edges++
            if (p.edgeSamples.length < SAMPLE_CAP * 2) p.edgeSamples.push(`${label} ${hitLabel} -> ${name}`)
          }
          continue
        }
        p.edges++
        if (p.edgeSamples.length < SAMPLE_CAP * 2) p.edgeSamples.push(`${label} ${hitLabel} -> ${name}`)
      }
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.BB_GO_RESOLVE_WORKERS ?? "3") }, () => worker()))

const report = {
  schema: "go-construct-gap-probe/2",
  repos: REPOS,
  revisions,
  corpusAdmitted: files.length,
  filesDrawn: draw.length,
  drawStride: stride,
  wallMs: Date.now() - t0,
  probes,
}
console.log(`\n${"probe".padEnd(32)}${"constructs".padStart(11)}${"files".padStart(7)}${"edges".padStart(8)}  verdict`)
console.log("-".repeat(170))
for (const k of Object.keys(probes)) {
  const p = probes[k]
  let verdict: string
  if (k === "P7b_conversion_reaching_calls") verdict = p.edges === 0 ? "no mislabel found" : `${p.edges} CONVERSIONS LABELLED calls — mislabel`
  else if (p.occurrences === 0) verdict = "construct does not occur — RULED by the grammar"
  else if (p.edges === 0) verdict = `GAP CANDIDATE: ${p.occurrences} constructs, 0 edges`
  else verdict = `covered (${p.edges} edges carry the construct's name)`
  console.log(`${k.padEnd(32)}${String(p.occurrences).padStart(11)}${String(Object.keys(p.files).length).padStart(7)}${String(p.edges).padStart(8)}  ${verdict}`)
  console.log(`      construct: ${p.note}`)
  if (p.samples.length) console.log(`      e.g. ${p.samples.slice(0, 3).join(" ; ")}`)
  if (p.edgeSamples.length) console.log(`      edges: ${p.edgeSamples.slice(0, 3).join(" ; ")}`)
  if (p.occurrences > 0 && p.edges === 0) console.log(`      would be: ${p.wouldBe}`)
}
if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 2)); console.log(`\nwrote ${OUT}`) }
process.exit(0)