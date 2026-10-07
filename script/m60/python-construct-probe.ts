#!/usr/bin/env bun
/**
 * INCOMING_PY — construct probes for the relationship types the lane does NOT emit.
 *
 * WHY A SEPARATE INSTRUMENT FROM THE CENSUS. `python-ontology-census.ts` answers
 * "what does production `parseFile` publish". This one answers the only question
 * that can decide a MISSING type: "is the construct the type would need present in
 * the language's own text, on the parse tree".
 *
 * A non-zero count here FALSIFIES a RULED verdict and forces a GAP. A zero count
 * does NOT by itself prove a ruling — it makes one falsifiable, which is the whole
 * point. `overrides` was missing from bash for a whole wave behind a prose
 * justification; only counting the language found it.
 *
 * TWO INSTRUMENTS, AND WHICH ONE APPLIES IS DECIDED BY THE QUESTION:
 *
 *   A: GRAMMAR INVENTORY — every node type the grammar actually emits across the
 *      corpus. Positive evidence of absence: if `implements_clause` is not among the
 *      types the parser produces, no python source can express one. That is a fact
 *      about the language, not a failure to find something.
 *   B: PARSE-TREE SEMANTIC COUNT — for constructs that ARE expressible. A text regex
 *      is the wrong instrument (the ontology gate's header records two false
 *      positives it produced: `class voice` matched inside a telnet IAC word list in
 *      a bash string, and `new Map(` matched embedded JavaScript in a heredoc). A
 *      comment saying `# TODO: implement Foo` must not convict a ruling.
 *
 * The secondary corpus (CPython's own stdlib) is used ONLY for constructs that are
 * rare in `fixtures`, and every row it contributes is labelled `stdlib`, because a
 * number from outside the pinned corpus is a different measurement and must not be
 * silently merged with one that is.
 *
 * WRITES NOTHING.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const STDLIB = process.env.BB_PY_STDLIB ?? "/usr/lib/python3.10"
const MAX_BYTES = 512 * 1024

type Src = { corpus: "fixtures" | "stdlib"; repo: string; rel: string; abs: string; text: string }

// ---------------------------------------------------------------- corpus
function corpusFiles(): Src[] {
  const out: Src[] = []
  for (const e of readdirSync(CR)) {
    const dir = path.join(CR, e)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    let tracked: string[]
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text: string
      try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
      if (detectLanguageFromPath(abs, text) !== "python") continue
      out.push({ corpus: "fixtures", repo: e, rel, abs, text })
    }
  }
  return out
}
function stdlibFiles(): Src[] {
  const out: Src[] = []
  const stack = [STDLIB]
  while (stack.length) {
    const d = stack.pop()!
    let entries: string[]
    try { entries = readdirSync(d) } catch { continue }
    for (const n of entries) {
      const abs = path.join(d, n)
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { if (n !== "test" && n !== "tests" && n !== "lib2to3" && n !== "__pycache__" && n !== "idlelib") stack.push(abs); continue }
      if (!n.endsWith(".py")) continue
      if (st.size > MAX_BYTES) continue
      let text: string
      try { text = readFileSync(abs, "utf8") } catch { continue }
      out.push({ corpus: "stdlib", repo: "cpython-stdlib", rel: path.relative(STDLIB, abs), abs, text })
    }
  }
  return out
}

const bb = corpusFiles()
const sl = stdlibFiles()
const files = [...bb, ...sl]

// ---------------------------------------------------------------- parser
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-python.wasm"))))

// ---------------------------------------------------------------- buckets
type Bucket = { corpus: "fixtures" | "stdlib"; files: Set<string>; examples: string[] }
const buckets = new Map<string, Bucket>()
function b(key: string, corpus: "fixtures" | "stdlib", label: string) {
  const k = `${corpus}::${key}`
  const row = buckets.get(k) ?? { corpus, files: new Set<string>(), examples: [] }
  row.files.add(label.split(" @ ")[0]!)
  if (row.examples.length < 3) row.examples.push(label)
  buckets.set(k, row)
}
function count(key: string, corpus: "fixtures" | "stdlib") {
  return buckets.get(`${corpus}::${key}`)?.files.size ?? 0
}

// ---------------------------------------------------------------- INSTRUMENT A
const nodeTypesByCorpus: Record<string, Set<string>> = { fixtures: new Set(), stdlib: new Set() }
const nodeTypeCounts = new Map<string, number>()

// ---------------------------------------------------------------- INSTRUMENT B
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const tag = `${f.repo}/${f.rel}`

  // walk ONCE, collecting everything: node types + all construct probes
  const v = (n: any, inClassBody: boolean, className: string | undefined) => {
    nodeTypesByCorpus[f.corpus].add(n.type)
    nodeTypeCounts.set(n.type, (nodeTypeCounts.get(n.type) ?? 0) + 1)

    switch (n.type) {
      // ---------------------------------------------------------------- __all__
      case "assignment": {
        const left = n.namedChild(0)
        if (left?.type === "identifier" && left.text === "__all__") {
          const right = n.childForFieldName?.("right") ?? n.namedChild(n.namedChildCount - 1)
          const shape = !right ? "<none>" : right.type === "list" ? "list"
            : right.type === "tuple" ? "tuple"
            : right.type === "identifier" ? "NAME"
            : right.type === "binary_operator" ? "concatenation"
            : right.type === "call" ? "call"
            : right.type === "concatenated_string" ? "f-string"
            : right.type
          const scope = inClassBody ? "class-body" : "module-body"
          b(`__all__:${shape}:${scope}`, f.corpus, `${tag} @ L${n.startPosition.row + 1}`)
        }
        break
      }
      case "augmented_assignment": {
        const left = n.namedChild(0)
        if (left?.type === "identifier" && left.text === "__all__") {
          b(`__all__:augmented:${inClassBody ? "class-body" : "module-body"}`, f.corpus, `${tag} @ L${n.startPosition.row + 1}`)
        }
        break
      }

      // ---------------------------------------------------------------- class heritage
      case "class_definition": {
        const cn = n.namedChildren.find((c: any) => c.type === "identifier")?.text ?? "?"
        const args = n.namedChildren.find((c: any) => c.type === "argument_list")
        const bases: { leaf: string; shape: string }[] = []
        for (const a of args?.namedChildren ?? []) {
          if (a.type === "keyword_argument") { b("heritage:keyword_argument-in-base-list", f.corpus, `${tag}: class ${cn}(${a.text.slice(0, 40)})`); continue }
          const leaf = a.type === "identifier" ? a.text
            : a.type === "attribute" ? (a.namedChildren.at(-1)?.text ?? "")
            : a.type === "subscript" ? (a.namedChildren[0]?.type === "identifier" ? a.namedChildren[0].text : `subscript:${a.namedChildren[0]?.type}`)
            : `<${a.type}>`
          bases.push({ leaf, shape: a.type })
        }
        b(`heritage:classes-with-${bases.length}-base${bases.length === 1 ? "" : "s"}`, f.corpus, `${tag}: class ${cn}(${bases.map((x) => x.leaf).join(", ")})`)
        for (const bs of bases) b(`heritage:base-shape:${bs.shape}`, f.corpus, `${tag}: class ${cn} base ${bs.leaf}`)
        // the ABC / Protocol family — python's spelling of "an interface"
        for (const bs of bases) {
          if (["ABC", "ABCMeta", "Protocol", "runtime_checkable"].includes(bs.leaf)) {
            b(`heritage:interface-primitive-base:${bs.leaf}`, f.corpus, `${tag}: class ${cn}(${bs.leaf})`)
          }
          if (/^(I[A-Z]\w*|[A-Za-z]*Interface|[A-Za-z]*ABC|.*Protocol)$/.test(bs.leaf) && bs.leaf !== "Protocol") {
            b("heritage:convention-interface-name", f.corpus, `${tag}: class ${cn}(${bs.leaf})`)
          }
        }
        break
      }

      // ---------------------------------------------------------------- decorators
      case "decorator": {
        const inner = n.namedChild(0)
        const txt = inner?.text ?? n.text
        if (inner?.type === "identifier" && inner.text === "abstractmethod") {
          b("interface:abstractmethod-decorator", f.corpus, `${tag} @ L${n.startPosition.row + 1}`)
        }
        if (inner?.type === "attribute") {
          const recv = inner.namedChildren[0]?.text
          const leaf = inner.namedChildren.at(-1)?.text
          if (leaf === "abstractmethod") b("interface:abstractmethod-decorator", f.corpus, `${tag} @ L${n.startPosition.row + 1}`)
          if (leaf === "register" && recv) b("interface:register-call-decorator", f.corpus, `${tag}: @${inner.text}`)
          if (leaf === "runtime_checkable") b("interface:runtime_checkable", f.corpus, `${tag}: @${inner.text}`)
        }
        if (inner?.type === "call") {
          const fn = inner.namedChild(0)
          const leaf = fn?.type === "attribute" ? fn.namedChildren.at(-1)?.text : fn?.text
          if (leaf === "abstractmethod") b("interface:abstractmethod-decorator", f.corpus, `${tag} @ L${n.startPosition.row + 1}`)
          if (leaf === "register") b("interface:register-call-decorator", f.corpus, `${tag}: @${inner.text}`)
        }
        if (inner?.type === "identifier" && inner.text === "total_ordering") b("interface:dunder-hook-decorator", f.corpus, `${tag}: @${txt}`)
        break
      }

      // ---------------------------------------------------------------- virtual registration
      case "call": {
        const fn = n.childForFieldName?.("function") ?? n.namedChildren[0]
        if (fn?.type === "attribute") {
          const leaf = fn.namedChildren.at(-1)?.text
          const recv = fn.namedChildren[0]
          // `ABC.register(MyClass)` — explicit virtual conformance, the one python
          // construct that declares an interface relationship WITHOUT inheriting.
          if (leaf === "register" && recv?.type === "identifier") {
            const args = n.childForFieldName?.("arguments")
            const first = args?.namedChildren?.[0]
            if (first?.type === "identifier") {
              b("interface:virtual-registration", f.corpus, `${tag} @ L${n.startPosition.row + 1}: ${recv.text}.register(${first.text})`)
            }
          }
          if (leaf === "subclasshook" || leaf === "__subclasshook__") b("interface:subclasshook", f.corpus, `${tag}: ${fn.text}`)
          if (leaf === "runtime_checkable") b("interface:runtime_checkable", f.corpus, `${tag}: ${fn.text}`)
        }
        break
      }

      case "function_definition": {
        const fn = n.namedChildren.find((c: any) => c.type === "identifier")?.text
        if (fn === "__subclasshook__") b("interface:subclasshook-def", f.corpus, `${tag} @ L${n.startPosition.row + 1}`)
        break
      }
    }

    const isClassBody = n.type === "block" && !!className && !inClassBody
    // class body detection: a block whose parent is a class_definition
    let nextClass = className
    let nextInClass = inClassBody
    if (n.type === "class_definition") {
      nextClass = n.namedChildren.find((c: any) => c.type === "identifier")?.text
      nextInClass = true
    } else if (n.type === "function_definition") {
      nextInClass = false
    } else if (n.type === "module") {
      nextInClass = false
    }
    void isClassBody
    for (let i = 0; i < n.namedChildCount; i++) v(n.namedChildren[i], nextInClass, nextClass)
  }
  v(t.rootNode, false, undefined)
  t.delete?.()
}

// ---------------------------------------------------------------- report
const keys = [...buckets.keys()].sort()
const report: Record<string, { files: number; examples: string[] }> = {}
for (const k of keys) {
  const row = buckets.get(k)!
  report[k] = { files: row.files.size, examples: row.examples }
}

console.log("python construct probes")
console.log(`fixtures corpus: ${bb.length} .py files   cpython stdlib: ${sl.length} .py files\n`)

console.log("INSTRUMENT A — grammar node types the parser actually produces:")
console.log(`  fixtures: ${nodeTypesByCorpus.fixtures.size}   stdlib: ${nodeTypesByCorpus.stdlib.size}   union: ${new Set([...nodeTypesByCorpus.fixtures, ...nodeTypesByCorpus.stdlib]).size}`)
const union = new Set([...nodeTypesByCorpus.fixtures, ...nodeTypesByCorpus.stdlib])
for (const t of ["implements_clause", "implements", "interface_declaration", "super_interfaces", "superclass", "extends_interfaces", "extends_clause", "class_heritage", "protocol_declaration", "abstract_class_definition"]) {
  console.log(`  ${t.padEnd(28)} ${union.has(t) ? "PRESENT" : "absent"}`)
}

console.log("\nINSTRUMENT B — semantic construct counts (FILES containing it, not occurrences):")
for (const k of keys) {
  const r = report[k]!
  console.log(`  ${k.padEnd(58)} ${String(r.files).padStart(5)} files   e.g. ${r.examples[0] ?? ""}`)
}

const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : undefined
if (jsonOut) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(jsonOut, JSON.stringify({
    corpus: {
      fixtures: { root: CR, files: bb.length },
      stdlib: { root: STDLIB, files: sl.length },
    },
    instrumentA: {
      nodeTypeCount: { fixtures: nodeTypesByCorpus.fixtures.size, stdlib: nodeTypesByCorpus.stdlib.size, union: union.size },
      types: [...union].sort(),
      absentInterfaces: ["implements_clause", "interface_declaration", "super_interfaces", "superclass", "extends_interfaces", "extends_clause", "class_heritage", "protocol_declaration"].filter((t) => !union.has(t)),
    },
    instrumentB: report,
  }, null, 2))
}