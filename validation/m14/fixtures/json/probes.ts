/**
 * JSON LANE CONSTRUCT PROBES — the measurements that decide RULED vs GAP for the
 * relationship types the analyzer does not emit.
 *
 * ## Why a text regex is the wrong instrument here
 *
 * `script/m14/ontology-coverage-gate.ts` records two regex probes that convicted
 * correct rulings: `class voice` inside a telnet IAC word list in a bash string, and
 * `new Promise(` inside JavaScript embedded in a bash heredoc. Both matched a SHAPE in
 * a place where the shape means nothing. JSON is worse for this specific question,
 * because a JSON file's strings routinely carry shell commands, URLs, SQL and
 * JavaScript — so a text probe for "does this corpus define a function" would be
 * measuring the corpus's embedded languages, not JSON.
 *
 * So every probe below runs on the PARSE TREE, and a key-role probe asks "is this
 * string the KEY of a `pair`", which a string VALUE can never satisfy. Where a probe
 * must look inside a string (the npm-script case) it does so only after the string has
 * been established as a node of a known ROLE, and it reports the role.
 *
 * ## The two instruments, applied to JSON
 *
 * JSON's grammar yields 12 named node types and 2 fields. That inventory is a fact
 * about the PARSER and is the wrong question for every keyword-shaped construct — the
 * lane learned that twice, on `exports` and on `extends`, where the construct was a
 * KEYWORD and a grammar has no node type for a keyword any more than for a manifest
 * field. So for JSON the meaningful inventory is the KEY VOCABULARY: which strings
 * appear in the `key` field of a `pair`, which is where every JSON Schema keyword, npm
 * manifest field and OpenAPI section name lives. `keyVocabulary()` below is instrument
 * A for JSON, and it is unbounded in principle, so every ruling that rests on it names
 * the candidate key list it considered.
 *
 * ## Probes
 *
 *   overrides    instrument B: a SECOND `pair` with a key already present in the SAME
 *                `object`. RFC 8259 §4 says object names SHOULD be unique and that a
 *                parser's behaviour on a duplicate is unpredictable; every mainstream
 *                implementation keeps the last one, so the second declaration REPLACES
 *                the first. That is the same relation the gate's bash `overrides` probe
 *                counts (a second declaration replacing a prior one), scoped to the
 *                object because a key is unique only within its object.
 *                Also counted, separately: the same key in two DIFFERENT objects of one
 *                file, which is NOT a redefinition and is the corpus's dominant shape.
 *                Reporting only the first would understate; reporting only the second
 *                would be the false positive.
 *
 *   calls        instrument B: an npm `scripts` entry whose command string invokes a
 *                SIBLING script by name (`npm run <name>` / `npm run-script <name>`).
 *                Both endpoints are then real symbols in the same file, so the edge
 *                resolves. Commands invoking BINARY names are counted too and reported
 *                separately: their callee is not declared in the file, so they cannot
 *                become an edge and must not be counted as one.
 *
 *   implements   instrument A over the key vocabulary, restricted to the JSON Schema /
 *                OpenAPI keyword set that could carry a supertype clause, plus a
 *                parse-tree count of every composition keyword actually present.
 *
 *   instantiates instrument B: any `pair` whose key names a constructor
 *                (`new`/`constructor`/`__init__`/`__new__`/`init`) at any depth, plus
 *                the count of `new <Identifier>` occurrences inside strings, tagged with
 *                whether the identifier is also a key of the same object.
 *
 * Usage: npx tsx validation/m14/fixtures/json/probes.ts [--limit N] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string, d: string) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const LIMIT = Number(argOf("--limit", "0"))
const OUT = argOf("--out", "")

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new Parser()
parser.setLanguage(await Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))))

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
const files = LIMIT > 0 ? population.slice(0, LIMIT) : population

// ---------------------------------------------------------------- helpers
const unquote = (t: string): string => {
  const v = t.trim()
  return v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v
}
const keyOf = (pair: any): string | null => {
  if (pair?.type !== "pair") return null
  const k = pair.childForFieldName?.("key")
  if (!k) return null
  return unquote(String(k.text ?? ""))
}
const valueOf = (pair: any): any => pair?.childForFieldName?.("value")

const nodeTypes = new Map<string, number>()
const keyVocabulary = new Map<string, number>()
const keyExamples = new Map<string, string>()

type Bucket = { occurrences: number; files: Set<string>; examples: string[] }
const bump = (map: Map<string, Bucket>, k: string, file: string, ex: string) => {
  const b = map.get(k) ?? { occurrences: 0, files: new Set<string>(), examples: [] }
  b.occurrences++
  b.files.add(file)
  if (b.examples.length < 5) b.examples.push(ex)
  map.set(k, b)
}

const probes = new Map<string, Bucket>([
  ["overrides:duplicate-key-NAMED-same-object", { occurrences: 0, files: new Set(), examples: [] }],
  ["overrides:duplicate-key-EMPTY-same-object", { occurrences: 0, files: new Set(), examples: [] }],
  ["overrides:same-key-different-objects", { occurrences: 0, files: new Set(), examples: [] }],
  ["calls:npm-run-sibling-script", { occurrences: 0, files: new Set(), examples: [] }],
  ["calls:npm-run-undeclared-name", { occurrences: 0, files: new Set(), examples: [] }],
  ["implements:allOf", { occurrences: 0, files: new Set(), examples: [] }],
  ["implements:anyOf", { occurrences: 0, files: new Set(), examples: [] }],
  ["implements:oneOf", { occurrences: 0, files: new Set(), examples: [] }],
  ["implements:not", { occurrences: 0, files: new Set(), examples: [] }],
  ["instantiates:constructor-key-object-value", { occurrences: 0, files: new Set(), examples: [] }],
  ["instantiates:constructor-key-array-value", { occurrences: 0, files: new Set(), examples: [] }],
  ["instantiates:constructor-key-string-value", { occurrences: 0, files: new Set(), examples: [] }],
  ["instantiates:constructor-key-scalar-value", { occurrences: 0, files: new Set(), examples: [] }],
  ["instantiates:new-ident-in-string", { occurrences: 0, files: new Set(), examples: [] }],
  ["instantiates:new-ident-declared-as-key", { occurrences: 0, files: new Set(), examples: [] }],
])

const COMPOSITION_KEYS = new Set(["allOf", "anyOf", "oneOf", "not"])
const CONSTRUCTOR_KEYS = new Set(["new", "constructor", "__init__", "__new__", "init", "instantiate"])
/** The candidate key list `implements` is ruled against — stated so the ruling is falsifiable. */
const SUPERTYPE_CANDIDATE_KEYS = [
  "implements", "extends", "inherits", "inheritsFrom", "interface", "implements_", "extends_",
  "superclass", "superClass", "base", "baseClass", "parent", "prototype", "mixin", "mixins",
  "provides", "satisfies", "conformsTo", "conforms_to", "derivedFrom", "derived_from",
  "allOf", "anyOf", "oneOf", "not", "$extends", "$implements", "implementsInterfaces",
]
const supertypeKeyHits: Record<string, { n: number; files: Set<string>; examples: string[] }> = {}
for (const k of SUPERTYPE_CANDIDATE_KEYS) supertypeKeyHits[k] = { n: 0, files: new Set<string>(), examples: [] }

const NPM_RUN = /(?:^|[;&|(\s])(?:npm|pnpm|yarn|bun)\s+(?:run|run-script|run-s)\s+([A-Za-z0-9:@._/-]+)/g

const visitAll = (n: any, fn: (n: any) => void) => {
  const stack: any[] = [n]
  while (stack.length) {
    const cur = stack.pop()
    fn(cur)
    for (let i = cur.childCount - 1; i >= 0; i--) stack.push(cur.child(i))
  }
}

const fileRowCounts: Record<string, { bytes: number; files: number }> = {}
let parsedFiles = 0
let errorNodeFiles = 0

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
  const root = tree.rootNode
  parsedFiles++
  let sawError = false

  visitAll(root, (n) => {
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
    if (n.type === "ERROR" || n.isMissing) sawError = true
  })
  if (sawError) errorNodeFiles++

  // ---- instrument A: the key vocabulary, which is where JSON's semantics live
  visitAll(root, (n) => {
    if (n.type !== "pair") return
    const k = keyOf(n)
    if (k === null) return
    keyVocabulary.set(k, (keyVocabulary.get(k) ?? 0) + 1)
    if (!keyExamples.has(k)) keyExamples.set(k, label)
    if (COMPOSITION_KEYS.has(k)) bump(probes, `implements:${k}`, label, `${label}:${n.startPosition.row + 1} ${k}`)
    if (CONSTRUCTOR_KEYS.has(k)) {
      // Counted by the VALUE'S ROLE, not by the key's spelling. duckdb's serialization
      // schemas declare `constructor` 271 times and every one of them is a DESCRIBED
      // FIELD of a C++ object — the key names a member the serializer writes, and the
      // value is a string naming its type. A key that merely SPELLS `constructor` is a
      // shape match; whether it denotes a constructor invocation is a role question, and
      // this is where the two are separated. `new Foo` inside a string value is split
      // the same way below.
      const v = valueOf(n)
      const role = v?.type === "object" ? "object-value" : v?.type === "array" ? "array-value" : v?.type === "string" ? "string-value" : "scalar-value"
      bump(probes, `instantiates:constructor-key-${role}`, label, `${label}:${n.startPosition.row + 1} key=${k} value is ${role}`)
    }
    if (SUPERTYPE_CANDIDATE_KEYS.includes(k)) {
      const h = supertypeKeyHits[k]
      h.n++
      h.files.add(label)
      if (h.examples.length < 5) h.examples.push(`${label}:${n.startPosition.row + 1} ${k}`)
    }
  })

  // ---- overrides, BOTH forms, in ONE pass over the objects.
  //
  // Form 1: the same key declared TWICE inside ONE object — the second declaration
  // replaces the first under every mainstream parser, which is the relation the
  // bash lane's `overrides` probe counts.
  // Form 2: the same key in two DIFFERENT objects of one file — which is NOT a
  // redefinition, and is the corpus's dominant shape (every element of a JSON array
  // of objects has the same keys). Reporting only form 1 would understate; reporting
  // only form 2 would be the false positive. Both are counted, separately.
  //
  // The first version of this probe walked the whole tree once PER repeated key to
  // ask how many objects declared it, which is O(distinct keys x nodes) — on
  // terraform's `plan-redacted.json` (10,245 symbols) that is tens of millions of
  // node visits for one file and the run did not finish. Counting into a map during
  // the single walk that already visits every object makes it O(nodes), which is the
  // same shape as the census.
  const objectsDeclaringKey = new Map<string, number>()
  visitAll(root, (n) => {
    if (n.type !== "object") return
    const seen = new Set<string>()
    for (let i = 0; i < n.namedChildCount; i++) {
      const p = n.namedChild(i)
      const k = keyOf(p)
      if (k === null) continue
      if (seen.has(k))
        // The EMPTY key is counted separately and it is the majority of the whole-corpus
        // total (28 of 28 on the first full run, every example a `duplicate key ""` in
        // dart-sdk test data). An empty key is not a second declaration of a NAMED
        // member, so folding it in with named duplicates would report a redefinition
        // count the corpus does not contain. What an empty key marks is a document the
        // grammar already recovered with ERROR nodes — 488 of them corpus-wide.
        bump(
          probes,
          k.length === 0 ? "overrides:duplicate-key-EMPTY-same-object" : "overrides:duplicate-key-NAMED-same-object",
          label,
          `${label}:${p.startPosition.row + 1} duplicate key ${k.length === 0 ? '"" (empty)' : `"${k}"`} in one object`,
        )
      else {
        seen.add(k)
        objectsDeclaringKey.set(k, (objectsDeclaringKey.get(k) ?? 0) + 1)
      }
    }
  })
  for (const [k, objectsWithKey] of objectsDeclaringKey) {
    if (objectsWithKey > 1) {
      bump(probes, "overrides:same-key-different-objects", label, `${label}: key "${k}" declared in ${objectsWithKey} separate objects`)
    }
  }

  // ---- calls: npm script invoking a sibling script by name
  visitAll(root, (n) => {
    if (n.type !== "object") return
    const scripts: string[] = []
    for (let i = 0; i < n.namedChildCount; i++) {
      const p = n.namedChild(i)
      if (keyOf(p) !== "scripts") continue
      const scriptsObj = valueOf(p)
      if (scriptsObj?.type !== "object") continue
      for (let j = 0; j < scriptsObj.namedChildCount; j++) {
        const sp = scriptsObj.namedChild(j)
        const sk = keyOf(sp)
        if (sk) scripts.push(sk)
      }
    }
    if (scripts.length === 0) return
    const declared = new Set(scripts)
    for (let i = 0; i < n.namedChildCount; i++) {
      const p = n.namedChild(i)
      if (keyOf(p) !== "scripts") continue
      const scriptsObj = valueOf(p)
      if (scriptsObj?.type !== "object") continue
      for (let j = 0; j < scriptsObj.namedChildCount; j++) {
        const sp = scriptsObj.namedChild(j)
        const sk = keyOf(sp)
        const sv = valueOf(sp)
        if (!sk || sv?.type !== "string") continue
        const cmd = unquote(String(sv.text ?? ""))
        NPM_RUN.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = NPM_RUN.exec(cmd)) !== null) {
          const callee = m[1]
          if (declared.has(callee)) bump(probes, "calls:npm-run-sibling-script", label, `${label}:${sp.startPosition.row + 1} script "${sk}" -> npm run ${callee}`)
          else bump(probes, "calls:npm-run-undeclared-name", label, `${label}:${sp.startPosition.row + 1} script "${sk}" -> npm run ${callee} (not a key of scripts)`)
        }
      }
    }
  })

  // ---- instantiates: `new <Identifier>` inside strings, and whether that identifier
  //      is also declared as a key somewhere in the same file.
  //
  //      The key set must be THIS FILE's. The first version built it from the
  //      corpus-global `keyVocabulary` accumulator, which is correct in the narrow
  //      sense that it only grows, and quadratic in the wide one: it copied the whole
  //      accumulated vocabulary once per file, so the run's cost grew with
  //      (files x distinct keys) and it did not finish on the full population.
  //      `objectsDeclaringKey` above already holds exactly this file's keys.
  const allKeys = new Set(objectsDeclaringKey.keys())
  visitAll(root, (n) => {
    if (n.type !== "string") return
    const v = unquote(String(n.text ?? ""))
    if (!v.includes("new ")) return
    const re = /(?:^|[^A-Za-z0-9_$.])new\s+([A-Z][A-Za-z0-9_$]*)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(v)) !== null) {
      bump(probes, "instantiates:new-ident-in-string", label, `${label}:${n.startPosition.row + 1} new ${m[1]} (inside a string VALUE)`)
      if (allKeys.has(m[1])) bump(probes, "instantiates:new-ident-declared-as-key", label, `${label}:${n.startPosition.row + 1} new ${m[1]} and "${m[1]}" is a key in this file`)
    }
  })

  fileRowCounts[f.repo] ??= { bytes: 0, files: 0 }
  fileRowCounts[f.repo].bytes += text.length
  fileRowCounts[f.repo].files++
  tree.delete?.()
}

// ---------------------------------------------------------------- report
const out: any = {
  tool: "json lane construct probes",
  corpusRoot: CR,
  admittedPopulation: population.length,
  sampled: files.length,
  sampleMethod: LIMIT > 0 ? `deterministic prefix of (repo, git-path)-sorted population, first ${LIMIT}` : "whole admitted population",
  perRepo: fileRowCounts,
  parsedFiles,
  filesWithErrorOrMissingNodes: errorNodeFiles,
  grammarNodeTypes: Object.fromEntries([...nodeTypes.entries()].sort((a, b) => b[1] - a[1])),
  distinctKeyVocabulary: keyVocabulary.size,
  keyVocabularyTop: Object.fromEntries([...keyVocabulary.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => [k, v])),
  probes: {} as any,
  supertypeCandidateKeys: {} as any,
}

console.log(`json lane construct probes — population ${population.length}, sampled ${files.length}, parsed ${parsedFiles}`)
console.log(`grammar node types observed: ${nodeTypes.size} -> ${[...nodeTypes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`)
console.log(`distinct key vocabulary: ${keyVocabulary.size}`)
console.log("")
for (const [name, b] of probes.entries()) {
  out.probes[name] = { occurrences: b.occurrences, files: b.files.size, examples: b.examples }
  console.log(`${name.padEnd(42)}${String(b.occurrences).padStart(8)} occ  ${String(b.files.size).padStart(5)} files`)
  for (const e of b.examples.slice(0, 3)) console.log(`    ${e}`)
}
console.log("")
console.log("supertype-candidate keys (instrument A) — non-zero only:")
for (const [k, h] of Object.entries(supertypeKeyHits)) {
  out.supertypeCandidateKeys[k] = { occurrences: h.n, files: h.files.size, examples: h.examples }
  if (h.n > 0) {
    console.log(`  ${k.padEnd(24)}${String(h.n).padStart(8)} occ  ${String(h.files.size).padStart(5)} files`)
    for (const e of h.examples.slice(0, 2)) console.log(`      ${e}`)
  }
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${OUT}`)
}
