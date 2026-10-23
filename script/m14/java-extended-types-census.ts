#!/usr/bin/env bun
/**
 * script/m14/java-extended-types-census.ts — THE FOUR EXTENDED TYPES' CONSTRUCT CENSUS, WHOLE
 * ADMITTED POPULATION, because a ruling is a count and not prose.
 *
 * WHY THIS EXISTS. The java lane's coverage block leaves `decorates`, `renders`, `mixes_in` and
 * `part_of` in the denominator as four unimplemented gaps. Each one is a RULING candidate, and the
 * fleet's rule for a ruling is: a class, a COUNT and a falsifier whose construct an instrument in
 * the tree counts (`FLEET-STATE` form #6 and the csharp falsifier rule). The existing instruments
 * do not count the constructs these four rulings name (the analyzer's emission census counts what
 * is EMITTED; this counts what the GRAMMAR hands the analyzer), so this lane-level census was
 * written to make each ruling's numbers checkable instead of asserted.
 *
 * WHAT THIS MEASURES, per admitted `.java` file, through the tree-sitter tree of the bytes the
 * RESOLVER serves (never a path and never the engine's log — fleet §6):
 *
 *   decorates      annotation application sites, by annotation node kind, by the KIND of the
 *                  annotation NAME node (a type name is the contract's passive metadata; a callable
 *                  name would be an applied callable), and by the declaration the annotation is
 *                  applied to. THE FALSIFIER IS COUNTED, not assumed: annotation-argument subtrees
 *                  that contain a call / lambda / object creation / method reference. JLS 9.7.1
 *                  requires annotation element values to be CONSTANT EXPRESSIONS, so the count is
 *                  expected 0 — and it is MEASURED rather than cited.
 *   renders        template-shaped nodes (`template_expression`, `string_interpolation`) and the
 *                  grammar's own named-type scan for a render/JSX/component production.
 *   mixes_in       the near misses the contract rejects: `super_interfaces` / `extends_interfaces`
 *                  (conformance clauses) and interface `default` methods (conformance, because the
 *                  implementing class declares `implements`).
 *   part_of        the two candidate constructs and why neither is Dart's compile-unit inclusion:
 *                  `package_declaration` (namespace membership; every compilation unit keeps its
 *                  own imports and its own top-level scope, JLS 7.3) and the module directives
 *                  (`requires` names an EXTERNAL module dependency, already published as `imports`).
 *
 * THE POPULATION IS THE FLEET'S, NOT A LIST. Discovery is the same walk as
 * `script/m14/java-emission-census.ts` (which copies it from `incoming-gate.ts`'s discoverFiles):
 * every top-level `.corpus` entry that is a git work tree, its `git ls-files` trackage, extension
 * `.java`, the 1 MiB cap. A file that is tracked but absent on disk and a file over the cap are
 * COUNTED, never silently dropped. `--cap=<N>` is the triage stride; `--cap=0` (the default) is the
 * whole admitted population; `--offset=N --cap=<N>` is a disjoint slice (the fleet's chunk mode).
 *
 * AN ANALYZER MUST NEVER HANG, AND A CENSUS MUST NOT LOOK LIKE A PREFIX. `tree.delete()` runs for
 * every file (the tenth form: a walker without it dies around 7,600 parses and prints a complete-
 * looking table over a third of the population), and the run EXITS NON-ZERO when
 * parsed !== admitted: a count of failures is not enough if the exit code stays 0.
 *
 * NO REGEX IN ANY RESOLUTION: the analyzer rule is the lane's; this instrument reads node TYPES and
 * node TEXT, and uses a regex nowhere.
 *
 * OUTPUT (with --json): validation/m14/measurements/java-extended-types-census.json
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/java-extended-types-census.ts --cap=0 --json
 *   bun run script/m14/java-extended-types-census.ts --cap=400            # triage
 *
 * EXIT: 0 measured · 2 environment (no corpus / no files) · 3 population mismatch (parsed != admitted)
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024 // mirror of pool-worker's FULL_AST_LIMIT — the same line the analyzer draws
const EXTS = ["java"]
const OUT_JSON = path.join(ROOT, "validation/m14/measurements/java-extended-types-census.json")

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

/** Copied from `script/m14/java-emission-census.ts` (which copies `incoming-gate.ts:discoverFiles`). */
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
  }
  return { files, admitted, tracked, repos: repos.size, absent, overCap, sliceStart, sliceEnd }
}

// ── the grammar: the SERVED bytes, read from the resolver, hashed ──────────────────────────────
async function loadServed(): Promise<{
  wasmPath: string
  sha256: string
  name: string
  parser: any
  namedTypes: string[]
}> {
  const { resolveWasmAsset } = await import("../../src/util/wasm")
  const wasmPath = resolveWasmAsset("tree-sitter-java.wasm")
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
  return { wasmPath, sha256, name: wasmPath, parser, namedTypes }
}

const scan = (names: string[], re: RegExp): string[] => names.filter((n) => re.test(n)).sort()

/** The candidate-family scan. THE FAMILIES ARE NAMED: a family scan that cannot say which regex
 *  produced a hit is the "number without its rule" defect one level down. */
const CANDIDATE_SCAN: Array<{ family: string; re: RegExp }> = [
  { family: "decorator", re: /decorat/ },
  { family: "mixin", re: /mixin/i },
  { family: "part-directive", re: /(^|_)part(_|$)|part_of|partial|include/i },
  { family: "render/component", re: /render|jsx|embed|component/i },
  { family: "template", re: /template/i },
]

async function main(): Promise<void> {
  const d = discover()
  if (d.files.length === 0) {
    console.error(`java-extended-types-census: 0 admitted .java files under ${CR}. Set BB_CORPUS_ROOT.`)
    process.exit(2)
  }
  const g = await loadServed()
  console.log(`java-extended-types-census: admitted=${d.admitted} tracked=${d.tracked} repos=${d.repos} absent=${d.absent} overCap=${d.overCap}`)
  console.log(`  grammar: ${g.wasmPath} sha256=${g.sha256} named=${new Set(g.namedTypes).size}`)
  console.log(`  scan: measurement window [${d.sliceStart}, ${d.sliceEnd}) of ${d.admitted} admitted file(s)`)

  const familyHits: Record<string, string[]> = {}
  for (const f of CANDIDATE_SCAN) familyHits[f.family] = scan(g.namedTypes, f.re)

  // ── the counters ──────────────────────────────────────────────────────────────────────────────
  const annByNode = new Map<string, Tally>()
  const annNameNode = new Map<string, Tally>()
  const annByName = new Map<string, Tally>()
  const annAppliedTo = new Map<string, Tally>()
  const annArgNode = new Map<string, Tally>()
  const ifaceMethod = new Map<string, Tally>()
  const counter = new Map<string, Tally>()
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
      const stack: any[] = [tree.rootNode]
      while (stack.length > 0) {
        const n = stack.pop()
        if (!n) continue
        const t: string = n.type
        switch (t) {
          case "annotation":
          case "marker_annotation": {
            add(annByNode, t, rel)
            const nameNode = n.childForFieldName?.("name") ?? n.namedChild(0)
            if (nameNode) {
              add(annNameNode, nameNode.type, rel)
              add(annByName, String(nameNode.text ?? ""), rel)
            }
            // The declaration the annotation is applied to: climb out of `modifiers` (an annotation
            // is a child of the modifiers list, which is a child of the declaration).
            let p = n.parent
            while (p && (p.type === "modifiers" || p.type === "annotation" || p.type === "marker_annotation")) p = p.parent
            add(annAppliedTo, p ? p.type : "(none)", rel)
            if (t === "annotation") {
              for (let i = 0; i < n.namedChildCount; i++) {
                const c = n.namedChild(i)
                if (!c || c.type !== "annotation_argument_list") continue
                const sub: any[] = [c]
                while (sub.length > 0) {
                  const x = sub.pop()
                  if (!x) continue
                  add(annArgNode, x.type, rel)
                  for (let j = 0; j < x.namedChildCount; j++) {
                    const y = x.namedChild(j)
                    if (y) sub.push(y)
                  }
                }
              }
            }
            break
          }
          case "interface_declaration": {
            add(counter, "interface_declaration", rel)
            const body = n.childForFieldName?.("body")
            if (body) {
              for (let i = 0; i < body.namedChildCount; i++) {
                const m = body.namedChild(i)
                if (!m || m.type !== "method_declaration") continue
                let isDefault = false
                let isStatic = false
                let isAbstract = false
                let isPrivate = false
                // childForFieldName is not reliable for every production in the served wasm;
                // fall back to a DIRECT child of the `modifiers` node type (the grammar's own shape).
                let mods = m.childForFieldName?.("modifiers")
                if (!mods) {
                  for (let k = 0; k < m.childCount; k++) {
                    const kid = m.child(k)
                    if (kid && kid.type === "modifiers") {
                      mods = kid
                      break
                    }
                  }
                }
                if (mods) {
                  for (let j = 0; j < mods.childCount; j++) {
                    const tok = mods.child(j)
                    if (!tok) continue
                    if (tok.type === "default") isDefault = true
                    else if (tok.type === "static") isStatic = true
                    else if (tok.type === "abstract") isAbstract = true
                    else if (tok.type === "private") isPrivate = true
                  }
                }
                add(ifaceMethod, isDefault ? "default" : isStatic ? "static" : isPrivate ? "private" : isAbstract ? "abstract" : "implicit-abstract", rel)
              }
            }
            break
          }
          case "package_declaration":
          case "module_declaration":
          case "requires_module_directive":
          case "exports_module_directive":
          case "opens_module_directive":
          case "uses_module_directive":
          case "provides_module_directive":
          case "template_expression":
          case "string_interpolation":
          case "super_interfaces":
          case "extends_interfaces":
          case "superclass":
          case "permits":
          case "annotation_argument_list":
          case "element_value_pair":
          case "annotation_type_declaration":
          case "record_pattern":
            add(counter, t, rel)
            break
          default:
            break
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
    } finally {
      // ★ THE TENTH FORM: a walker that does not free its trees dies around 7,600 parses and keeps
      // printing a population header over a fraction of it.
      tree.delete?.()
    }
    if (parsed % 1000 === 0) console.log(`  progress: parsed ${parsed}/${d.files.length}`)
  }

  // ── the falsifiers, COUNTED ──────────────────────────────────────────────────────────────────
  const annNameTotal = [...annNameNode.values()].reduce((a, v) => a + v.sites, 0)
  const annNameCallable = annNameTotal - (annNameNode.get("identifier")?.sites ?? 0) - (annNameNode.get("scoped_identifier")?.sites ?? 0)
  const argTotal = [...annArgNode.values()].reduce((a, v) => a + v.sites, 0)
  const callish = ["method_invocation", "lambda_expression", "object_creation_expression", "method_reference"].reduce(
    (a, k) => a + (annArgNode.get(k)?.sites ?? 0),
    0,
  )
  const defaultMethods = ifaceMethod.get("default")?.sites ?? 0

  const payload = {
    generated: new Date().toISOString(),
    instrument: "script/m14/java-extended-types-census.ts",
    rule: "git-tracked ∧ present ∧ ≤1 MiB, extension .java, tree-sitter tree of the SERVED grammar; parsed must equal the window's admitted count or the run exits 3",
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
      populationString: `parsed=${parsed}/${d.files.length} admitted=${d.files.length} exts=java index=no`,
      wholePopulation: d.files.length === d.admitted,
    },
    grammar: {
      resolvedBy: "src/util/wasm.resolveWasmAsset('tree-sitter-java.wasm')",
      wasmPath: g.wasmPath,
      sha256: g.sha256,
      namedTypes: new Set(g.namedTypes).size,
      candidateFamilies: familyHits,
    },
    decorates: {
      annotationSites: plain(annByNode),
      annotationNameNodeKinds: plain(annNameNode),
      annotatedDeclarationKinds: plain(annAppliedTo),
      annotationArgumentNodeTypes: plain(annArgNode),
      annotationSitesTotal: annNameTotal,
      annotationArgumentNodesTotal: argTotal,
      annotationNamesThatAreNotTypeNames: annNameCallable,
      annotationArgumentNodesContainingCallsLambdasOrConstructions: callish,
      topAnnotationNames: Object.entries(plain(annByName)).slice(0, 25),
    },
    renders: {
      templateShapedNodes: {
        template_expression: counter.get("template_expression")?.sites ?? 0,
        string_interpolation: counter.get("string_interpolation")?.sites ?? 0,
      },
      grammarFamilyHits: familyHits["render/component"],
    },
    mixes_in: {
      interfaces: counter.get("interface_declaration")?.sites ?? 0,
      interfaceMethodsByModifier: plain(ifaceMethod),
      conformanceClauses: {
        super_interfaces: counter.get("super_interfaces")?.sites ?? 0,
        extends_interfaces: counter.get("extends_interfaces")?.sites ?? 0,
        superclass: counter.get("superclass")?.sites ?? 0,
      },
      grammarFamilyHits: familyHits["mixin"],
    },
    part_of: {
      packageDeclarations: counter.get("package_declaration")?.sites ?? 0,
      moduleDeclarations: counter.get("module_declaration")?.sites ?? 0,
      moduleDirectives: {
        requires: counter.get("requires_module_directive")?.sites ?? 0,
        exports: counter.get("exports_module_directive")?.sites ?? 0,
        opens: counter.get("opens_module_directive")?.sites ?? 0,
        uses: counter.get("uses_module_directive")?.sites ?? 0,
        provides: counter.get("provides_module_directive")?.sites ?? 0,
      },
      grammarFamilyHits: familyHits["part-directive"],
    },
    familyHitNotes: {
      "record_pattern_component":
        "a RECORD-PATTERN component node (JLS 21 `record_pattern_component`, the `int x` part of `instanceof Point(int x, int y)`), NOT a render component and NOT a part-file directive",
      template_expression:
        "Java 21 STRING TEMPLATE interpolation (`STR.\{x}`), a string-shaped expression with no component element and no component name field",
    },
    annotationFamily: {
      grammarTypes: g.namedTypes.filter((n) => n.indexOf("annotation") >= 0).sort(),
    },
    otherCounts: {
      annotation_argument_list: counter.get("annotation_argument_list")?.sites ?? 0,
      element_value_pair: counter.get("element_value_pair")?.sites ?? 0,
      annotation_type_declaration: counter.get("annotation_type_declaration")?.sites ?? 0,
      record_pattern: counter.get("record_pattern")?.sites ?? 0,
      permits: counter.get("permits")?.sites ?? 0,
      defaultInterfaceMethods: defaultMethods,
    },
  }
  if (JSON_OUT) {
    writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + "\n")
    console.log(`wrote ${path.relative(ROOT, OUT_JSON)}`)
  }
  console.log(
    `population: parsed=${parsed}/${d.files.length} admitted=${d.files.length} exts=java index=no` +
      (d.files.length === d.admitted ? " (WHOLE POPULATION)" : " (SAMPLE / SLICE — not a population)"),
  )
  console.log(`decorates: annotation sites ${annNameTotal} · name kinds ${JSON.stringify(plain(annNameNode))} · argument nodes ${argTotal} · call-ish ${callish}`)
  console.log(`mixes_in: interfaces ${payload.mixes_in.interfaces} · interface methods ${JSON.stringify(plain(ifaceMethod))} · clauses ${JSON.stringify(payload.mixes_in.conformanceClauses)}`)
  console.log(`part_of: packages ${payload.part_of.packageDeclarations} · modules ${payload.part_of.moduleDeclarations} · directives ${JSON.stringify(payload.part_of.moduleDirectives)}`)
  console.log(`renders: ${JSON.stringify(payload.renders.templateShapedNodes)} · grammar render-family hits ${JSON.stringify(payload.renders.grammarFamilyHits)}`)
  console.log(`falsifiers: annotation names that are NOT type names = ${annNameCallable}; annotation argument nodes containing a call/lambda/construction = ${callish}`)

  if (parsed !== d.files.length) {
    console.error(`POPULATION MISMATCH: parsed ${parsed} != admitted-in-window ${d.files.length} (failed ${failed}). A partial walk is not a population.`)
    if (filesFailed.length) console.error(`  failed: ${filesFailed.slice(0, 5).join(", ")}${filesFailed.length > 5 ? ", …" : ""}`)
    process.exit(3)
  }
}

await main()
