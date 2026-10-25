#!/usr/bin/env bun
/**
 * script/m14/kotlin-extended-types-census.ts — THE FOUR EXTENDED TYPES' CONSTRUCT CENSUS, WHOLE
 * ADMITTED POPULATION, because a ruling is a count and not prose.
 *
 * Modeled on script/m14/java-extended-types-census.ts (the fleet's model for this measurement),
 * with kotlin's own constructs, kotlin's own falsifiers, and kotlin's own near misses.
 *
 * WHAT THIS MEASURES, per admitted `.kt`/`.kts` file, through the tree-sitter tree of the bytes the
 * RESOLVER serves (never a path and never the engine's log — fleet §6):
 *
 *   decorates      annotation application sites, by annotation node kind (`annotation` /
 *                  `file_annotation`), by the annotation's NAME (qualified and simple), by the
 *                  declaration the annotation is applied to. THE FALSIFIER IS COUNTED IN KOTLIN'S
 *                  OWN FORM, NOT JAVA'S: java measured 0 call-shaped nodes inside annotation
 *                  arguments (JLS 9.7.1 constant expressions); kotlin ALLOWS other annotation
 *                  instances as annotation arguments (KLS: annotation constructor parameters take
 *                  compile-time constants, other annotations, and arrays), so a `ReplaceWith("…")`
 *                  inside `@Deprecated(…)` parses as a call_expression — and the census must count
 *                  those call-shaped arguments BY CALLEE NAME to show every one is a nested
 *                  ANNOTATION CONSTRUCTOR (passive metadata one level down), never a runtime
 *                  callable applied to the declaration. Lambdas in annotation arguments are counted
 *                  separately and expected 0 (a lambda is not a constant expression).
 *   renders        the Compose marker: `@Composable`-named annotations on functions, counted by a
 *                  tree test (the annotation's LAST type_identifier — the simple name — equals
 *                  "Composable" by string equality, no regex), plus `androidx.compose.` imports
 *                  (an import_header whose identifier text starts with "androidx.compose.",
 *                  indexOf === 0), plus the grammar's own named-type scan for a render/component
 *                  family. The DSL's SHAPE probe (annotation → function_declaration → body
 *                  call_expression) is recorded in the lane's probe notes: it survives the grammar
 *                  as real nodes; this census counts whether the corpus ever exercises it.
 *   mixes_in       the `by` delegation family the contract question is about: `explicit_delegation`
 *                  (a class supertype clause `: T by expr`) and `property_delegate` (a property
 *                  `by` clause). THE CONTRACT TEST IS MEASURED FROM THE TREE: a mixes_in candidate
 *                  must compose behaviour WITHOUT declaring conformance (src/ast/types.ts:156-162),
 *                  and every `explicit_delegation` sits under `delegation_specifier` in the class's
 *                  SUPERTYPE CLAUSE — the position where conformance IS declared — which the census
 *                  proves by tallying the parent chain of every explicit_delegation site. The
 *                  interface-default-method near miss (the java lane's) is counted too: interface
 *                  members with bodies, which are `implements` (conformance declared) by the same
 *                  fleet rule.
 *   part_of        the grammar's own named-type scan for a part/inclusion-directive family (0
 *                  expected on the served 152-name inventory), with the near misses COUNTED, not
 *                  asserted: `import_header` (names a module and CREATES binding scope — the
 *                  opposite of a part, which shares a scope and imports nothing), and the Gradle
 *                  build-script near misses that only exist in `.kts`: `include(...)` and
 *                  `apply(from = ...)` call sites, counted by a tree test (call_expression whose
 *                  callee simple_identifier text equals "include"/"apply" — string equality), split
 *                  by file extension, because `include` is NOT a kotlin grammar production (it
 *                  parses as a plain call_expression) and a Gradle project-inclusion is a
 *                  build-configuration fact, not a compile-unit inclusion of source.
 *
 * THE POPULATION IS THE FLEET'S, NOT A LIST. Discovery is the fleet's admission rule: every
 * top-level `.corpus` entry that is a git work tree, its `git ls-files` trackage, extensions
 * `.kt`/`.kts`, the 1 MiB cap. A file that is tracked but absent on disk and a file over the cap
 * are COUNTED, never silently dropped. `--cap=<N>` is the triage stride; `--cap=0` (the default)
 * is the whole admitted population; `--offset=N --cap=<N>` is a disjoint slice (the fleet's chunk
 * mode; the flag's PRESENCE is the mode, so `--offset=0` is a slice and never a fall-through).
 *
 * AN ANALYZER MUST NEVER HANG, AND A CENSUS MUST NOT LOOK LIKE A PREFIX. `tree.delete()` runs for
 * every file (the tenth form: a walker without it dies around 7,600 parses and prints a
 * complete-looking table over a third of the population), and the run EXITS NON-ZERO when
 * parsed !== the window's file count: a count of failures is not enough if the exit code stays 0.
 *
 * NO REGEX IN ANY RESOLUTION — this lane's own convention is stricter than the fleet's (see
 * script/m14/kotlin-census.ts and validation/m14/kotlin/kotlin-corpus.ts): every test here is a
 * node-type test, a node-text string comparison, or indexOf — including the grammar family scans,
 * which the java instrument runs with regexes and this one runs with indexOf so the two artifacts
 * can be compared rule-for-rule.
 *
 * OUTPUT (with --json): validation/m14/measurements/kotlin-extended-types-census.json
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/kotlin-extended-types-census.ts --cap=0 --json
 *   bun run script/m14/kotlin-extended-types-census.ts --cap=400            # triage
 *
 * EXIT: 0 measured · 2 environment (no corpus / no files) · 3 population mismatch (parsed != window)
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024 // mirror of pool-worker's FULL_AST_LIMIT — the same line the analyzer draws
const EXTS = ["kt", "kts"]
const OUT_JSON = path.join(ROOT, "validation/m14/measurements/kotlin-extended-types-census.json")

const CAP = (() => {
  const hit = process.argv.find((a) => a.startsWith("--cap="))
  return hit ? Number(hit.slice(6)) : 0
})()
const OFFSET = (() => {
  const hit = process.argv.find((a) => a.startsWith("--offset="))
  return hit ? Number(hit.slice("--offset=".length)) : 0
})()
const JSON_OUT = process.argv.includes("--json")

type Tally = { sites: number; files: Set<string> }
const mk = (): Tally => ({ sites: 0, files: new Set() })
const add = (m: Map<string, Tally>, key: string, file: string): void => {
  let t = m.get(key)
  if (!t) {
    t = mk()
    m.set(key, t)
  }
  t.sites++
  t.files.add(file)
}
const plain = (m: Map<string, Tally>): Record<string, { sites: number; files: number }> => {
  const out: Record<string, { sites: number; files: number }> = {}
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1].sites - a[1].sites)) out[k] = { sites: v.sites, files: v.files.size }
  return out
}

/** The fleet's admission rule, copied from script/m14/java-extended-types-census.ts. */
function admitByExtension(rel: string): boolean {
  const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
  const dot = base.lastIndexOf(".")
  const ext = dot >= 0 ? base.slice(dot + 1) : ""
  return EXTS.includes(ext)
}

interface Discovery {
  files: string[]
  admitted: number
  tracked: number
  repos: number
  absent: number
  overCap: number
  sliceStart: number
  sliceEnd: number
}

function discover(): Discovery {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let tracked = 0
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], admitted: 0, tracked: 0, repos: 0, absent: 0, overCap: 0, sliceStart: 0, sliceEnd: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let list: string[]
    try {
      list = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of list) {
      if (!admitByExtension(rel)) continue
      tracked++
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) {
          overCap++
          continue
        }
      } catch {
        absent++
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const admitted = found.length
  // ★ `--offset`'s PRESENCE IS THE MODE, not its value: `--offset=0` must be a SLICE (the Lead's
  // measured defect — a fall-through at 0 made chunk 0 overlap the slice chunks).
  const hasOffset = process.argv.some((a) => a.startsWith("--offset="))
  let files = found
  let sliceStart = 0
  let sliceEnd = admitted
  if (hasOffset) {
    sliceStart = Math.min(OFFSET, admitted)
    sliceEnd = Math.min(sliceStart + (CAP > 0 ? CAP : admitted), admitted)
    files = found.slice(sliceStart, sliceEnd)
  } else if (CAP > 0 && admitted > CAP) {
    const stride = Math.max(1, Math.floor(admitted / CAP))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < CAP; i += stride) picked.push(found[i])
    files = picked
    sliceStart = -1
    sliceEnd = files.length
  }
  return { files, admitted, tracked, repos: repos.size, absent, overCap, sliceStart, sliceEnd }
}

// ── the grammar: the SERVED bytes, read from the resolver, hashed ──────────────────────────────
async function loadServed(): Promise<{
  wasmPath: string
  sha256: string
  parser: any
  namedTypes: string[]
}> {
  const { resolveWasmAsset } = await import("../../src/util/wasm")
  const wasmPath = resolveWasmAsset("tree-sitter-kotlin.wasm")
  const bytes = readFileSync(wasmPath)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  await ParserClass.init()
  const Language = wts.Language ?? wts.default?.Language
  const grammar = await Language.load(bytes)
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const namedTypes: string[] = []
  for (let i = 0; i < grammar.nodeTypeCount; i++) {
    if (!grammar.nodeTypeIsNamed(i)) continue
    namedTypes.push(String(grammar.nodeTypeForId(i) ?? ""))
  }
  return { wasmPath, sha256, parser, namedTypes }
}

/** THE FAMILY SCAN, with indexOf (this lane's no-regex convention) — each hit names its needle. */
const FAMILY_SCAN: Array<{ family: string; needles: string[] }> = [
  { family: "decorator", needles: ["decorat"] },
  { family: "mixin", needles: ["mixin"] },
  { family: "part-directive", needles: ["part", "include"] },
  { family: "render/component", needles: ["render", "component", "widget", "composable", "jsx"] },
  { family: "delegation", needles: ["delegat"] },
  { family: "annotation", needles: ["annotat"] },
]
const scan = (names: string[], needles: string[]): string[] =>
  [...new Set(names)].filter((n) => needles.some((nd) => n.toLowerCase().indexOf(nd) >= 0)).sort()

/** The annotation's NAME: the user_type under the annotation (or under its constructor_invocation).
 *  Returns { qualified, simple } — simple is the LAST type_identifier segment. */
function annotationName(n: any): { qualified: string; simple: string } {
  const findUserType = (x: any): any => {
    if (!x) return null
    if (x.type === "user_type") return x
    for (let i = 0; i < x.namedChildCount; i++) {
      const c = x.namedChild(i)
      const r = c ? findUserType(c) : null
      if (r) return r
    }
    return null
  }
  let ut: any = null
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c) continue
    if (c.type === "user_type") {
      ut = c
      break
    }
    if (c.type === "constructor_invocation") {
      ut = findUserType(c)
      if (ut) break
    }
  }
  if (!ut) return { qualified: "(no user_type)", simple: "(no user_type)" }
  const lastTid = (x: any): string => {
    let last = ""
    const walkT = (y: any) => {
      if (y.type === "type_identifier") last = String(y.text ?? "")
      for (let i = 0; i < y.namedChildCount; i++) {
        const c = y.namedChild(i)
        if (c) walkT(c)
      }
    }
    walkT(x)
    return last
  }
  return { qualified: String(ut.text ?? ""), simple: lastTid(ut) }
}

/** Does a node subtree contain a `value_arguments` child at the top level we can walk? */
function* walkNamed(root: any): Generator<any> {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    yield n
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

async function main(): Promise<void> {
  const d = discover()
  if (d.files.length === 0) {
    console.error(`kotlin-extended-types-census: 0 admitted .kt/.kts files under ${CR}. Set BB_CORPUS_ROOT.`)
    process.exit(2)
  }
  const g = await loadServed()
  console.log(`kotlin-extended-types-census: admitted=${d.admitted} tracked=${d.tracked} repos=${d.repos} absent=${d.absent} overCap=${d.overCap}`)
  console.log(`  grammar: ${g.wasmPath} sha256=${g.sha256} namedIds=${g.namedTypes.length} unique=${new Set(g.namedTypes).size}`)
  console.log(`  scan: measurement window [${d.sliceStart}, ${d.sliceEnd}) of ${d.admitted} admitted file(s)`)

  const familyHits: Record<string, string[]> = {}
  for (const f of FAMILY_SCAN) familyHits[f.family] = scan(g.namedTypes, f.needles)

  // ── the counters ──────────────────────────────────────────────────────────────────────────────
  const annByNode = new Map<string, Tally>()
  const annBySimpleName = new Map<string, Tally>()
  const annByQualifiedSample = new Map<string, Tally>()
  const annAppliedTo = new Map<string, Tally>()
  const annArgNode = new Map<string, Tally>()
  const annArgCallCallee = new Map<string, Tally>()
  const composableAnn = new Map<string, Tally>()
  const composeImports = new Map<string, Tally>()
  const delegByNode = new Map<string, Tally>()
  const delegParentChain = new Map<string, Tally>()
  const propDelegParent = new Map<string, Tally>()
  const ifaceFun = new Map<string, Tally>()
  const counter = new Map<string, Tally>()
  const gradleInclude = new Map<string, Tally>()
  const gradleApply = new Map<string, Tally>()
  const gradleApplyFrom = new Map<string, Tally>()
  let parsed = 0
  let failed = 0
  const filesFailed: string[] = []

  for (const abs of d.files) {
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      failed++
      filesFailed.push(path.relative(CR, abs))
      continue
    }
    const rel = path.relative(CR, abs)
    const isKts = rel.slice(rel.lastIndexOf(".") + 1) === "kts"
    let tree: any
    try {
      tree = g.parser.parse(text)
    } catch {
      failed++
      filesFailed.push(rel)
      continue
    }
    if (!tree || !tree.rootNode) {
      failed++
      filesFailed.push(rel)
      continue
    }
    parsed++
    try {
      for (const n of walkNamed(tree.rootNode)) {
        const t: string = n.type
        switch (t) {
          case "annotation":
          case "file_annotation": {
            add(annByNode, t, rel)
            const name = annotationName(n)
            add(annBySimpleName, name.simple, rel)
            if (annByQualifiedSample.size < 4000) add(annByQualifiedSample, name.qualified, rel)
            // the declaration the annotation is applied to: climb out of modifiers/annotation lists
            let p = n.parent
            while (p && (p.type === "modifiers" || p.type === "annotation" || p.type === "file_annotation")) p = p.parent
            add(annAppliedTo, p ? p.type : "(none)", rel)
            if (name.simple === "Composable") add(composableAnn, "Composable-named annotation", rel)
            // THE FALSIFIER, in kotlin's own form: what the annotation's value_arguments contain
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (!c || c.type !== "constructor_invocation") continue
              for (let j = 0; j < c.namedChildCount; j++) {
                const va = c.namedChild(j)
                if (!va || va.type !== "value_arguments") continue
                for (const x of walkNamed(va)) {
                  add(annArgNode, x.type, rel)
                  if (x.type === "call_expression") {
                    const callee = x.namedChild(0)
                    add(annArgCallCallee, callee ? String(callee.text ?? "?") : "(no callee)", rel)
                  }
                }
              }
            }
            break
          }
          case "explicit_delegation": {
            add(delegByNode, t, rel)
            // THE CONTRACT TEST, from the tree: the chain above a `by` supertype proves it sits in
            // the supertype clause — the position where conformance IS declared.
            const ds = n.parent
            const gp = ds ? ds.parent : null
            const ggp = gp ? gp.parent : null
            add(delegParentChain, `${ds?.type ?? "?"} > ${gp?.type ?? "?"} > ${ggp?.type ?? "?"}`, rel)
            break
          }
          case "property_delegate": {
            add(delegByNode, t, rel)
            add(propDelegParent, n.parent ? n.parent.type : "(none)", rel)
            break
          }
          case "constructor_delegation_call":
          case "delegation_specifier":
            add(delegByNode, t, rel)
            break
          case "class_declaration": {
            // ★ kotlin's interfaces are class_declaration with an ANONYMOUS `interface` token as
            // the FIRST child — there is no interface_declaration node type (probe-measured; a
            // counter keyed on the nonexistent node would print a clean zero over nothing, the
            // fleet's first form). The java-lane near miss counts interface members with bodies:
            // default methods are `implements` (conformance IS declared when a class names the
            // interface), not a mixin.
            let isInterface = false
            for (let i = 0; i < n.childCount; i++) {
              const c = n.child(i)
              if (c && c.type === "interface") {
                isInterface = true
                break
              }
            }
            if (!isInterface) break
            add(counter, "interface (class_declaration + interface token)", rel)
            for (let i = 0; i < n.namedChildCount; i++) {
              const b = n.namedChild(i)
              if (!b || b.type !== "class_body") continue
              for (let j = 0; j < b.namedChildCount; j++) {
                const m = b.namedChild(j)
                if (!m || m.type !== "function_declaration") continue
                let hasBody = false
                for (let k = 0; k < m.namedChildCount; k++) {
                  const c = m.namedChild(k)
                  if (c && c.type === "function_body") {
                    hasBody = true
                    break
                  }
                }
                add(ifaceFun, hasBody ? "with-body (default)" : "abstract (no body)", rel)
              }
            }
            break
          }
          case "import_header": {
            add(counter, "import_header", rel)
            // renders: does the corpus import androidx.compose at all? (indexOf === 0, no regex)
            const ident = n.namedChild(0)
            const identText = ident ? String(ident.text ?? "") : ""
            if (identText.indexOf("androidx.compose.") === 0) add(composeImports, identText, rel)
            break
          }
          case "call_expression": {
            // part_of near miss, in the .kts build-script dialect only: `include(...)` and
            // `apply(from = ...)` are GRADLE configuration calls, not kotlin productions — and a
            // Gradle project-inclusion is a build fact, not a compile-unit inclusion of source.
            if (!isKts) break
            const callee = n.namedChild(0)
            if (!callee || callee.type !== "simple_identifier") break
            const calleeText = String(callee.text ?? "")
            if (calleeText === "include") {
              add(gradleInclude, rel, rel)
              add(gradleInclude, "(total)", rel)
            } else if (calleeText === "apply") {
              add(gradleApply, "(total)", rel)
              // apply(from = "..."): a value_argument whose first named child is `from`
              let hasFrom = false
              for (const x of walkNamed(n)) {
                if (x.type !== "value_argument") continue
                const first = x.namedChild(0)
                if (first && first.type === "simple_identifier" && String(first.text ?? "") === "from") {
                  hasFrom = true
                  break
                }
              }
              if (hasFrom) add(gradleApplyFrom, "apply(from = …)", rel)
            }
            break
          }
          default:
            break
        }
      }
    } finally {
      // ★ THE TENTH FORM: a walker that does not free its trees dies around 7,600 parses and keeps
      // printing a population header over a fraction of it.
      tree.delete?.()
    }
    if (parsed % 500 === 0) console.log(`  progress: parsed ${parsed}/${d.files.length}`)
  }

  if (parsed !== d.files.length) {
    console.error(`POPULATION MISMATCH: parsed ${parsed} != window ${d.files.length} (failed ${failed})`)
    process.exit(3)
  }

  // ── the falsifiers, reduced ────────────────────────────────────────────────────────────────
  const annSitesTotal = [...annByNode.values()].reduce((a, v) => a + v.sites, 0)
  const argNodesTotal = [...annArgNode.values()].reduce((a, v) => a + v.sites, 0)
  const argCallsTotal = [...annArgCallCallee.values()].reduce((a, v) => a + v.sites, 0)
  const argLambdas =
    (annArgNode.get("lambda_literal")?.sites ?? 0) + (annArgNode.get("annotated_lambda")?.sites ?? 0)
  const argAnonObjects = annArgNode.get("object_literal")?.sites ?? 0
  const bySupertypeSites = delegByNode.get("explicit_delegation")?.sites ?? 0
  const byPropertySites = delegByNode.get("property_delegate")?.sites ?? 0

  const payload = {
    generated: new Date().toISOString(),
    instrument: "script/m14/kotlin-extended-types-census.ts",
    rule: "git-tracked ∧ present ∧ ≤1 MiB, extensions kt/kts, tree-sitter tree of the SERVED grammar; parsed must equal the window's file count or the run exits 3; family scans run with indexOf (this lane's no-regex convention), not regex",
    population: {
      admitted: d.admitted,
      tracked: d.tracked,
      repos: d.repos,
      absentFromDisk: d.absent,
      overCap: d.overCap,
      window: [d.sliceStart, d.sliceEnd],
      windowFiles: d.files.length,
      parsed,
      failed,
      populationString: `parsed=${parsed}/${d.files.length} admitted=${d.admitted} exts=kt,kts index=no`,
      wholePopulation: d.files.length === d.admitted,
    },
    grammar: {
      resolvedBy: "src/util/wasm.resolveWasmAsset('tree-sitter-kotlin.wasm')",
      wasmPath: g.wasmPath,
      sha256: g.sha256,
      namedTypeIds: g.namedTypes.length,
      uniqueNamedTypes: new Set(g.namedTypes).size,
      universalPair: ["ERROR", "MISSING"].every((u) => g.namedTypes.indexOf(u) >= 0)
        ? "ERROR and MISSING are among the named ids (the fleet §2 pair is inside namedTypeIds)"
        : "ERROR/MISSING not found among named ids — check before applying the fleet counting rule",
      candidateFamilies: familyHits,
    },
    decorates: {
      annotationSites: plain(annByNode),
      annotationSitesTotal: annSitesTotal,
      annotationSimpleNames: Object.entries(plain(annBySimpleName)).slice(0, 30),
      annotatedDeclarationKinds: plain(annAppliedTo),
      annotationArgumentNodeTypes: plain(annArgNode),
      annotationArgumentNodesTotal: argNodesTotal,
      falsifierKotlinForm: {
        note: "kotlin ALLOWS annotation instances as annotation arguments (java measured 0 call-shaped nodes under JLS 9.7.1; kotlin's ReplaceWith inside @Deprecated parses as a call_expression), so the falsifier is counted BY CALLEE NAME: every call-shaped annotation argument must be a nested ANNOTATION CONSTRUCTOR (passive metadata one level down), never a runtime callable applied to the declaration",
        callShapedAnnotationArguments: argCallsTotal,
        callShapedArgumentCalleeNames: plain(annArgCallCallee),
        lambdasInAnnotationArguments: argLambdas,
        anonymousObjectsInAnnotationArguments: argAnonObjects,
      },
      grammarFamilyHits: familyHits["annotation"],
    },
    renders: {
      composableAnnotationSites: plain(composableAnn),
      androidxComposeImports: plain(composeImports),
      androidxComposeImportSites: [...composeImports.values()].reduce((a, v) => a + v.sites, 0),
      shapeProbeNote:
        "the Compose DSL survives the grammar as real nodes — annotation[Composable] under modifiers > function_declaration, with the body's Text(...) as call_expression — probe-measured on synthetic source (this lane, 2026-10-25); this census counts whether the CORPUS exercises it",
      grammarFamilyHits: familyHits["render/component"],
    },
    mixes_in: {
      delegationFamilySites: plain(delegByNode),
      bySupertypeSites,
      byPropertySites,
      contractTest: {
        note: "a mixes_in candidate must compose behaviour WITHOUT declaring conformance (src/ast/types.ts:156-162); the census proves from the tree that EVERY explicit_delegation sits under delegation_specifier in the class's SUPERTYPE CLAUSE — the position where conformance IS declared (the class statically conforms to the delegated interface) — and a property_delegate has no supertype chain at all (the contract's subject is a class-supertype fact)",
        explicitDelegationParentChains: plain(delegParentChain),
        propertyDelegateParentKinds: plain(propDelegParent),
      },
      interfaceNearMiss: {
        note: "the java lane's near miss, counted for kotlin: interface members with bodies are default methods — conformance IS declared when a class names the interface, so they are `implements` under the fleet rule, not a mixin",
        interfaceMembers: plain(ifaceFun),
      },
      grammarFamilyHits: familyHits["mixin"],
    },
    part_of: {
      grammarFamilyHits: familyHits["part-directive"],
      importHeaderSites: counter.get("import_header")?.sites ?? 0,
      gradleNearMiss: {
        note: "`include` is NOT a kotlin grammar production (it parses as a plain call_expression) and a Gradle project-inclusion is a BUILD-CONFIGURATION fact, not a compile-unit inclusion of source; counted in .kts files only, by callee-name string equality",
        includeCallSites: gradleInclude.get("(total)")?.sites ?? 0,
        includeCallFiles: gradleInclude.get("(total)")?.files.size ?? 0,
        applyCallSites: gradleApply.get("(total)")?.sites ?? 0,
        applyFromSites: gradleApplyFrom.get("apply(from = …)")?.sites ?? 0,
        applyFromFiles: gradleApplyFrom.get("apply(from = …)")?.files.size ?? 0,
      },
      interfaceSites: counter.get("interface (class_declaration + interface token)")?.sites ?? 0,
    },
    filesFailed,
  }
  if (JSON_OUT) {
    writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + "\n")
    console.log(`wrote ${path.relative(ROOT, OUT_JSON)}`)
  }

  // ── the console report ──────────────────────────────────────────────────────────────────────
  console.log(`\nDECORATES — annotation family (grammar: ${familyHits["annotation"].join(", ")})`)
  console.log(`  annotation sites ${annSitesTotal} (annotation ${(annByNode.get("annotation")?.sites ?? 0)} / file_annotation ${(annByNode.get("file_annotation")?.sites ?? 0)})`)
  console.log(`  annotation-argument nodes ${argNodesTotal}: call-shaped ${argCallsTotal}, lambdas ${argLambdas}, anonymous objects ${argAnonObjects}`)
  console.log(`  call-shaped argument CALLEE NAMES: ${[...annArgCallCallee.entries()].map(([k, v]) => `${k}=${v.sites}`).join(", ") || "(none)"}`)
  console.log(`\nRENDERS — Composable: ${composableAnn.get("Composable-named annotation")?.sites ?? 0} sites in ${composableAnn.get("Composable-named annotation")?.files.size ?? 0} files; androidx.compose imports ${[...composeImports.values()].reduce((a, v) => a + v.sites, 0)}`)
  console.log(`MIXES_IN — explicit_delegation ${bySupertypeSites}, property_delegate ${byPropertySites}`)
  console.log(`  explicit_delegation parent chains: ${[...delegParentChain.entries()].map(([k, v]) => `${k}=${v.sites}`).join(", ")}`)
  console.log(`PART_OF — grammar part-directive family: ${familyHits["part-directive"].join(", ") || "(none)"}; import_header ${counter.get("import_header")?.sites ?? 0}`)
  console.log(`  gradle near miss (.kts only): include() ${gradleInclude.get("(total)")?.sites ?? 0}, apply() ${gradleApply.get("(total)")?.sites ?? 0}, apply(from=) ${gradleApplyFrom.get("apply(from = …)")?.sites ?? 0}`)
  console.log(`\npopulation: ${payload.population.populationString}${payload.population.wholePopulation ? " (WHOLE POPULATION)" : " (SAMPLE — the stride is not the population)"}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
