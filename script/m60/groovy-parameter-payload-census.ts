// groovy parameter-type extraction: the `unknown` placeholder.
//
// The override signature (which the R10 label rule consumes) is built from
// `parameters.map(p => p.type ?? "")`. groovy's parameter extractor matches a
// node list that names `type_identifier | integral_type | floating_point_type |
// boolean_type | void_type | generic_type | array_type` — a QUALIFIED type
// (`Outer.Criterion`, `java.util.Map.Entry`) is a `scoped_type_identifier`, so
// it is absent from that list and the type falls back to `unknown`. The
// fixture's own signature printed `(Entity,unknown,StringBuilder,boolean)`,
// which is how this was noticed.
//
// This measures: (1) the node type the pinned grammar uses, (2) how often the
// placeholder appears in a real corpus.
import * as fs from "fs"
import * as path from "path"
import { RealGroovyAnalyzer } from "../../src/ast/real-groovy-analyzer"

const SKIP_DIR = new Set(["node_modules", ".git", "build", "out", "target", ".gradle", "generated"])

function walk(dir: string, out: string[] = [], cap = 60000): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (out.length >= cap) return out
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue
      walk(p, out, cap)
    } else if (e.isFile() && e.name.endsWith(".groovy")) out.push(p)
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)

  // (1) what node does a qualified parameter type parse to?
  const probe = "class A { void f(Outer.Criterion c, java.util.Map.Entry<String, Boolean> e, StringBuilder q) {} }"
  const ptree = parser.parse(probe)
  process.stdout.write("(1) parameter node types for qualified types:\n")
  const pstack = [ptree.rootNode]
  while (pstack.length) {
    const n = pstack.pop()!
    if (n.type === "formal_parameter" || n.type === "parameter") {
      const kids: string[] = []
      for (let i = 0; i < n.childCount; i++) kids.push(`${n.child(i)!.type}`)
      process.stdout.write(`    formal_parameter children: ${kids.join(", ")}\n`)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)!
        process.stdout.write(`      named: ${c.type} = ${JSON.stringify(c.text)}\n`)
      }
    }
    for (let i = 0; i < n.childCount; i++) pstack.push(n.child(i)!)
  }

  // (2) corpus frequency of the placeholder, on symbols the analyzer emits.
  const root = "$HOME/fixtures/repositories/grails-core"
  const files = walk(root)
  const stride = Math.max(1, Math.floor(files.length / 600))
  const picked: string[] = []
  for (let i = 0; i < files.length && picked.length < 600; i += stride) picked.push(files[i])

  const az = new RealGroovyAnalyzer()
  // The denominator that matters: parameters whose type is WRITTEN as a
  // qualified name (`scoped_type_identifier`). If groovy records those as
  // undefined, a WRITTEN type is missing from the payload — different from a
  // dynamically untyped parameter, which honestly has none.
  let scopedParams = 0
  let scopedJoinTotal = 0
  let scopedJoinLost = 0
  const joinSamples: string[] = []
  let syms = 0
  let withParams = 0
  // Three DIFFERENT populations, which the first version of this probe lumped
  // together and thereby overstated:
  //   placeholder  — the literal `unknown`, i.e. a WRITTEN type the extractor
  //                  failed to name (the scoped_type_identifier gap)
  //   untyped      — a dynamic groovy parameter with no type at all (honest)
  //   other        — the empty string
  let placeholder = 0
  let untyped = 0
  let empty = 0
  const samples: string[] = []
  for (const file of picked) {
    let source: string
    try {
      source = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    let res: any
    let scopedHere: { method: string; declared: string; index: number; arity: number }[] = []
    try {
      const tree = parser.parse(source)
      const st = [tree.rootNode]
      while (st.length) {
        const n = st.pop()!
        if (n.type === "method_declaration" || n.type === "constructor_declaration" || n.type === "function_definition") {
          const nameNode = n.childForFieldName("name")
          const pnode = n.childForFieldName("parameters")
          if (nameNode && pnode) {
            for (let i = 0; i < pnode.namedChildCount; i++) {
              const p = pnode.namedChild(i)!
              if (p.type !== "formal_parameter" && p.type !== "parameter") continue
              for (let j = 0; j < p.namedChildCount; j++) {
                if (p.namedChild(j)!.type === "scoped_type_identifier") {
                  scopedParams++
                  scopedHere.push({ method: nameNode.text, declared: p.namedChild(j)!.text, index: i, arity: pnode.namedChildCount })
                  break
                }
              }
            }
          }
        }
        for (let i = 0; i < n.childCount; i++) st.push(n.child(i)!)
      }
      res = az.analyze(tree.rootNode, source, file)
    } catch {
      scopedHere = []
      continue
    }
    // The join: what did the payload record for those written-qualified slots?
    // A name-only match is WRONG here — groovy is heavily overloaded, so one
    // declaration matched every namesake (the first version of this probe
    // reported 640 joins from 37 declarations and was pure artifact). The
    // candidate set is name + ARITY, and a slot counts as lost only when EVERY
    // candidate left it undefined, which makes the verdict conservative.
    for (const sc of scopedHere) {
      const candidates = (res.symbols ?? []).filter(
        (s: any) => s.name === sc.method && s.kind === "method" && (s.parameters ?? []).length === sc.arity,
      )
      if (candidates.length === 0) continue
      scopedJoinTotal++
      const lost = candidates.every((s: any) => (s.parameters ?? [])[sc.index]?.type === undefined)
      if (lost) {
        scopedJoinLost++
        if (joinSamples.length < 10) {
          const said = candidates
            .map((s: any) => JSON.stringify((s.parameters ?? [])[sc.index]?.type ?? null))
            .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
            .join("/")
          joinSamples.push(`declared ${JSON.stringify(sc.declared)} but ${candidates.length} same-arity candidate(s) record ${said}  (${sc.method} #${sc.index})  <- ${file.replace(/^.*grails-core\//, "")}`)
        }
      }
    }
    for (const s of res.symbols ?? []) {
      syms++
      if (!Array.isArray(s.parameters) || s.parameters.length === 0) continue
      withParams++
      for (const p of s.parameters) {
        if (p.type === "unknown") {
          placeholder++
          if (samples.length < 20) {
            samples.push(`${s.kind} ${s.ownerName ?? "-"}.${s.name}(${s.parameters.map((z: any) => `${z.name}:${z.type ?? "-"}`).join(", ")})  <- ${file.replace(/^.*grails-core\//, "")}`)
          }
        }
        else if (p.type === undefined || p.type === null) untyped++
        else if (p.type === "") empty++
      }
    }
  }
  process.stdout.write(`\n(2) corpora: ${picked.length} groovy files of ${files.length}\n`)
  process.stdout.write(`    symbols: ${syms}; with parameters: ${withParams}\n`)
  process.stdout.write(`    parameter slots: placeholder(unknown)=${placeholder}; untyped(undefined)=${untyped}; empty=${empty}\n`)
  process.stdout.write(`    parameters whose type is WRITTEN qualified (scoped_type_identifier): ${scopedParams}\n`)
  process.stdout.write(`    of those, joined to a symbol slot: ${scopedJoinTotal}; recorded as UNDEFINED (the written name was dropped): ${scopedJoinLost}\n`)
  for (const s of joinSamples) process.stdout.write(`      LOST ${s}\n`)
  for (const s of samples) process.stdout.write(`      ${s}\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
