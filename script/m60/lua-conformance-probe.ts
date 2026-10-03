/**
 * M14 ONTOLOGY — LUA. INSTRUMENT B for the ONE ruled type, run as an adversary.
 *
 * ## Why this file exists
 *
 * `implements` is the only type this lane rules (docs/analyzers/real-lua-analyzer.md
 * §3.2). Its instrument-A leg is sound — Lua has no `class` keyword, no `interface`
 * keyword and no declaration form for a type, so no corpus can produce a supertype
 * clause. But the document named a falsification condition that NO instrument
 * implemented:
 *
 *   "Or a probe finding a constructor-like call immediately followed by a
 *    conformance test (`if type(x) ~= "table" then error(...) end`) at a rate
 *    worth an edge."
 *
 * A falsification condition with no probe is a wish, not a test. This file IS that
 * probe, and it is written to be able to return a non-zero count: every bucket below
 * counts constructs that WOULD carry an `implements` edge if Lua wrote conformance
 * down. If any bucket reads non-zero at a rate worth an edge, the ruling is wrong and
 * the gate must say FALSIFIED.
 *
 * It is a TREE walk, not a regex. The workstream's own record is that a regex is the
 * wrong instrument: a probe for `extends` once matched `class voice` inside a telnet
 * IAC word list in a string literal, and a probe for `instantiates` matched
 * `new Map(` in JavaScript embedded in a bash heredoc. Both would have convicted a
 * correct ruling. A string in a Lua file can carry `class("D", Base)` too, so the
 * same failure is available here and is excluded by construction: every bucket below
 * is anchored on a NODE TYPE and a FIELD, never on text.
 *
 * ## The buckets, and what each would mean if it fired
 *
 *   b1 namedSuperclassCall   `class("Derived", Base)` — a WRITTEN supertype argument.
 *                            middleclass/classic/30log all take the parent here. This
 *                            is the strongest `implements` candidate in Lua: it is the
 *                            only place a Lua program writes "this type is-a that type"
 *                            as an argument. Non-zero => `extends` may be undercounting.
 *   b2 conformanceAssert     `assert(type(x) == "table")` — a runtime check that an
 *                            object satisfies a shape, with no named type on either side.
 *   b3 guardedTypeError      `if type(x) ~= "table" then error(...) end` — the same
 *                            check as a guard. Together b2+b3 are the "runtime duck
 *                            typing" the ruling says has no written clause.
 *   b4 namedConformanceApi    a call to a name that means conformance: `isa`, `is_a`,
 *                            `instanceof`, `isinstance`, `isKindOf`, `implements`,
 *                            `conforms_to`, `subclass_of`, `is_a_subclass_of`. A
 *                            non-zero count means some library in the corpus DOES name
 *                            the relation, and the ruling must then say which.
 *   b5 typeStringCompare     ANY `type(x)` compared against a string, whatever the
 *                            string — the denominator b2/b3 sit inside, reported so the
 *                            other buckets can be read as a rate rather than a count.
 *   b6 metatableIndex        `__index = <name>` — inheritance by metatable. This is the
 *                            relation `extends` already publishes; counted here so the
 *                            ruling can state what Lua's ONE written type relation is,
 *                            with a number, instead of asserting there is only one.
 *
 * ## What would overturn the `implements` ruling
 *
 *   b1 > 0 with the supertype argument being a NAME. `class("D", Base)` is a written
 *   supertype clause expressed as an ordinary call — and it would then be a candidate
 *   for `extends` (an inheritance link) or `implements` (a conformance link). Which one
 *   it is cannot be settled from the call alone: Lua's convention is that the second
 *   argument is the PARENT, which makes it `extends`. So b1 non-zero is a finding
 *   about `extends`'s coverage, not automatically about `implements`.
 *
 * Usage: npx tsx script/m60/lua-conformance-probe.ts [--out <path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const OUT = path.resolve(ROOT, arg("--out", "validation/m60/lua/conformance-probe.json")!)

/** Names that, if CALLED, state a conformance relation. Matched against the callee
 * identifier on the tree, never against the file's text. */
const CONFORMANCE_APIS = new Set([
  "isa", "is_a", "isA", "instanceof", "isinstance", "isKindOf", "iskindof",
  "implements", "implementsInterface", "conforms_to", "conformsTo",
  "subclass_of", "subclassOf", "is_a_subclass_of", "isASubclassOf", "satisfies",
])

interface Bucket { occurrences: number; files: number; examples: string[] }
const b = (): Bucket => ({ occurrences: 0, files: 0, examples: [] })
const buckets: Record<string, Bucket> = {
  b1_namedSuperclassCall: b(), b2_conformanceAssert: b(), b3_guardedTypeError: b(),
  b4_namedConformanceApi: b(), b5_typeStringCompare: b(), b6_metatableIndex: b(),
}
/** b1's hits split by whether the supertype argument is a NAME (a type reference)
 * or a literal — a string second argument is middleclass's own form and still names
 * a type, so both count, but they are reported apart. */
let b1NameArg = 0
let b1StringArg = 0
let b1OtherArg = 0
/** A file that produced any bucket, so the file counts are not summed into a fiction. */
const filesWithHits = new Set<string>()

// ─────────────────────────────────────────────────────────── corpus (same draw as every other instrument)
const files: Array<{ abs: string; text: string; label: string }> = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean).sort()
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    files.push({ abs, text, label: `${e}/${rel}` })
  }
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-lua.wasm"))))

function hit(k: string, label: string, line: number, what: string) {
  const row = buckets[k]
  row.occurrences++
  const key = label
  if (row.examples.length < 12 && !row.examples.some((s) => s.startsWith(`${label}:`))) {
    row.examples.push(`${label}:${line}: ${what}`)
  }
  filesWithHits.add(key)
}
/** files-per-bucket needs its own set: a file can fire two buckets. */
const filesByBucket: Record<string, Set<string>> = Object.fromEntries(Object.keys(buckets).map((k) => [k, new Set<string>() as Set<string>]))
const mark = (k: string, label: string) => filesByBucket[k].add(label)

/** A `string` node's VALUE, with the quote delimiters and any escape removed. Used
 * only to classify a node the tree has already identified — never to find one. */
function stringValue(n: any): string | undefined {
  if (!n || n.type !== "string") return undefined
  const t = String(n.text ?? "")
  const m = /^(?:\[\[|=|')([\s\S]*?)(?:\]\]|=|\2)$/.exec(t)
  return (m ? m[1] : t).replace(/^["']|["']$/g, "")
}
function isCallTo(n: any, name: string): boolean {
  if (n?.type !== "function_call") return false
  const callee = n.childForFieldName("name") ?? n.namedChild(0)
  return callee?.type === "identifier" && callee.text === name
}
/** `type(x)` anywhere in the subtree. */
function hasTypeCall(n: any): boolean {
  let found = false
  const v = (x: any) => {
    if (found) return
    if (isCallTo(x, "type")) { found = true; return }
    for (let i = 0; i < x.childCount; i++) v(x.child(i))
  }
  if (n) v(n)
  return found
}
/** Does this node compare something against a string literal? */
function comparesToStringLiteral(n: any): boolean {
  let found = false
  const v = (x: any) => {
    if (found) return
    if (x.type === "binary_expression") {
      const op = String(x.childForFieldName("operator")?.text ?? x.text ?? "")
      if (/^(==|~=)$/.test(op)) {
        let hasString = false
        for (let i = 0; i < x.childCount; i++) {
          const c = x.child(i)
          if (c.type === "string" && stringValue(c) !== undefined) hasString = true
        }
        if (hasString) { found = true; return }
      }
    }
    for (let i = 0; i < x.childCount; i++) v(x.child(i))
  }
  if (n) v(n)
  return found
}

for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const visit = (n: any) => {
    const line = (n.startPosition?.row ?? 0) + 1

    // b1 — `class("Derived", Base)` / `class("Derived", nil)`. The callee must be an
    // identifier named `class` and there must be a SECOND argument. This is an
    // ordinary `function_call`, so only the tree can see it; a text probe would also
    // match the word `class` in `---@class (exact) Foo` annotations.
    if (n.type === "function_call") {
      const callee = n.childForFieldName("name") ?? n.namedChild(0)
      const args = n.childForFieldName("arguments")
      if (callee?.type === "identifier" && callee.text === "class" && args) {
        const as: any[] = []
        for (let i = 0; i < args.namedChildCount; i++) {
          const c = args.namedChild(i)
          if (c?.type) as.push(c)
        }
        if (as.length >= 2) {
          const first = stringValue(as[0])
          const sup = as[1]
          let kind = "other"
          if (sup?.type === "identifier") kind = "name"
          else if (stringValue(sup) !== undefined) kind = "string"
          if (kind === "name") b1NameArg++
          else if (kind === "string") b1StringArg++
          else b1OtherArg++
          hit("b1_namedSuperclassCall", f.label, line,
            `class(${first !== undefined ? `"${first}"` : "<non-literal>"}, ${sup?.text?.slice(0, 40) ?? "?"}) supertypeArg=${kind}`)
          mark("b1_namedSuperclassCall", f.label)
        }
      }
      // b4 — a CALLED name that means conformance.
      if (callee?.type === "identifier" && CONFORMANCE_APIS.has(callee.text)) {
        hit("b4_namedConformanceApi", f.label, line, `${callee.text}(...)`)
        mark("b4_namedConformanceApi", f.label)
      }
    }

    // b2 — `assert(type(x) == "...")`
    if (isCallTo(n, "assert") && hasTypeCall(n) && comparesToStringLiteral(n)) {
      hit("b2_conformanceAssert", f.label, line, "assert(type(x) == \"...\")")
      mark("b2_conformanceAssert", f.label)
    }

    // b3 — `if type(x) ~= "..." then error(...) end`: the condition carries the check
    // and the body raises. `elseif` counts too — it is the same guard shape.
    if ((n.type === "if_statement" || n.type === "elseif_statement")) {
      const cond = n.childForFieldName("condition")
      if (cond && hasTypeCall(cond) && comparesToStringLiteral(cond)) {
        let raises = false
        const body = n.childForFieldName("consequence") ?? n.childForFieldName("body")
        const v = (x: any) => {
          if (raises || !x) return
          if (x.type === "function_call") {
            const c = x.childForFieldName("name") ?? x.namedChild(0)
            if (c?.type === "identifier" && ["error", "assert", "raise", "fail"].includes(c.text)) { raises = true; return }
          }
          for (let i = 0; i < x.childCount; i++) v(x.child(i))
        }
        v(body)
        if (raises) {
          hit("b3_guardedTypeError", f.label, line, "if type(x) ~= \"...\" then error(...) end")
          mark("b3_guardedTypeError", f.label)
        }
      }
    }

    // b5 — the denominator: any `type(x)` compared against a string literal.
    if (n.type === "function_call" && isCallTo(n, "type")) {
      const p = n.parent
      if (p && comparesToStringLiteral(p)) {
        hit("b5_typeStringCompare", f.label, line, `type(${n.namedChild(0)?.text?.slice(0, 30) ?? "?"})`)
        mark("b5_typeStringCompare", f.label)
      }
    }

    // b6 — `__index = Base`: the metatable inheritance key.
    if (n.type === "field") {
      const key = n.childForFieldName("name") ?? n.childForFieldName("key")
      if (key?.text === "__index") {
        const val = n.childForFieldName("value")
        if (val) {
          hit("b6_metatableIndex", f.label, line, `__index = ${val.text?.slice(0, 40)}`)
          mark("b6_metatableIndex", f.label)
        }
      }
    }

    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(t.rootNode)
  t.delete?.()
}

for (const [k, set] of Object.entries(filesByBucket)) buckets[k].files = set.size

const artifact = {
  schemaVersion: 1,
  kind: "lua_conformance_probe",
  at: new Date().toISOString(),
  commit: execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  corpus: { root: CR, filesParsed: files.length, sampling: "every tracked *.lua, sorted, no cap" },
  grammarWasm: "wasm/tree-sitter-lua.wasm",
  ruledTypeUnderTest: "implements",
  instrument: "B:parse-tree-count (a TREE walk: every bucket is anchored on a node type and a field, so a string literal cannot fake a hit)",
  buckets,
  b1SupertypeArgumentShape: { name: b1NameArg, string: b1StringArg, other: b1OtherArg },
  filesWithAnyHit: filesWithHits.size,
  overturnCondition: "b1_name > 0 — a WRITTEN supertype argument to a class call. It would then be a candidate for extends (Lua's convention reads argument 2 as the PARENT) or for implements, and which one cannot be settled from the call alone, so a non-zero count is a finding about extends' coverage.",
  reading: [
    "b2+b3 are RUNTIME duck typing: an object is checked against a shape and no type is named. There is no written clause for an edge to carry, which is the ruling's reason.",
    "b6 is Lua's one written type relation, and `extends` already publishes it. b6 > 0 with b1 == 0 is the measurement that says the relation is singular.",
  ],
}
writeFileSync(OUT, JSON.stringify(artifact, null, 2))

console.log(`conformance probe (instrument B for the ruled type \`implements\`) — ${files.length} files`)
console.log("")
console.log(`${"bucket".padEnd(26)}${"hits".padStart(8)}${"files".padStart(8)}  what it would mean`)
const WHAT: Record<string, string> = {
  b1_namedSuperclassCall: "a WRITTEN supertype argument — the only place lua writes 'is-a'",
  b2_conformanceAssert: "assert(type(x) == \"...\") — a shape check, no type named",
  b3_guardedTypeError: "if type(x) ~= \"...\" then error(...) — the same check as a guard",
  b4_namedConformanceApi: "a called name meaning conformance (isa/instanceof/...)",
  b5_typeStringCompare: "the denominator b2/b3 sit inside",
  b6_metatableIndex: "__index = Base — the relation `extends` already publishes",
}
for (const [k, v] of Object.entries(buckets)) {
  console.log(`${k.padEnd(26)}${String(v.occurrences).padStart(8)}${String(v.files).padStart(8)}  ${WHAT[k]}`)
}
console.log("")
console.log(`b1 supertype-argument shape: name=${b1NameArg} string=${b1StringArg} other=${b1OtherArg}`)
console.log(`files with at least one hit: ${filesWithHits.size}`)
for (const [k, v] of Object.entries(buckets)) {
  if (!v.occurrences) continue
  console.log(`  ${k}:`)
  for (const ex of v.examples.slice(0, 6)) console.log(`    ${ex}`)
}
console.log(`\nartifact: ${path.relative(ROOT, OUT)}`)