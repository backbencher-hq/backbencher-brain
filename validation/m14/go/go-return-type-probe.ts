// PROBE: does the lane publish a `references` edge for a function's RESULT
// types, in every shape the grammar allows?
//
// WHY THIS IS A SEPARATE PROBE. The oracle comparison reports `references`
// recall at 0.701 and attributes the difference to three causes at once. This
// probe isolates one of them and counts it, because it is the only one that
// turns out to be a defect rather than a scope decision: Go writes a single
// result type WITHOUT parentheses (`func f() *T`), and that shape is neither a
// `parameter_declaration` nor a `field_declaration` nor a `var_spec`, so the
// declared-type walk recurses through it and emits nothing.
//
// The probe counts RESULT SITES two ways from the same tree — by shape — and
// asks the production path whether an edge came out. It is falsifiable: a probe
// that finds a non-zero "expected but absent" count overturns the ruling.
//
// NO REGEX. Shape is read from node.type and field names only.

import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { collectAllGoFiles, splitTestAndNonTest, strideSample } from "./go-corpus-files"

const WANT = Number(process.argv[2] || 200)
const CORPUS_ROOT = process.argv[3] || "$HOME/fixtures/repositories/go-stdlib"

const PREDECLARED: ReadonlySet<string> = new Set([
  "bool", "byte", "complex64", "complex128", "error", "float32", "float64",
  "int", "int8", "int16", "int32", "int64", "rune", "string",
  "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
  "any", "comparable",
])

function named(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) out.push(n.namedChild(i))
  return out
}

/** Type names a result-shape node mentions, descending through wrappers. */
function typeNamesIn(t: any, out: string[]): void {
  if (!t) return
  switch (t.type) {
    case "type_identifier":
    case "qualified_type": {
      const nm = t.type === "qualified_type" ? String(t.childForFieldName("name")?.text ?? "") : String(t.text ?? "")
      if (nm.length > 0 && !PREDECLARED.has(nm)) out.push(nm.split(".").pop() || nm)
      return
    }
    case "generic_type": {
      // `Seq[Variable]` declares a dependency on BOTH the generic type name and
      // its type arguments. Returning early here with the node's whole text
      // produced a target of `Seq[Variable]`, which is not a name any
      // declaration can have, and reported a phantom gap on the first run.
      // Descending is also what the grammar's own shape says: a generic_type's
      // children are the type name and its type_arguments.
      for (const c of named(t)) typeNamesIn(c, out)
      return
    }
    default:
      for (const c of named(t)) typeNamesIn(c, out)
  }
}

interface Shape {
  shape: string
  sites: number
  filesWithSite: number
  expectedEdges: number
  publishedEdges: number
  examples: string[]
}

function emptyShape(shape: string): Shape {
  return { shape, sites: 0, filesWithSite: 0, expectedEdges: 0, publishedEdges: 0, examples: [] }
}

async function main(): Promise<void> {
  const all = collectAllGoFiles(CORPUS_ROOT)
  const { lib, test } = splitTestAndNonTest(all)
  const libWant = Math.max(1, Math.round(WANT * 0.75))
  const sample = [...strideSample(lib, libWant), ...strideSample(test, WANT - libWant)]
  const parser = await ASTEngine.getParser("go")

  // Two shapes, named for what the tree looks like rather than for a verdict:
  //   bare_type_result        the `result` field IS the type node
  //   parenthesised_result    the `result` field is a parameter_list
  const shapes = new Map<string, Shape>()
  shapes.set("bare_type_result", emptyShape("bare_type_result"))
  shapes.set("parenthesised_result", emptyShape("parenthesised_result"))
  const perFileSites = new Map<string, { bare: number; paren: number }>()

  let compared = 0
  let crashed = 0
  const absentExamples: string[] = []
  let absentTotal = 0

  for (const f of sample) {
    let content: string
    try {
      content = readFileSync(f.path, "utf8")
    } catch {
      continue
    }
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      continue
    }
    let res: any
    try {
      res = await ASTEngine.parseFile(f.path, content)
    } catch {
      crashed++
      continue
    }
    compared++

    // What the production path published, as (source, target, relType) triples.
    const published = new Set<string>()
    for (const r of res.relationships as any[]) {
      if (String(r.type) !== "references") continue
      published.add(`${r.source}|${r.target}|${String(r.metadata?.relationshipType ?? "")}`)
    }

    const counts = { bare: 0, paren: 0 }
    const walk = (n: any): void => {
      if (n.type === "function_declaration" || n.type === "method_declaration" || n.type === "func_literal") {
        const declName = String(n.childForFieldName("name")?.text ?? "")
        const result = n.childForFieldName("result")
        if (result) {
          const isList = result.type === "parameter_list"
          const names: string[] = []
          typeNamesIn(result, names)
          const uniq = [...new Set(names)]
          if (uniq.length > 0) {
            const key = isList ? "parenthesised_result" : "bare_type_result"
            const sh = shapes.get(key)!
            sh.sites++
            if (isList) counts.paren++
            else counts.bare++
            for (const nm of uniq) {
              sh.expectedEdges++
              const src = declName.length > 0 ? declName : enclosingName(n)
              if (published.has(`${src}|${nm}|return_type`)) sh.publishedEdges++
              else {
                absentTotal++
                if (absentExamples.length < 20) absentExamples.push(`${f.rel}:${result.startPosition.row + 1} ${src} -> ${nm} (result node type ${result.type})`)
              }
            }
          }
        }
      }
      for (const c of named(n)) walk(c)
    }
    walk(tree.rootNode)
    for (const [k, sh] of shapes) {
      if ((k === "bare_type_result" && counts.bare > 0) || (k === "parenthesised_result" && counts.paren > 0)) sh.filesWithSite++
    }
    perFileSites.set(f.rel, counts)
  }

  const L = (s: string) => process.stderr.write(s + "\n")
  L(`RESULT-TYPE references probe over ${compared} files (${WANT} requested), ${crashed} crashed`)
  L("")
  for (const sh of [...shapes.values()]) {
    const pct = sh.expectedEdges > 0 ? ((sh.publishedEdges / sh.expectedEdges) * 100).toFixed(1) : "n/a"
    L(`${sh.shape.padEnd(22)} sites ${String(sh.sites).padStart(5)} in ${String(sh.filesWithSite).padStart(4)} files   expected edges ${String(sh.expectedEdges).padStart(5)}   published ${String(sh.publishedEdges).padStart(5)}   ${pct}%`)
  }
  L("")
  L(`expected-but-absent return_type references: ${absentTotal}`)
  for (const e of absentExamples) L(`  ${e}`)
  const out = process.env.GO_PROBE_ARTIFACT
  if (out) {
    writeFileSync(out, JSON.stringify({ compared, crashed, shapes: [...shapes.values()], absentTotal, absentExamples, sampleSize: sample.length, corpusRoot: CORPUS_ROOT }, null, 2))
    L(`artifact: ${out}`)
  }
}

function enclosingName(n: any): string {
  let q = n.parent
  let hops = 0
  while (q && hops < 40) {
    if (q.type === "function_declaration" || q.type === "method_declaration") return String(q.childForFieldName("name")?.text ?? "")
    q = q.parent
    hops++
  }
  return ""
}

await main()