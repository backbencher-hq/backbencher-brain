/**
 * TS DIFFERENTIAL CLASSIFICATION — every MISSING / UNEXPLAINED row from the lane's own differential,
 * bucketed by CAUSE, so the D4 audit debt is named rather than counted.
 *
 * ## Why this instrument
 *
 * The Lead's scoped differential run reported, over two 60-file draws:
 *   vue-core     truth 5362 · covered 4742 (88.4%) · MISSING 620 · analyzer 3920 · unexplained 331
 *   element-plus truth 1620 · covered 1428 (88.1%) · MISSING 192 · analyzer 1413 · unexplained 77
 * The samples are all `references` rows that look like type parameters and member names. A bucket
 * list with counts is what decides whether a row is the ORACLE over-deriving (a local binding is not
 * a project reference) or the ANALYZER missing a real edge — and those two have opposite fixes.
 *
 * ## How it stays honest
 *
 * It imports the differential's OWN truth builders and normTarget (so the comparison is the
 * differential's, not a re-implementation), runs the SAME per-file matching rule (label + normTarget,
 * with the differential's own `te.target.includes(normTarget(r.target))` allowance in the
 * unexplained direction), and then bucket-classifies the mismatches. It does NOT write the
 * F5 artifact and does NOT claim differential numbers for the differential's population: it draws
 * its own deterministic 60-file stride and PRINTS that population — the counts here classify the
 * same ROW CLASSES, and the differential's own counts remain the Lead's measurement.
 *
 * ## THE BUCKETS THIS ROUND ADDED, AND WHY THE OLD "other" WAS NOT A DISPOSITION
 *
 * The first version of this instrument ended with an `other (sample for manual read)` bucket, and
 * that bucket was where the residue lived: on the 60-file vue-core draw, 221 of the 258
 * disagreeing rows were in it. **A BUCKET NAMED "other" IS NOT A DISPOSITION** — it is the place
 * where a measurement stops looking, and a wall that is merely named is a failure. So three
 * buckets were added, each of which is a QUESTION WITH A YES/NO ANSWER, and each of which can be
 * wrong:
 *
 *   1 · **THE EDGE EXISTS, THE LABEL DIFFERS.** The two sides are matched LABEL-BLIND first: a
 *       truth row and an analyzer row that name the same ENDPOINT are the same edge even when the
 *     labels differ, and the bucket records the label pair (`truthLabel -> analyzerLabel`). This
 *     matters because the old per-side matching charged ONE disagreeing edge TWICE — once as
 *     MISSING (the truth's label) and once as UNEXPLAINED (the analyzer's label) — so the old
 *     "other" bucket was mostly a bookkeeping artefact of a same-label match rule, not 221
 *     separate mysteries.
 *   2 · **THE TARGET IS NOT DECLARED ANYWHERE IN THE PROJECT.** A name no file in the repository
 *     declares is a GLOBAL or a BUILTIN (`clearTimeout`, `window`, `console`). The oracles derive
 *     a `references` row to it; the analyzer does not publish a project reference to something the
 *     project does not declare. The bucket is computed from a whole-repo pass over the DECLARED
 *     names, so it is a fact about the population, not a guess about one file.
 *   3 · **THE TARGET IS A LOCAL BINDING.** The analyzer RE-SPELLS an edge whose target is a local
 *     binding (a parameter, a local variable, a catch binding, a loop binding) to the family
 *     spelling `<callable>\u0000<binding>` and marks it `metadata.localBinding`
 *     (`real-typescript-analyzer.ts:4772` `applyLocalBindingSpellings`). The predicate used here
 *     is THE ANALYZER's own (`collectLocalBindingNames`, `real-typescript-analyzer.ts:4710-4755`),
 *     re-implemented in the classifier — and that is stated rather than hidden: **this bucket
 *     exists to name the CONTRACT QUESTION, not to certify the analyzer's rule.** A bucket built
 *     on the analyzer's own predicate cannot decide whether the contract is right; it can only
 *     decide how many rows the contract question accounts for. The ORACLE is untouched by it, and
 *     the oracle is what the differential compares against.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-differential-classify.ts [--repo NAME] [--files 60] [--json out]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealTypeScriptAnalyzer } from "../../src/ast/real-typescript-analyzer"
import {
  deriveTreeEdges,
  deriveTypeScriptEdges,
  deriveTypeScriptRendersTruth,
  deriveTypeScriptDecoratorTruth,
  normTarget,
  auditTarget,
} from "./differential"
import { deriveTypeScriptReferencesTruth } from "./oracles/typescript-references"
import { deriveTypeScriptUsesTruth } from "./oracles/typescript-uses"
import { deriveTypeScriptContainsTruth } from "./oracles/typescript-contains"
import { deriveTypeScriptImportTruth, deriveTypeScriptExportTruth } from "./oracles/typescript-imports-truth"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const argv = process.argv.slice(2)
const argOf = (flag: string): string | null => {
  const eq = argv.find((a) => a.startsWith(`${flag}=`))
  if (eq !== undefined) return eq.slice(flag.length + 1)
  const i = argv.indexOf(flag)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}
const REPOS = argOf("--repo") ? [argOf("--repo")!] : ["vue-core", "element-plus"]
const NFILES = Number(argOf("--files") ?? 60)
const jsonOut = argOf("--json")

const parser = await ASTEngine.getParser("typescript" as any)

function filesOf(repo: string): string[] {
  const dir = path.join(CR, repo)
  const tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
  const files = tracked.filter((r) => r.endsWith(".ts")).map((r) => path.join(dir, r)).sort()
  if (files.length <= NFILES) return files
  const stride = Math.max(1, Math.floor(files.length / NFILES))
  const picked: string[] = []
  for (let i = 0; i < files.length && picked.length < NFILES; i += stride) picked.push(files[i]!)
  return picked
}

/** Names declared as TYPE PARAMETERS anywhere in the file (`<T>`, `<K extends X>`). */
function typeParameterNames(root: any): Set<string> {
  const out = new Set<string>()
  const walk = (n: any) => {
    if (!n) return
    if (n.type === "type_parameter") {
      const nm = n.childForFieldName("name") ?? n.namedChild(0)
      if (nm && nm.text) out.add(String(nm.text))
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  return out
}

/** Member names declared by class/interface/enum bodies in the file (declarations, not references). */
function memberNames(root: any): Set<string> {
  const out = new Set<string>()
  const memberTypes = new Set([
    "method_definition", "public_field_definition", "method_signature", "property_signature",
    "abstract_method_signature", "abstract_property_signature", "enum_assignment", "property_identifier",
  ])
  const walk = (n: any) => {
    if (!n) return
    if (memberTypes.has(n.type) && n.type !== "property_identifier") {
      const nm = n.childForFieldName("name") ?? n.childForFieldName("property") ?? n.namedChild(0)
      if (nm && (nm.type === "property_identifier" || nm.type === "identifier")) out.add(String(nm.text))
    }
    if (n.type === "enum_assignment") {
      const nm = n.childForFieldName("name")
      if (nm) out.add(String(nm.text))
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  return out
}


/**
 * THE PROJECT's DECLARED NAMES — a whole-repo pass, because "is this name declared anywhere in
 * the project?" is a question about the REPOSITORY and not about one file. A file-local answer
 * would call a sibling file's declaration "undeclared" and inflate the global bucket.
 */
function projectDeclaredNames(files: string[]): Set<string> {
  const out = new Set<string>()
  const declareNode = (n: any) => {
    if (!n) return
    const t = n.type
    if (
      t === "class_declaration" || t === "abstract_class_declaration" || t === "interface_declaration" ||
      t === "enum_declaration" || t === "type_alias_declaration" || t === "function_declaration" ||
      t === "function_signature" || t === "method_signature" || t === "method_definition" ||
      t === "generator_function_declaration" || t === "abstract_method_signature" ||
      t === "property_signature" || t === "public_field_definition" || t === "enum_assignment"
    ) {
      const nm = n.childForFieldName("name") ?? n.childForFieldName("property") ?? n.namedChild(0)
      if (nm && (nm.type === "identifier" || nm.type === "property_identifier")) out.add(String(nm.text))
    }
    if (t === "variable_declarator") {
      const nm = n.childForFieldName("name") ?? n.namedChild(0)
      if (nm && nm.type === "identifier") out.add(String(nm.text))
    }
    for (let i = 0; i < n.namedChildCount; i++) declareNode(n.namedChild(i))
  }
  for (const abs of files) {
    let content = ""
    try { content = fs.readFileSync(abs, "utf8") } catch { continue }
    let tree: any = null
    try { tree = parser.parse(content) } catch { continue }
    if (!tree) continue
    declareNode(tree.rootNode)
  }
  return out
}

/**
 * THE ANALYZER's OWN LOCAL-BINDING PREDICATE — re-implemented from
 * `real-typescript-analyzer.ts:4710-4755` (`collectLocalBindingNames`): a parameter, a local
 * variable, a nested declaration, a catch binding, a loop binding, or a shadowed name. The
 * classifier states plainly that it is the analyzer's predicate: the bucket's job is to SIZE the
 * contract question, not to adjudicate it.
 */
function localBindingNames(root: any): Set<string> {
  const out = new Set<string>()
  const bind = (nm: any) => { if (nm && nm.type === "identifier") out.add(String(nm.text)) }
  const walk = (n: any, insideFunction: boolean) => {
    if (!n) return
    const t = n.type
    let next = false
    if (t === "function_declaration" || t === "function_expression" || t === "generator_function" ||
        t === "arrow_function" || t === "method_definition") {
      if (insideFunction) {
        const nm = n.childForFieldName("name") ?? n.namedChild(0)
        if (nm && (nm.type === "identifier" || nm.type === "property_identifier")) bind(nm.type === "identifier" ? nm : null)
      }
      next = true
    } else if (t === "variable_declarator" && insideFunction) {
      bind(n.childForFieldName("name") ?? n.namedChild(0))
    } else if (t === "catch_clause") {
      bind(n.childForFieldName("parameter") ?? n.namedChild(0))
    } else if (t === "for_in_statement" && insideFunction) {
      const left = n.childForFieldName("left") ?? n.namedChild(0)
      if (left && left.type === "identifier") bind(left)
      else if (left) {
        for (let i = 0; i < left.namedChildCount; i++) {
          const c = left.namedChild(i)
          if (c && c.type === "variable_declarator") bind(c.childForFieldName("name") ?? c.namedChild(0))
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), next)
  }
  walk(root, false)
  return out
}

type Row = { label: string; from: string; target: string }
type Tally = { count: number; samples: string[] }
const missingBuckets = new Map<string, Tally>()
const unexplainedBuckets = new Map<string, Tally>()
const bump = (m: Map<string, Tally>, key: string, sample: string) => {
  let t = m.get(key)
  if (!t) m.set(key, (t = { count: 0, samples: [] }))
  t.count++
  if (t.samples.length < 4) t.samples.push(sample)
}
const breakdown: any[] = []

for (const repo of REPOS) {
  const files = filesOf(repo)
  // THE WHOLE-REPO PASS — the declared names of every file this instrument will look at, so the
  // "not declared in the project" bucket is a fact about the population and not about one file.
  const projectNames = projectDeclaredNames(files)
  let truthTotal = 0
  let covered = 0
  let missingTotal = 0
  let analyzerTotal = 0
  let unexplainedTotal = 0
  for (const abs of files) {
    const rel = abs.slice(CR.length + 1)
    const content = fs.readFileSync(abs, "utf8")
    const tree = parser.parse(content)
    if (tree === null) continue
    const root = tree.rootNode
    let result: any
    try {
      result = new RealTypeScriptAnalyzer().analyze(root, content, rel)
    } catch {
      continue
    }
    // THE DIFFERENTIAL'S TS TRUTH PUSH, line for line (differential.ts: typescript block).
    const truth: Row[] = [
      ...deriveTreeEdges(root, "typescript"),
      ...deriveTypeScriptContainsTruth(root),
      ...deriveTypeScriptReferencesTruth(root),
      ...deriveTypeScriptUsesTruth(root),
      ...deriveTypeScriptEdges(root),
      ...deriveTypeScriptRendersTruth(root),
      ...deriveTypeScriptDecoratorTruth(root),
      ...deriveTypeScriptImportTruth(root, rel),
      ...deriveTypeScriptExportTruth(root, rel),
    ].map((e: any) => ({ label: String(e.label), from: String(e.from ?? ""), target: String(e.target ?? "") }))
      .filter((t) => t.target.trim().length > 0)
    const rels = (result.relationships ?? []).map((r: any) => ({
      label: String(r.type ?? ""),
      from: String(r.source ?? ""),
      target: String(r.target ?? ""),
      confidence: typeof r.confidence === "number" ? r.confidence : 1,
    }))
    truthTotal += truth.length
    analyzerTotal += rels.length
    const typeParams = typeParameterNames(root)
    const members = memberNames(root)
    const locals = localBindingNames(root)
    for (const te of truth) {
      // THE DIFFERENTIAL'S OWN MATCH KEY, verbatim: `normTarget(auditTarget(t))` — the BINDING_SEP
      // strip on BOTH sides (differential.ts:25527, :25535). The classifier used the bare
      // `normTarget`, so a binding-spelled analyzer row never matched the truth's bare name, and
      // the row was charged as MISSING *and* its analyzer twin as UNEXPLAINED. MEASURED on the
      // 40-file/repo draw: 80 MISSING and 123 UNEXPLAINED rows were this instrument's gap.
      const hit = rels.some((r: any) => r.label === te.label && normTarget(auditTarget(r.target)) === normTarget(auditTarget(te.target)))
      if (hit) {
        covered++
        continue
      }
      missingTotal++
      const tn = normTarget(te.target)
      const bindingSeen = rels.some((r: any) => r.label === te.label && r.target.includes("\u0000") && String(r.target).slice(String(r.target).lastIndexOf("\u0000") + 1) === te.target)
      // THE LABEL-BLIND CROSS-MATCH: the same ENDPOINT under a DIFFERENT label is ONE disagreeing
      // edge, not two. The old per-side rule charged it twice, once MISSING and once UNEXPLAINED,
      // and the "other" bucket absorbed both charges.
      const otherLabel = rels.find((r: any) => r.label !== te.label &&
        normTarget(auditTarget(r.target)) === normTarget(auditTarget(te.target)))
      const importedTarget = rels.some((r: any) => r.label === "imports" &&
        normTarget(auditTarget(r.target)) === normTarget(auditTarget(te.target)))
      let bucket: string
      if (bindingSeen) bucket = `${te.label}: analyzer emitted it BINDING-SPELLED (truth derives the bare name)`
      else if (otherLabel) bucket = `${te.label}: THE EDGE EXISTS, THE LABEL DIFFERS (${te.label} -> ${otherLabel.label})`
      else if (importedTarget) bucket = `${te.label}: the analyzer routes this target to the \`imports\` label`
      else if (typeParams.has(tn)) bucket = `${te.label}: target is a FILE TYPE PARAMETER (a local binding, not a project reference)`
      else if (locals.has(tn)) bucket = `${te.label}: target is a LOCAL BINDING (the contract question: the analyzer re-spells it, the oracle publishes it)`
      else if (members.has(tn)) bucket = `${te.label}: target is a DECLARED MEMBER NAME (reached by contains, not a reference)`
      else if (!projectNames.has(tn)) bucket = `${te.label}: target is NOT DECLARED ANYWHERE IN THE PROJECT (a global or builtin the oracle over-derives)`
      else bucket = `${te.label}: other (sample for manual read)`
      bump(missingBuckets, bucket, `${te.from} -> ${te.target} @ ${rel}`)
    }
    for (const r of rels) {
      const hit = truth.some((te) => te.label === r.label && (
        normTarget(auditTarget(te.target)) === normTarget(auditTarget(r.target)) ||
        te.target.includes(normTarget(auditTarget(r.target)))
      ))
      if (hit) continue
      unexplainedTotal++
      const otherLabel = truth.find((te) => te.label !== r.label &&
        normTarget(auditTarget(te.target)) === normTarget(auditTarget(r.target)))
      const rn = normTarget(auditTarget(r.target))
      let bucket: string
      if (String(r.target).includes("\u0000")) bucket = `${r.label}: analyzer BINDING-SPELLED target (truth derives a bare name or nothing)`
      else if (otherLabel) bucket = `${r.label}: THE EDGE EXISTS, THE LABEL DIFFERS (${otherLabel.label} -> ${r.label})`
      else if (locals.has(rn)) bucket = `${r.label}: target is a LOCAL BINDING (the contract question: the analyzer re-spells it, the oracle publishes it)`
      else if (!projectNames.has(rn)) bucket = `${r.label}: target is NOT DECLARED ANYWHERE IN THE PROJECT (a global or builtin the analyzer does not publish a project reference to)`
      else bucket = `${r.label}: other (sample for manual read)`
      bump(unexplainedBuckets, bucket, `${r.from} -> ${String(r.target).replace(/\u0000/g, "\\0")} @ ${rel}`)
    }
  }
  const row = { repo, files: files.length, truthTotal, covered, missingTotal, analyzerTotal, unexplainedTotal }
  breakdown.push(row)
  console.log(`${repo}: files=${files.length} truth=${truthTotal} covered=${covered} (${((100 * covered) / (truthTotal || 1)).toFixed(1)}%) MISSING=${missingTotal} | analyzer=${analyzerTotal} unexplained=${unexplainedTotal} (${((100 * unexplainedTotal) / (analyzerTotal || 1)).toFixed(1)}%)`)
}

console.log(`\nPOPULATION: deterministic stride above, NOT the differential's rotating sample — these buckets classify the ROW CLASSES; the differential's own counts remain its measurement.`)
console.log(`\nMISSING — truth derives a row the analyzer did not emit:`)
for (const [k, t] of [...missingBuckets.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(t.count).padStart(5)}  ${k}`)
  for (const s of t.samples) console.log(`           e.g. ${s}`)
}
console.log(`\nUNEXPLAINED — analyzer emitted a row no truth derivation explains:`)
for (const [k, t] of [...unexplainedBuckets.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(t.count).padStart(5)}  ${k}`)
  for (const s of t.samples) console.log(`           e.g. ${s}`)
}
if (jsonOut) {
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        population: { repos: REPOS, filesPerRepo: NFILES, method: "deterministic stride; differential rule imported (deriveTreeEdges/deriveTypeScriptEdges/oracles/normTarget)" },
        lanes: breakdown,
        missing: Object.fromEntries([...missingBuckets.entries()].map(([k, t]) => [k, t])),
        unexplained: Object.fromEntries([...unexplainedBuckets.entries()].map(([k, t]) => [k, t])),
      },
      null,
      2,
    ),
  )
}
