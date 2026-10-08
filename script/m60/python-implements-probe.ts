#!/usr/bin/env bun
/**
 * INCOMING_PY — the `implements` decision instrument.
 *
 * The ontology has ten types; python's analyzer emits eight. This file decides
 * whether the ninth (`implements`) is a GAP or a RULED verdict, and it decides it
 * with counts rather than with an argument, because `overrides` was missing from
 * bash for a whole wave behind a prose justification and only measuring the
 * language found it.
 *
 * THREE CANDIDATE RULES, each measured, because "python has no implements keyword"
 * is prose and prose is what the workstream forbids:
 *
 *   R1  FIRST-BASE-IS-EXTENDS, REST-ARE-IMPLEMENTS.  The java/scala/kotlin family
 *       split, and python's grammar has nothing that supports it. The falsifier is
 *       concrete: how many multi-base classes put a CONCRETE BUILTIN CLASS in a
 *       non-first position? `class IntEnum(int, Enum)` would publish
 *       `implements IntEnum -> Enum` — and Enum is a real superclass with an
 *       implementation, not an interface.
 *
 *   R2  ABSTRACT-BASE / PROTOCOL MARKERS.  `class C(ABC)`, `class C(Protocol)`,
 *       `metaclass=ABCMeta`. Measurable, and a real fact about the language. The
 *       falsifier: does the SAME edge also have to be `extends`? If yes, `implements`
 *       is a second label on one fact, and the lane's own contract already says a
 *       second edge for the same fact doubles the graph without adding information.
 *
 *   R3  VIRTUAL REGISTRATION.  `SomeABC.register(MyClass)` — CPython's own
 *       `abc` documents this as "register C as a virtual subclass of ABC", and it
 *       is the ONE python construct that declares conformance WITHOUT inheriting,
 *       so it duplicates no `extends` edge. The falsifier is subtler than the other
 *       two: `register` is an ordinary method name. `atexit.register(cb)` is not
 *       interface conformance, and a syntactic probe cannot tell the two apart — so
 *       the count that matters is how many registrations name an ABC **declared in
 *       the same file**, which is the only case a one-file analyzer can decide.
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

type Src = { corpus: "fixtures" | "stdlib"; repo: string; rel: string; text: string }
function load(): Src[] {
  const out: Src[] = []
  for (const e of readdirSync(CR)) {
    const dir = path.join(CR, e)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    let tracked: string[]
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text: string
      try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
      if (detectLanguageFromPath(abs, text) !== "python") continue
      out.push({ corpus: "fixtures", repo: e, rel, text })
    }
  }
  const stack = [STDLIB]
  while (stack.length) {
    const d = stack.pop()!
    let entries: string[]
    try { entries = readdirSync(d) } catch { continue }
    for (const n of entries) {
      const abs = path.join(d, n)
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { if (!["test", "tests", "lib2to3", "__pycache__", "idlelib", "site-packages", "dist-packages"].includes(n)) stack.push(abs); continue }
      if (!n.endsWith(".py") || st.size > MAX_BYTES) continue
      let text: string
      try { text = readFileSync(abs, "utf8") } catch { continue }
      out.push({ corpus: "stdlib", repo: "cpython-stdlib", rel: path.relative(STDLIB, abs), text })
    }
  }
  return out
}
const files = load()

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-python.wasm"))))

/** A base class that certainly carries an implementation — R1's falsifier. */
const CONCRETE_BUILTIN = new Set(["int", "str", "float", "bool", "bytes", "bytearray", "list", "dict", "set", "frozenset", "tuple", "complex", "object", "Exception", "BaseException", "type"])
/** A base that is an interface BY SPELLING — measurable, and R2's whole content. */
const INTERFACE_BASE = new Set(["ABC", "ABCMeta", "Protocol", "Generic", "object"])

type Acc = Record<string, { sites: number; files: number; examples: string[] }>
const acc: Record<"fixtures" | "stdlib", Acc> = { fixtures: {}, stdlib: {} }
function hit(corpus: "fixtures" | "stdlib", key: string, label: string) {
  const a = acc[corpus]
  const row = a[key] ?? { sites: 0, files: 0, examples: [] }
  row.sites++
  const f = label.split(" @ ")[0]!
  if (!row.examples.some((e) => e.split(" @ ")[0] === f)) row.files++
  if (row.examples.length < 4) row.examples.push(label)
  a[key] = row
}

for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const tag = `${f.repo}/${f.rel}`
  // the classes THIS file declares, with their base leaves and whether an ABC marker is present
  const declared = new Map<string, { bases: string[]; isAbc: boolean }>()
  const v = (n: any) => {
    if (n.type === "class_definition") {
      const cn = n.namedChildren.find((c: any) => c.type === "identifier")?.text ?? "?"
      const args = n.namedChildren.find((c: any) => c.type === "argument_list")
      const bases: string[] = []
      let isAbc = false
      for (const a of args?.namedChildren ?? []) {
        if (a.type === "keyword_argument") {
          if (/metaclass/i.test(a.text) && /ABC/i.test(a.text)) isAbc = true
          continue
        }
        if (a.type === "identifier") bases.push(a.text)
        else if (a.type === "attribute") bases.push(a.namedChildren.at(-1)?.text ?? "")
        else if (a.type === "subscript") {
          const h = a.namedChildren[0]
          bases.push(h?.type === "identifier" ? h.text : (h?.namedChildren?.at(-1)?.text ?? ""))
        }
      }
      declared.set(cn, { bases, isAbc })
      hit(f.corpus, "classes", `${tag}: class ${cn}(${bases.join(", ")})`)
      if (bases.length > 1) {
        hit(f.corpus, "R1:multi-base-class", `${tag}: class ${cn}(${bases.join(", ")})`)
        for (let i = 1; i < bases.length; i++) {
          const b = bases[i]!
          if (CONCRETE_BUILTIN.has(b)) hit(f.corpus, "R1:non-first-base-is-a-CONCRETE-class", `${tag}: class ${cn}(${bases.join(", ")}) -> ${b}`)
          if (INTERFACE_BASE.has(b)) hit(f.corpus, "R1:non-first-base-is-an-interface-marker", `${tag}: class ${cn}(${bases.join(", ")}) -> ${b}`)
          else if (/^[A-Z]/.test(b)) hit(f.corpus, "R1:non-first-base-is-an-ordinary-class", `${tag}: class ${cn}(${bases.join(", ")}) -> ${b}`)
        }
      }
      // R2 — an interface-primitive base. The edge this would publish is ALSO an
      // `extends` edge today, which is the point: record both facts.
      if (bases.some((b) => INTERFACE_BASE.has(b))) hit(f.corpus, "R2:interface-primitive-base", `${tag}: class ${cn}(${bases.join(", ")})`)
      if (isAbc) hit(f.corpus, "R2:ABCMeta-metaclass-keyword", `${tag}: class ${cn}(metaclass=ABC...)`)
    }
    if (n.type === "call") {
      const fn = n.childForFieldName?.("function") ?? n.namedChildren[0]
      if (fn?.type === "attribute" && fn.namedChildren.at(-1)?.text === "register") {
        const recv = fn.namedChildren[0]
        const args = n.childForFieldName?.("arguments")
        const first = args?.namedChildren?.[0]
        if (recv?.type === "identifier" && first) {
          hit(f.corpus, "R3:register-call", `${tag} @ L${n.startPosition.row + 1}: ${fn.text}(${first.text})`)
          const d = declared.get(recv.text)
          if (d) {
            hit(f.corpus, "R3:receiver-declared-in-this-file", `${tag} @ L${n.startPosition.row + 1}: ${fn.text}(${first.text})`)
            const abcish = d.isAbc || d.bases.some((b) => INTERFACE_BASE.has(b))
            if (abcish) hit(f.corpus, "R3:GATED-ABC-register-declared-in-file", `${tag} @ L${n.startPosition.row + 1}: ${fn.text}(${first.text})`)
            else hit(f.corpus, "R3:receiver-declared-but-NOT-an-ABC", `${tag} @ L${n.startPosition.row + 1}: ${fn.text}(${first.text})`)
          } else {
            hit(f.corpus, "R3:receiver-NOT-declared-in-this-file", `${tag} @ L${n.startPosition.row + 1}: ${fn.text}(${first.text})`)
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) v(n.namedChildren[i])
  }
  v(t.rootNode)
  t.delete?.()
}

console.log("INCOMING_PY — implements decision instrument")
console.log(`fixtures ${acc.fixtures.classes ? [...Object.values(acc.fixtures)].reduce((a, b) => a + b.sites, 0) : 0} node hits   stdlib likewise\n`)
for (const corpus of ["fixtures", "stdlib"] as const) {
  console.log(`--- ${corpus} ---`)
  const keys = Object.keys(acc[corpus]).sort()
  for (const k of keys) {
    const r = acc[corpus][k]!
    console.log(`  ${k.padEnd(50)} sites=${String(r.sites).padStart(6)}  files=${String(r.files).padStart(5)}   e.g. ${r.examples[0] ?? ""}`)
  }
  console.log("")
}
const at = process.argv.indexOf("--json")
if (at > 0) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(process.argv[at + 1], JSON.stringify(acc, null, 2))
}