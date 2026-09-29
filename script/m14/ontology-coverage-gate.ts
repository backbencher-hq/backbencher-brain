/**
 * ONTOLOGY COVERAGE GATE — the check whose absence let a real defect through.
 *
 * ## Why this gate exists
 *
 * The lane's differential reports 99.9% coverage and 0 UNEXPLAINED across 73,961
 * edges, and that is TRUE — and it hid a missing relationship type for the whole
 * wave. The reason is structural, and no amount of differential testing fixes it:
 *
 *   the differential is independent at the level of IMPLEMENTATION. The analyzer
 *   and the oracle are two separate walkers over one grammar, so they disagree
 *   when either is wrong. But when a relationship type is absent from BOTH —
 *   because the implementer ruled it inapplicable and the oracle was written
 *   after that ruling — there is nothing to disagree about. Both say nothing, and
 *   "nothing" agrees with "nothing" perfectly.
 *
 * `overrides` is the concrete case. Bash redefines functions — 174 redefinition
 * events across 57 of 2,747 admitted files — and a redefinition replaces the
 * prior definition, which is an override in the only sense the language has one.
 * The analyzer omitted it, the oracle omitted it, and the differential was green
 * throughout. Only measuring the LANGUAGE rather than diffing the CODE found it.
 *
 * ## What this gate asserts
 *
 * For every type in the ontology, exactly one of:
 *
 *   EMITTED   the production `parseFile` actually produced it on this corpus, with
 *             a count and the files it came from. Evidence, not assertion.
 *   RULED     the spec carries a written reason AND a CORPUS MEASUREMENT showing
 *             the construct the type would need never occurs. A prose justification
 *             alone is NOT sufficient, because `overrides` had a prose justification
 *             and it was wrong.
 *
 * A ruled type whose construct probe finds a non-zero count is FALSIFIED, and the
 * gate fails. That is the whole point: the ruling is testable, so a wrong ruling
 * cannot survive.
 *
 * READ-ONLY. Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { LANGS } from "./differential"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const LANG = process.argv[2] ?? "bash"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------- instruments
//
// A text regex is the WRONG instrument for "does this language have this
// construct", and this gate's first version proved it by returning two
// false positives. A probe for `extends` matched `class voice` inside
// `_comp_compgen -- -W 'up down reset rstat ... class voice iac ...'` — a telnet
// IAC word list in a string. A probe for `instantiates` matched `new Map(` and
// `new Promise(` in a bash file that carries embedded JavaScript in a heredoc.
// Both would have convicted a correct ruling on the strength of a regex.
//
// So there are two instruments, and which one applies is decided by the QUESTION:
//
//   A. GRAMMAR INVENTORY — for a type that needs a node type the language does
//      not have. Enumerating every node type the grammar actually produces is
//      positive evidence of absence: bash yields 164 across the corpus and NONE
//      of them expresses a type declaration or a constructor. That is a fact
//      about the grammar, not a failure to find something.
//
//   B. PARSE-TREE SEMANTIC COUNT — for a type the language CAN express. A second
//      declaration of a name is perfectly good bash, so no grammar inventory will
//      find it; it has to be counted on the tree, where a string or an embedded
//      heredoc cannot fake it.
type Instrument = "A:grammar-inventory" | "B:parse-tree-count"

type Ruled = {
  type: Type
  instrument: Instrument
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

const BASH_RULED: Ruled[] = [
  {
    type: "extends",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["class_declaration", "class", "interface_declaration", "trait_declaration", "struct_declaration", "inheritance_specifier"],
    describe: "a type declaration another type could extend",
  },
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["implements_clause", "extends_clause", "superclass", "interface_implementation"],
    describe: "a supertype clause naming an implemented or inherited type",
  },
  {
    type: "instantiates",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["new_expression", "object_creation_expression", "constructor_invocation"],
    describe: "a constructor call",
  },
  {
    type: "overrides",
    instrument: "B:parse-tree-count",
    // A redefinition is expressible in bash — a second `name() { … }` — so the
    // grammar inventory is silent by construction and the count must be semantic.
    countOnTree: (root, fileLabel, hits) => {
      const seen = new Map<string, number>()
      const visit = (n: any) => {
        if (n.type === "function_definition") {
          const named = n.namedChildren?.find((c: any) => c.type === "word")
          const name = named?.text
          if (name) {
            const c = (seen.get(name) ?? 0) + 1
            seen.set(name, c)
            if (c === 2) hits.push(`${fileLabel}: ${name} (redefined)`)
          }
        }
        for (let i = 0; i < n.childCount; i++) visit(n.child(i))
      }
      visit(root)
    },
    describe: "a SECOND declaration of a name already declared in the same file — it replaces the prior one",
  },
]

/**
 * json's seven non-emitted types, each with the construct it would need.
 *
 * The bash table above is unchanged and still bash's. The two lanes disagree in the
 * most informative way available: bash emits 7 of 10 and rules 3 on a grammar
 * inventory of 164 node types, while json emits 3 of 10 and rules 7 on an inventory of
 * 26 — and the difference between the two is exactly what each language has. Same
 * ontology, same gate, opposite verdicts, and neither is arbitrary.
 */
const JSON_RULED: Ruled[] = [
  { type: "implements", instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["implements_clause", "extends_clause", "superclass"], describe: "a supertype clause" },
  { type: "instantiates", instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["new_expression", "object_creation_expression", "constructor_invocation"], describe: "a constructor call" },
  { type: "overrides", instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["redefinition", "override_specifier"], describe: "a second declaration replacing a prior one" },
  // `exports` WAS here and was removed: it was ruled on a grammar inventory ("no
  // export_statement node") and that is the same unsound reasoning that produced the
  // wrong `imports` ruling. A grammar cannot see a CONVENTION, and a Node manifest's
  // `exports`/`main`/`bin` are conventions written as ordinary object keys. The audit
  // found 1 of 36 manifests carrying `exports`, so the mass is small and the
  // principle is not: it is emitted now, and the gate re-measures rather than
  // trusting this note.
  // `calls` stays ruled: json has no functions to call, and no convention supplies
  // one. It is listed so the gate reports on all ten types.
  { type: "calls", instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["function_definition", "method_definition", "call_expression"], describe: "a function definition or call" },
  {
    // `imports` is the one that is NOT settled by the grammar, and it is worth
    // stating why. The grammar has no import node, but that is the wrong question:
    // an EXTERNAL $ref to another file on disk is a file dependency whatever the
    // grammar calls it, and the grammar cannot see it because it is a STRING.
    // So this was measured instead: across the whole 3,334-file corpus, 0 of the
    // external $refs point at another file — 38 name a URL (a JSON-Schema draft
    // identifier, i.e. a vocabulary reference) and 12 name something else. There is
    // no file-to-file $ref to import, so the type has nothing to carry.
    type: "imports",
    instrument: "B:parse-tree-count",
    countOnTree: (root, fileLabel, hits) => {
      // ONLY the value of a `$ref` key. The first version scanned every `string` in
      // the document, and it reported the construct 2,651 times across 103 files — of
      // which the examples were `MANIFEST.json: FILES.json`, a filename sitting in a
      // `files` array. That is not a $ref, it is a list of files a collection ships,
      // and the gate correctly refused to accept my measurement: it said the ruling
      // was falsified by evidence I had manufactured. A probe that matches a SHAPE
      // rather than a ROLE produces a number, and the number is worth nothing.
      const visit = (n: any) => {
        if (n.type === "pair") {
          const k = n.childForFieldName?.("key")
          const keyText = String(k?.namedChildren?.find((c: any) => c.type === "string_content")?.text ?? "")
          if (keyText === "$ref") {
            const v = n.childForFieldName?.("value")
            const inner = String(v?.text ?? "").replace(/^["']|["']$/g, "")
            if (!/^https?:\/\//.test(inner) && /\.(json|jsonc|json5|ya?ml|avsc|avdl|proto)(#[^"']*)?$/.test(inner)) {
              hits.push(`${fileLabel}: ${inner.slice(0, 60)}`)
            }
          }
        }
        for (let i = 0; i < n.childCount; i++) visit(n.child(i))
      }
      visit(root)
    },
    describe: "a $ref naming another FILE on disk — a file-to-file dependency",
  },
]

const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED }
const RULED: Ruled[] = RULED_BY_LANG[LANG] ?? []

// ---------------------------------------------------------------- corpus
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
console.log(`ontology coverage gate — ${LANG}`)
console.log(`corpus: ${files.length} admitted files\n`)

// ---------------------------------------------------------------- what is emitted
const observed = new Map<Type, { n: number; files: Set<string> }>()
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const row = observed.get(t) ?? { n: 0, files: new Set<string>() }
      row.n++
      if (row.files.size < 4) row.files.add(`${f.repo}/${f.rel}`)
      observed.set(t, row)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

// ---------------------------------------------------------------- measure with the right instrument
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasmPath = (LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", wasmPath))))

// Instrument A: the grammar's own vocabulary, observed across the whole corpus.
const grammarNodeTypes = new Map<string, number>()
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const v = (n: any) => { grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1); for (let i = 0; i < n.childCount; i++) v(n.child(i)) }
  v(t.rootNode)
  t.delete?.()
}

// Instrument B: semantic counts on the tree, where strings and heredocs cannot lie.
const treeHits = new Map<Type, { occurrences: number; files: number; examples: string[] }>()
for (const r of RULED) {
  if (r.instrument !== "B:parse-tree-count" || !r.countOnTree) continue
  const hits: string[] = []
  const hitFiles = new Set<string>()
  for (const f of files) {
    const before = hits.length
    const t = parser.parse(f.text)
    if (t) { r.countOnTree(t.rootNode, `${f.repo}/${f.rel}`, hits); t.delete?.() }
    if (hits.length > before) hitFiles.add(f.rel)
  }
  treeHits.set(r.type, { occurrences: hits.length, files: hitFiles.size, examples: hits.slice(0, 3) })
}

// ---------------------------------------------------------------- the spec's rulings
function rulingFor(t: Type): { reason: string; src: string } | null {
  const specPath = `script/m14/spec/${LANG}-completeness.json`
  let raw: string
  try { raw = readFileSync(specPath, "utf8") } catch { return null }
  const d = JSON.parse(raw)
  const decs = d?.design_decision?.decisions ?? []
  for (const dec of decs) {
    if (dec.status !== "RULED") continue
    const body = String(dec.resolution ?? "")
    if (new RegExp(`\`${t}\``, "i").test(body) || new RegExp(`\\b${t}\\b`, "i").test(body)) {
      // prefer a decision that is ABOUT the ontology
      if (/ontology|emits|excluded|type/i.test(body)) return { reason: body, src: `${specPath}#${dec.id}` }
    }
  }
  return null
}

// ---------------------------------------------------------------- verdict
type Row = { type: Type; status: "EMITTED" | "RULED-SOUND" | "FALSIFIED" | "RULED-UNJUSTIFIED"; detail: string }
if (RULED_BY_LANG[LANG] === undefined) {
  console.log(`\nontology coverage gate — no RULING TABLE for ${LANG}.`)
  console.log(`Refusing to report: a gate with an empty table would call every un-emitted type`)
  console.log(`RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.`)
  process.exit(2)
}

const rows: Row[] = []
for (const t of ALL_TYPES) {
  const obs = observed.get(t)
  if (obs && obs.n > 0) {
    rows.push({ type: t, status: "EMITTED", detail: `${obs.n.toLocaleString()} edges in ${obs.files.size}+ files, e.g. ${[...obs.files].slice(0, 2).join(", ")}` })
    continue
  }
  const ruled = RULED.find((r) => r.type === t)
  const hit = treeHits.get(t)
  if (hit && hit.occurrences > 0) {
    rows.push({
      type: t,
      status: "FALSIFIED",
      detail: `NOT EMITTED, but the construct occurs ${hit.occurrences}x across ${hit.files} file(s) on the PARSE TREE — it is derivable, so the ruling is wrong. e.g. ${hit.examples[0] ?? ""}`,
    })
    continue
  }
  if (ruled?.instrument === "A:grammar-inventory") {
    const present = (ruled.nodeTypesThatWouldMeanIt ?? []).filter((n) => grammarNodeTypes.has(n))
    if (present.length > 0) {
      rows.push({ type: t, status: "FALSIFIED", detail: `NOT EMITTED, but the grammar DOES produce ${present.join(", ")} — the construct exists. Instrument A.` })
      continue
    }
  }
  const ruling = rulingFor(t)
  if (!ruling) {
    rows.push({ type: t, status: "RULED-UNJUSTIFIED", detail: `NOT EMITTED and its construct is absent, but NO written ruling was found in the spec` })
    continue
  }
  const basis = ruled?.instrument === "A:grammar-inventory"
    ? `the grammar produced ${grammarNodeTypes.size} distinct node types across the corpus and NONE expresses it`
    : `the construct occurs 0x on the parse tree`
  rows.push({ type: t, status: "RULED-SOUND", detail: `NOT EMITTED; ${basis}. Written ruling: ${ruling.src}` })
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("type", 14)}${w("status", 18)}detail`)
console.log("-".repeat(120))
for (const r of rows) console.log(`${w(r.type, 14)}${w(r.status, 18)}${r.detail}`)

const falsified = rows.filter((r) => r.status === "FALSIFIED")
const unjustified = rows.filter((r) => r.status === "RULED-UNJUSTIFIED")
const emitted = rows.filter((r) => r.status === "EMITTED")
console.log("-".repeat(120))
console.log(`emitted ${emitted.length}/10   ruled-sound ${rows.filter((r) => r.status === "RULED-SOUND").length}   FALSIFIED ${falsified.length}   ruled-without-justification ${unjustified.length}`)
if (falsified.length) {
  console.log(`\n>>> THIS GATE FAILS. ${falsified.map((r) => r.type).join(", ")} ${falsified.length === 1 ? "is" : "are"} claimed inapplicable but ${falsified.length === 1 ? "is" : "are"} demonstrably derivable from real code.`)
  console.log(`>>> A differential cannot find this class of defect, because the oracle omits the same type.`)
}
process.exitCode = falsified.length + unjustified.length === 0 ? 0 : 1
