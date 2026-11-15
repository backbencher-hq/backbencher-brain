/**
 * JSON LANE PROBE — INHERITANCE STATED AS ORDINARY KEYS.
 *
 * ## What this found, and why it is not a shape match
 *
 * `implements` was RULED for this lane on instrument A — "the grammar produced 20 distinct
 * node types across the corpus and NONE expresses it" — and `extends` was EMITTED from
 * `allOf` alone. Both were re-tested here against the corpus, and the corpus says
 * otherwise:
 *
 *   dart-sdk/third_party/pkg/language_server_protocol/lsp_meta_model.json
 *     "structures": 387 entries. 66 declare
 *       "extends": [{"kind": "reference", "name": "TextDocumentPositionParams"}]
 *     and 87 declare
 *       "mixins":  [{"kind": "reference", "name": "WorkDoneProgressParams"}, …]
 *
 *   duckdb/src/include/duckdb/storage/serialization/constraint.json
 *     { "class": "NotNullConstraint", "base": "Constraint", "constructor": ["index"] }
 *
 * LSP's meta-model is the Language Server Protocol's own serialisation of its type
 * declarations, and `extends` there means what `extends` means in a class declaration.
 * `mixins` names the TypeScript INTERFACES a class mixes in, which is `implements` and
 * nothing else. duckdb's file is a serialisation schema for C++ classes: `class` declares
 * the type, `base` names its superclass, and every superclass it names is declared in the
 * same file.
 *
 * The gate's own header records why this is the expected failure: a ruling made on a
 * grammar inventory asks what the PARSER can express, and this lane has retracted five
 * rulings for asking it. The keys are ordinary `pair` keys, so a grammar has no node type
 * for them, exactly as it has none for a manifest's `exports` field.
 *
 * ## Why this probe cannot be fooled by a shape
 *
 * Every hit below is decided by a ROLE, not by a spelling:
 *
 *   - the string must be the VALUE of a `pair` KEY (`name`, `class`, `type`), never a
 *     free-text occurrence;
 *   - a reference is an OBJECT with `kind` == "reference" and a `name` string — LSP's own
 *     discriminated union for "this is a named type", as distinct from `{"kind":"or"}` and
 *     `{"kind":"array","element":…}`. A prose sentence cannot produce that pair;
 *   - the named type must be DECLARED in the same document (a `name`/`class`/`type` string
 *     value elsewhere in the file). A reference to something the document never declares is
 *     counted separately, because it cannot be an edge between two symbols in this file.
 *
 * `instantiates` is probed here too, and the answer is the useful one: duckdb's schema
 * DECLARES constructors (`"constructor": ["index"]`, the parameter names), which is the
 * opposite of a construction. A declaration is not a call, so the ruling stands on
 * evidence rather than on a grammar inventory — and the number that would overturn it is
 * named.
 *
 * Usage: npx tsx validation/m14/fixtures/json/inheritance-probe.ts [--limit N] [--stride N] [--out f.json]
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
const STRIDE = Number(argOf("--stride", "0"))
const OUT = argOf("--out", "")

const population: { repo: string; dir: string; rel: string; abs: string }[] = []
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
const files = STRIDE > 0 ? population.filter((_, i) => i % STRIDE === 0) : LIMIT > 0 ? population.slice(0, LIMIT) : population

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new Parser()
parser.setLanguage(await Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))))

const unquote = (t: string): string => {
  const v = t.trim()
  return v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v
}
const keyOf = (pair: any): string | null => {
  if (pair?.type !== "pair") return null
  const k = pair.childForFieldName?.("key")
  if (!k) return null
  const c = k.namedChildren?.find((x: any) => x.type === "string_content")
  return c ? String(c.text ?? "") : unquote(String(k.text ?? ""))
}
const valueOf = (pair: any): any => pair?.childForFieldName?.("value")
/** The string VALUE of a pair, or null when the value is not a string. */
const stringValue = (pair: any): string | null => {
  const v = valueOf(pair)
  return v?.type === "string" ? unquote(String(v.text ?? "")) : null
}
const pairsOf = (obj: any): any[] => (obj?.namedChildren ?? []).filter((c: any) => c.type === "pair")
/** LSP's reference literal: an object with `kind` == "reference" and a `name` string. */
const referenceName = (node: any): string | null => {
  if (node?.type !== "object") return null
  const byKey = new Map<string, any>()
  for (const p of pairsOf(node)) byKey.set(keyOf(p) ?? "", p)
  if (stringValue(byKey.get("kind") ?? {}) !== "reference") return null
  return stringValue(byKey.get("name") ?? {})
}

type Bucket = { n: number; files: Set<string>; examples: string[] }
const bump = (m: Map<string, Bucket>, k: string, file: string, ex: string) => {
  const b = m.get(k) ?? { n: 0, files: new Set<string>(), examples: [] }
  b.n++
  b.files.add(file)
  if (b.examples.length < 6) b.examples.push(ex)
  m.set(k, b)
}
const serialise = (m: Map<string, Bucket>) =>
  Object.fromEntries([...m.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, { occurrences: v.n, files: v.files.size, examples: v.examples }]))

/** The keys that DECLARE a type by string value, and the keys that NAME a supertype. */
const DECLARING_KEYS = ["name", "class", "typeName"]
const INHERITANCE_KEYS = ["extends", "base", "parent", "superclass", "superClass", "inherits", "inheritsFrom", "derivedFrom"]
const MIXIN_KEYS = ["mixins", "implements", "implementsInterfaces"]

const hits = new Map<string, Bucket>()
/** `name`/`class`/`typeName` string values per key — the blast radius of naming a
 *  declaration by its VALUE, which is what an edge between two declared types needs. */
const declaringKeys = new Map<string, Bucket>()
/** Constructor DECLARATIONS, counted because they are the near-miss for `instantiates`. */
const constructorDecls = new Map<string, Bucket>()

let parsed = 0
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
  parsed++

  // Pass 1 — every type DECLARED in this document, by name, with the path of the pair
  // that declares it. Two documents can declare the same name, so the value is a list.
  const declaredAt = new Map<string, string[]>()
  const declarePaths: string[] = []
  const stack: any[] = [tree.rootNode]
  const pathOf = new Map<any, string>()
  // A two-pass walk: paths need parent links, which tree-sitter gives, so recompute a
  // path for a node by walking up and reading each pair's key.
  const qualPath = (node: any): string => {
    const parts: string[] = []
    let cur = node
    while (cur) {
      const p = cur.parent
      if (!p) break
      if (p.type === "pair") {
        const v = p.childForFieldName?.("value")
        if (v === cur) {
          parts.unshift(keyOf(p) ?? "")
        } else {
          const arr = p.parent
          if (arr?.type === "array") {
            const items = (arr.namedChildren ?? []).filter((c: any) => c.type !== "[")
            parts.unshift(`[${items.indexOf(cur)}]`)
          }
        }
      } else if (p.type === "array") {
        const gp = p.parent
        if (gp?.type === "pair" && gp.childForFieldName?.("value") === p) parts.unshift(`${keyOf(gp) ?? ""}[]`)
        else {
          const ggp = gp?.parent
          if (ggp?.type === "array") {
            const items = (ggp.namedChildren ?? []).filter((c: any) => c.type !== "[")
            parts.unshift(`[${items.indexOf(p)}]`)
          } else parts.unshift("[]")
        }
      }
      cur = p
    }
    return parts.join(".")
  }

  while (stack.length) {
    const n = stack.pop()
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
    if (n.type !== "pair") continue
    const k = keyOf(n)
    if (k === null) continue
    const sv = stringValue(n)
    if (sv === null) continue
    if (DECLARING_KEYS.includes(k)) {
      bump(declaringKeys, `key "${k}" with a string value`, label, `${label}:${n.startPosition.row + 1} ${k}: ${sv.slice(0, 50)}`)
      const list = declaredAt.get(sv) ?? []
      list.push(qualPath(n))
      declaredAt.set(sv, list)
    }
    if (k === "constructor" || k === "__init__" || k === "new") {
      const v = valueOf(n)
      const role = v?.type === "array" ? "array (parameter names — a DECLARATION)" : v?.type === "object" ? "object" : v?.type === "string" ? "string" : "scalar"
      bump(constructorDecls, `key "${k}" -> ${role}`, label, `${label}:${n.startPosition.row + 1}`)
    }
  }
  declarePaths.push(...declaredAt.keys())

  // Pass 2 — the inheritance statements, with the target checked against pass 1.
  const stack2: any[] = [tree.rootNode]
  while (stack2.length) {
    const n = stack2.pop()
    for (let i = n.childCount - 1; i >= 0; i--) stack2.push(n.child(i))
    if (n.type !== "object") continue
    const pairs = pairsOf(n)
    const byKey = new Map<string, any>()
    for (const p of pairs) byKey.set(keyOf(p) ?? "", p)
    // The DECLARING object's own name — the thing that inherits.
    let selfName: string | null = null
    for (const dk of DECLARING_KEYS) {
      const sv = stringValue(byKey.get(dk) ?? {})
      if (sv !== null) { selfName = sv; break }
    }
    if (selfName === null) continue
    const selfPath = qualPath(byKey.get(DECLARING_KEYS.find((dk) => stringValue(byKey.get(dk) ?? {}) !== null)!)!)
    for (const k of [...INHERITANCE_KEYS, ...MIXIN_KEYS]) {
      const p = byKey.get(k)
      if (!p) continue
      const v = valueOf(p)
      const isMixin = MIXIN_KEYS.includes(k)
      const where = `${label}:${n.startPosition.row + 1} "${selfName}" ${k}`
      if (v?.type === "array") {
        for (const item of (v.namedChildren ?? []).filter((c: any) => c.type !== "[")) {
          const ref = referenceName(item)
          if (ref === null) {
            bump(hits, `${isMixin ? "implements" : "extends"}: array element that is NOT a {"kind":"reference"} literal`, label, `${where} -> <${item.type}>`)
            continue
          }
          const declared = declaredAt.get(ref)
          bump(hits, `${isMixin ? "implements" : "extends"}: ${k} -> declared type "${ref}"`, label, `${where} -> ${ref}`)
          if (!declared) bump(hits, `${isMixin ? "implements" : "extends"}: ${k} -> "${ref}" NOT declared in this document`, label, `${where} -> ${ref}`)
        }
        continue
      }
      const sv = stringValue(p)
      if (sv === null) {
        bump(hits, `${isMixin ? "implements" : "extends"}: ${k} with a non-string value`, label, `${where} -> <${v?.type ?? "absent"}>`)
        continue
      }
      const declared = declaredAt.get(sv)
      bump(hits, `${isMixin ? "implements" : "extends"}: ${k} -> declared type "${sv}"`, label, `${where} -> ${sv}`)
      if (!declared) bump(hits, `${isMixin ? "implements" : "extends"}: ${k} -> "${sv}" NOT declared in this document`, label, `${where} -> ${sv}`)
    }
  }
  tree.delete?.()
}

const out: any = {
  tool: "json lane inheritance probe (extends / implements / instantiates, by KEY ROLE)",
  corpusRoot: CR,
  admittedPopulation: population.length,
  sampled: files.length,
  sampleMethod: STRIDE > 0 ? `every ${STRIDE}th file of the (repo, git-path)-sorted admitted population` : LIMIT > 0 ? `deterministic prefix, first ${LIMIT}` : "whole admitted population",
  parsedFiles: parsed,
  declaringKeys: serialise(declaringKeys),
  constructorDeclarations: serialise(constructorDecls),
  inheritance: serialise(hits),
}
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2))

console.log(`json lane inheritance probe — population ${population.length}, sampled ${files.length}, tree-parsed ${parsed}`)
console.log("")
console.log("=== keys that DECLARE a type by string value (blast radius) ===")
for (const [k, b] of [...declaringKeys.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k.padEnd(44)}${String(b.n).padStart(8)} occ ${String(b.files.size).padStart(5)} files`)
  for (const e of b.examples.slice(0, 3)) console.log(`      ${e}`)
}
console.log("")
console.log("=== inheritance / mixin statements, by KEY ROLE and target resolution ===")
for (const [k, b] of [...hits.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k.padEnd(74)}${String(b.n).padStart(8)} occ ${String(b.files.size).padStart(5)} files`)
  for (const e of b.examples.slice(0, 3)) console.log(`      ${e}`)
}
console.log("")
console.log("=== constructor DECLARATIONS (the near-miss for `instantiates`) ===")
for (const [k, b] of [...constructorDecls.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k.padEnd(60)}${String(b.n).padStart(8)} occ ${String(b.files.size).padStart(5)} files`)
  for (const e of b.examples.slice(0, 2)) console.log(`      ${e}`)
}
if (OUT) console.log(`\nwrote ${OUT}`)