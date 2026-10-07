#!/usr/bin/env bun
/**
 * INCOMING_PY — the python lane's ONTOLOGY CENSUS.
 *
 * WHAT THIS IS FOR. `script/m14/ontology-coverage-gate.ts` is the arbiter of the
 * relationship-type workstream, and its header records why it exists: `overrides`
 * was missing from bash for a whole wave and the differential stayed green,
 * because the analyzer omitted it and the oracle was written after that ruling.
 * "Nothing agrees with nothing perfectly."
 *
 * That gate takes its RULING TABLE from the agent. This script takes nothing from
 * the agent: it walks the corpus, runs PRODUCTION `ASTEngine.parseFile`, counts every
 * relationship label it publishes, and separately counts the CONSTRUCTS a missing
 * type would need — on the parse tree, so a string or a comment cannot fake them.
 *
 * The one thing it does not decide on its own is whether a construct without an edge
 * is a GAP or a RULED verdict; that is a judgement, and it is written down in
 * `docs/analyzers/real-python-analyzer.md` next to the number that supports it. What
 * this script guarantees is that the judgement has a number behind it.
 *
 * WRITES NOTHING. Every count here is recomputed from the corpus on each run.
 *
 * Usage: bun script/m60/python-ontology-census.ts [--json out.json] [--files]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.BB_PY_REPO ?? "python-codesql"
const MAX_BYTES = 512 * 1024

/** The ontology, verbatim from `script/m14/ontology-coverage-gate.ts` line 49. */
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------- corpus
const repoDir = path.join(CR, REPO)
const files: { rel: string; abs: string; text: string }[] = []
{
  const tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  }).split("\0").filter(Boolean)
  for (const rel of tracked) {
    const abs = path.join(repoDir, rel)
    let text: string
    try {
      if (statSync(abs).size > MAX_BYTES) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "python") continue
    files.push({ rel, abs, text })
  }
}

// ---------------------------------------------------------------- run production parseFile
type Row = { type: Type; n: number; files: Set<string>; examples: string[] }
const observed = new Map<Type, Row>()
const LABELS_OUTSIDE_ONTOLOGY = new Map<string, number>()
let symbolTotal = 0
let relTotal = 0
let errorFiles = 0
let errorNodes = 0
const symbolNames = new Map<string, number>()
let parseFailures = 0

// parseFile is async and WASM-backed; run the walk in-process with a worker pool.
{
  let idx = 0
  const results: any[] = new Array(files.length)
  const worker = async () => {
    while (true) {
      const i = idx++
      if (i >= files.length) return
      const f = files[i]
      try {
        results[i] = await parseFile(f.abs, f.dir)
      } catch {
        parseFailures++
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()))

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const r = results[i]
    if (!r) continue
    symbolTotal += r.symbols?.length ?? 0
    for (const s of r.symbols ?? []) {
      if (typeof s.name === "string" && s.name.length > 0) {
        symbolNames.set(s.name, (symbolNames.get(s.name) ?? 0) + 1)
      }
    }
    const errs = r.errors ?? []
    if (errs.length > 0) { errorFiles++; errorNodes += errs.length }
    for (const x of r.relationships ?? []) {
      relTotal++
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) {
        LABELS_OUTSIDE_ONTOLOGY.set(t, (LABELS_OUTSIDE_ONTOLOGY.get(t) ?? 0) + 1)
        continue
      }
      const row = observed.get(t) ?? { type: t, n: 0, files: new Set<string>(), examples: [] }
      row.n++
      if (row.files.size < 6) row.files.add(f.rel)
      if (row.examples.length < 4) row.examples.push(`${x.source} -> ${x.target} @L${x.line_number ?? "?"} conf=${x.confidence}`)
      observed.set(t, row)
    }
  }
}

// ---------------------------------------------------------------- construct probes
// Instrument B only: every probe counts on the PARSE TREE. A regex would match a
// docstring, a comment, or a `# TODO: instantiate Foo` and produce a number that
// convicts a correct ruling on the strength of text (the gate's own header records
// two false positives produced exactly that way).
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-python.wasm"))))

/** Node types the grammar actually produces across the corpus — Instrument A. */
const grammarNodeTypes = new Map<string, number>()
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const v = (n: any) => {
    grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.namedChildCount; i++) v(n.namedChild(i))
  }
  v(t.rootNode)
  t.delete?.()
}

type Probe = { id: string; counts: Map<string, number>; files: Set<string>; examples: string[] }
function probe(): Probe {
  return { id: "", counts: new Map(), files: new Set(), examples: [] }
}
function hit(p: Probe, bucket: string, label: string) {
  p.counts.set(bucket, (p.counts.get(bucket) ?? 0) + 1)
  p.files.add(bucket)
  if (p.examples.length < 4) p.examples.push(label)
}

/**
 * THE CONSTRUCT PROBES. One per (type × missing-type question), each counting a
 * thing that, if it were non-zero, would mean the type is derivable and its absence
 * is a GAP rather than a RULED verdict.
 *
 * `implements` is the interesting one for python: the language HAS the construct —
 * ABCs, `typing.Protocol`, `@abc.abstractmethod` — and the question is not whether
 * the construct exists but whether it is distinguishable from `extends` in the tree.
 * Probe: a class whose base list carries a Protocol / ABC / metaclass marker, and a
 * method carrying `@abstractmethod`, and a base whose name ends in `Interface`/`ABC`
 * by convention.
 */
const implementsProbe = probe()
const dispatchProbe = probe()
const dunderInitProbe = probe()
const selfAssignProbe = probe()
const moduleLevelDefProbe = probe()

for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const v = (n: any) => {
    switch (n.type) {
      case "class_definition": {
        const name = n.namedChildren.find((c: any) => c.type === "identifier")?.text ?? "?"
        // the declared base list, by SHAPE (not by text search)
        const args = n.namedChildren.find((c: any) => c.type === "argument_list")
        const bases: string[] = []
        for (const a of args?.namedChildren ?? []) {
          if (a.type === "identifier") bases.push(a.text)
          else if (a.type === "attribute") bases.push(a.namedChildren[a.namedChildren.length - 1]?.text ?? "")
          else if (a.type === "subscript") {
            const head = a.namedChildren[0]
            bases.push(head?.type === "identifier" ? head.text : (head?.namedChildren?.at(-1)?.text ?? "<other>"))
          } else bases.push(`<${a.type}>`)
        }
        // ABC / Protocol / metaclass markers
        for (const b of bases) {
          if (["ABC", "Protocol", "ABCMeta", "TypedDict", "NamedTuple", "Enum", "IntEnum", "StrEnum", "Flag"].includes(b)) {
            hit(implementsProbe, "abstract-base-primitive", `${f.rel}: class ${name}(${bases.join(", ")})`)
          }
        }
        // keyword metaclass= / total= in the base list
        for (const a of args?.namedChildren ?? []) {
          if (a.type === "keyword_argument") hit(implementsProbe, "keyword-in-base-list", `${f.rel}: class ${name}(${a.text.slice(0, 40)})`)
        }
        // a base spelled by CONVENTION as an interface
        if (bases.some((b) => /(^|[a-z])(Interface|ABC|Protocol)$/.test(b))) {
          hit(implementsProbe, "convention-named-base", `${f.rel}: class ${name}(${bases.join(", ")})`)
        }
        // a class body that DECLARES NOTHING but abstract methods is an interface in
        // every language sense; count class bodies with >=1 abstractmethod and 0 concrete defs
        break
      }
      case "decorated_definition": {
        const inner = n.namedChildren.find((c: any) => c.type === "function_definition")
        const name = inner?.namedChildren.find((c: any) => c.type === "identifier")?.text
        if (name === "__init__") {
          // is it overriding object.__init__?  count every __init__ at all
          hit(dunderInitProbe, "__init__-declared", `${f.rel}: def __init__`)
        }
        for (const d of n.namedChildren.filter((c: any) => c.type === "decorator")) {
          const txt = d.text
          if (/abstractmethod|abstractmethod\b/.test(txt)) {
            hit(implementsProbe, "abstractmethod-decorator", `${f.rel}: ${txt.split("(")[0]}`)
          }
          if (/^\s*@(?:abc\.)?abstractmethod/.test(txt)) {
            hit(implementsProbe, "abstractmethod-only", `${f.rel}: ${txt.slice(0, 40)}`)
          }
        }
        break
      }
      case "call": {
        // DYNAMIC DISPATCH — the shape this lane must classify honestly.
        const fn = n.namedChildForFieldName?.("function") ?? n.namedChildren[0]
        if (!fn) break
        const shape = fn.type
        const label = `${f.rel}: (${shape}) ${fn.text.split("\n")[0].slice(0, 50)}`
        if (shape === "attribute") {
          const obj = fn.namedChildren[0]
          // `self.m()` — resolved by the MRO at runtime; `self` is a parameter, so the
          // static target depends on the instance's class.
          if (obj?.type === "identifier" && (obj.text === "self" || obj.text === "cls")) {
            hit(dispatchProbe, "self-attr-call", label)
          } else if (obj?.type === "attribute") {
            hit(dispatchProbe, "receiver-attr-chain", label)
          } else {
            hit(dispatchProbe, "other-attr-call", label)
          }
        } else if (shape === "identifier") {
          hit(dispatchProbe, "bare-name-call", label)
        } else {
          // EVERYTHING the allowlist refuses: conditional, lambda, call, subscript, string
          hit(dispatchProbe, `no-static-name:${shape}`, label)
        }
        // module-level `self.x = ` outside a method — the shape a symbol's owner implies
        break
      }
      case "assignment": {
        const left = n.namedChild(0)
        if (left?.type === "attribute") {
          const obj = left.namedChildren[0]
          if (obj?.type === "identifier" && (obj.text === "self" || obj.text === "cls")) {
            hit(selfAssignProbe, "self-attr-write", `${f.rel}: ${left.text.split("\n")[0].slice(0, 50)}`)
          }
        }
        break
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) v(n.namedChildren[i])
  }
  v(t.rootNode)
  t.delete?.()
}
implementsProbe.id = "implements"
dispatchProbe.id = "calls-dispatch"
dunderInitProbe.id = "object-init"
selfAssignProbe.id = "self-attr-write"
moduleLevelDefProbe.id = "module-level-def"

for (const p of [implementsProbe, dispatchProbe, dunderInitProbe, selfAssignProbe]) {
  p.examples = p.examples.slice(0, 4)
}

// ---------------------------------------------------------------- report
const out = {
  corpus: { root: CR, repo: REPO, commit: execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), files: files.length },
  totals: { symbols: symbolTotal, relationships: relTotal, errorFiles, errorNodes, parseFailures },
  grammarNodeTypesObserved: grammarNodeTypes.size,
  emitted: Object.fromEntries(ALL_TYPES.map((t) => {
    const o = observed.get(t)
    return [t, o ? { n: o.n, files: o.files.size, examples: o.examples } : { n: 0, files: 0, examples: [] }]
  })),
  labelsOutsideOntology: Object.fromEntries(LABELS_OUTSIDE_ONTOLOGY),
  probes: {
    implements: { counts: Object.fromEntries(implementsProbe.counts), files: [...implementsProbe.files], examples: implementsProbe.examples },
    dispatch: { counts: Object.fromEntries(dispatchProbe.counts), files: [...dispatchProbe.files], examples: dispatchProbe.examples },
    objectInit: { counts: Object.fromEntries(dunderInitProbe.counts), examples: dunderInitProbe.examples },
    selfAttrWrite: { counts: Object.fromEntries(selfAssignProbe.counts), examples: selfAssignProbe.examples },
  },
}

const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : undefined
if (jsonOut) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(jsonOut, JSON.stringify(out, null, 2))
}

console.log(`python ontology census — ${REPO}@${out.corpus.commit.slice(0, 8)}`)
console.log(`corpus: ${files.length} admitted .py files, ${grammarNodeTypes.size} distinct grammar node types observed`)
console.log(`totals: ${symbolTotal} symbols, ${relTotal} relationships, ${errorNodes} error nodes in ${errorFiles} files, ${parseFailures} parse failures\n`)
console.log("EMITTED (production parseFile):")
for (const t of ALL_TYPES) {
  const o = observed.get(t)
  if (!o) { console.log(`  ${t.padEnd(13)} 0`); continue }
  console.log(`  ${t.padEnd(13)} ${String(o.n).padStart(7)}  in ${o.files.size}+ files   e.g. ${[...o.files][0] ?? ""}`)
}
if (LABELS_OUTSIDE_ONTOLOGY.size) console.log(`\nlabels OUTSIDE the ontology: ${JSON.stringify(Object.fromEntries(LABELS_OUTSIDE_ONTOLOGY))}`)
console.log("\nCONSTRUCT PROBES (parse-tree counts; a non-zero count falsifies a RULED verdict):")
for (const [name, p] of [["implements", out.probes.implements], ["calls/dispatch", out.probes.dispatch], ["object.__init__", out.probes.objectInit], ["self-attr-write", out.probes.selfAttrWrite]] as const) {
  console.log(`  ${name}: ${JSON.stringify(p.counts)}`)
  if (p.examples.length) console.log(`     e.g. ${p.examples[0]}`)
}