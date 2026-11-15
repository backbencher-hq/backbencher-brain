/**
 * R LANE — INSTRUMENT B for the two object-system types the corpus did not fire:
 * `overrides` and `instantiates`.
 *
 * The census measured 0 edges of both through production `parseFile`. That is a
 * measurement of the OUTPUT, and the workstream's own header is explicit that an
 * output measurement cannot decide a verdict: the question is whether the
 * CONSTRUCT occurs. So this counts the construct on the parse tree, with no
 * reference to the analyzer's own logic — a second derivation from the grammar,
 * written to be disagreeable.
 *
 * `overrides` — R's override construct. Three object systems can express it:
 *
 *   R6   R6Class("D", inherit = B, public = list(f = function() 1))
 *        B declared in the SAME FILE, and B also declares `f`.
 *   R5   setRefClass("D", contains = "B", methods = list(f = function() 1))
 *   S4   setMethod("f", "D", ...) where a method for "f" and base "B" exists.
 *
 * The analyzer's rule is FILE-SCOPED (a base that lives in another package cannot
 * be resolved from syntax), so the probe measures BOTH the file-scoped count --
 * which is what the analyzer can reach -- and the package-scoped count, so the
 * size of what a same-file rule necessarily leaves out is a number and not an
 * adjective.
 *
 * `instantiates` — the analyzer emits it only for `Declared$new()` and
 * `new("Declared")` where `Declared` is a class declared in the same file. The
 * probe counts both the same-file occurrences and the total occurrences, so the
 * gate is visible.
 *
 * USAGE: npx tsx validation/m14/fixtures/r/probe-classes.ts [--sample N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const SAMPLE_PER_REPO = Number(argOf("--sample") ?? 250)

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
const repos: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const admitted: typeof files = []
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
  if (admitted.length === 0) continue
  repos.push(e)
  files.push(...admitted.slice(0, SAMPLE_PER_REPO))
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-r.wasm"))))

type Hit = { kind: string; label: string; detail: string }
const hits: Hit[] = []
const bump = (kind: string, label: string, detail: string) => hits.push({ kind, label, detail })
const tally = new Map<string, { n: number; files: Set<string>; examples: string[] }>()
const record = (kind: string, label: string, detail: string) => {
  let t = tally.get(kind)
  if (!t) { t = { n: 0, files: new Set(), examples: [] }; tally.set(kind, t) }
  t.n++
  t.files.add(label)
  if (t.examples.length < 4) t.examples.push(`${label} :: ${detail}`)
}

const CLASS_CONSTRUCTORS = new Set(["R6Class", "setRefClass", "new_class", "new_base_class", "setClass"])
const MEMBER_LIST_ARGS: Record<string, string[]> = {
  R6Class: ["public", "private", "active"],
  setRefClass: ["fields", "methods"],
}

/** Bare name of an expression node, when the expression IS a name. */
const bareName = (n: any | null): string | null => {
  if (!n) return null
  // Backtick quoting is R's own escape for a reserved word used as a name
  // (`` `if` ``). Stripped by index, not by pattern: this lane carries no regex.
  if (n.type === "identifier") return n.text.length > 1 && n.text.startsWith("`") && n.text.endsWith("`") ? n.text.slice(1, -1) : n.text
  if (n.type === "string") {
    const c = n.childForFieldName("content") ?? n.namedChildren.find((x: any) => x.type === "string_content")
    return c ? String(c.text) : null
  }
  return null
}

const argsOf = (call: any): any[] => {
  const a = call.childForFieldName("arguments")
  const out: any[] = []
  if (!a) return out
  for (let i = 0; i < a.namedChildCount; i++) {
    const c = a.namedChild(i)
    if (c && c.type === "argument") out.push(c)
  }
  return out
}

for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  const t = parser.parse(f.text)
  if (!t) continue

  /** className -> { system, bases, members } */
  const classes = new Map<string, { system: string; bases: string[]; members: Set<string> }>()
  const s4Classes = new Map<string, string[]>()   // class -> bases (from contains=)
  const s4Methods = new Map<string, Set<string>>() // class -> method names
  let instantiatedDeclared = 0
  let instantiatedAll = 0
  let dollarNewAll = 0

  const visit = (n: any) => {
    if (n.type === "call") {
      const fn = n.childForFieldName("function")
      // bare callee name, qualified forms collapse to the last component
      let fname: string | null = null
      if (fn) {
        if (fn.type === "identifier") fname = bareName(fn)
        else if (fn.type === "namespace_operator") fname = bareName(fn.childForFieldName("rhs"))
        else if (fn.type === "extract_operator") fname = bareName(fn.childForFieldName("rhs"))
      }
      if (fname && CLASS_CONSTRUCTORS.has(fname)) {
        const a = argsOf(n)
        const first = a.find((x) => !x.childForFieldName("name"))
        const className = bareName(first?.childForFieldName("value") ?? null)
        if (className) {
          const bases: string[] = []
          const members = new Set<string>()
          for (const arg of a) {
            const an = arg.childForFieldName("name")
            const av = arg.childForFieldName("value")
            const aname = an ? bareName(an) : null
            if (!aname || !av) continue
            if (fname === "setClass") {
              if (aname === "contains") {
                // `contains = "B"` or `contains = c("B1", "B2")`
                if (av.type === "call") for (const inner of argsOf(av)) { const b = bareName(inner.childForFieldName("value") ?? null); if (b) bases.push(b) }
                else { const b = bareName(av); if (b) bases.push(b) }
              }
              continue
            }
            if (fname === "setRefClass" && aname === "contains") {
              const b = bareName(av)
              if (b) bases.push(b)
              if (av.type === "call") for (const inner of argsOf(av)) { const x = bareName(inner.childForFieldName("value") ?? null); if (x) bases.push(x) }
              continue
            }
            if (fname === "R6Class" && aname === "inherit") {
              const b = bareName(av)
              if (b) bases.push(b)
              if (av.type === "call") for (const inner of argsOf(av)) { const x = bareName(inner.childForFieldName("value") ?? null); if (x) bases.push(x) }
              continue
            }
            const memberLists = MEMBER_LIST_ARGS[fname]
            if (memberLists && memberLists.includes(aname) && av.type === "call" && bareName(av.childForFieldName("function")) === "list") {
              for (const entry of argsOf(av)) {
                const en = entry.childForFieldName("name")
                const m = bareName(en)
                if (m) members.add(m)
              }
            }
          }
          if (fname === "setClass") { s4Classes.set(className, bases); s4Methods.set(className, new Set()) }
          else classes.set(className, { system: fname, bases, members })
          record(`class_declared.${fname}`, label, `${className} bases=[${bases}] members=${members.size}`)
        }
      }
      if (fname === "setMethod") {
        const a = argsOf(n)
        const m = bareName(a.find((x) => !x.childForFieldName("name"))?.childForFieldName("value") ?? null)
        // owner: `"Class"` or `signature("Class", ...)`
        let owner: string | null = null
        const sig = a[1]?.childForFieldName("value")
        if (sig) {
          const sv = bareName(sig)
          if (sv) owner = sv
          else if (sig.type === "call") owner = bareName(argsOf(sig)[0]?.childForFieldName("value") ?? null)
        }
        if (m && owner) {
          if (!s4Methods.has(owner)) s4Methods.set(owner, new Set())
          s4Methods.get(owner)!.add(m)
          record("s4_method_declared", label, `${owner}$${m}`)
        }
      }
      // `new("Cls")` for S4, and `Cls$new()` for R6/R5
      if (fname === "new") {
        const cls = bareName(argsOf(n)[0]?.childForFieldName("value") ?? null)
        if (cls) {
          instantiatedAll++
          if (s4Classes.has(cls) || classes.has(cls)) {
            instantiatedDeclared++
            record("instantiates.s4_new_same_file", label, `new("${cls}")`)
          }
        }
      }
      if (fn && fn.type === "extract_operator" && bareName(fn.childForFieldName("rhs")) === "new") {
        const recv = bareName(fn.childForFieldName("lhs"))
        if (recv) {
          dollarNewAll++
          if (classes.has(recv)) {
            instantiatedDeclared++
            record("instantiates.dollar_new_same_file", label, `${recv}$new()`)
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(t.rootNode)

  for (const [name, info] of classes) {
    for (const base of info.bases) {
      const b = classes.get(base)
      if (b) {
        const shared = [...info.members].filter((m) => b.members.has(m))
        record("overrides.candidate_same_file_base", label, `${base} -> ${name} shared=[${shared.join(",")}]`)
        if (shared.length) {
          record("overrides.same_file_member_shadow", label, `${base}#${shared[0]} overridden by ${name}#${shared[0]}`)
          hits.push({ kind: "overrides.same_file_member_shadow", label, detail: `${base}#${shared[0]} <- ${name}` })
        }
      } else {
        record("overrides.base_not_declared_same_file", label, `${name} inherits ${base} (external)`)
      }
    }
  }
  for (const [name, bases] of s4Classes) {
    const own = s4Methods.get(name)
    if (!own || !own.size) continue
    for (const base of bases) {
      const bm = s4Methods.get(base)
      if (!bm) continue
      for (const m of own) if (bm.has(m)) record("overrides.s4_same_file", label, `${base}#${m} <- ${name}`)
    }
  }
  // Only recorded when non-zero. An earlier version recorded these per FILE
  // unconditionally, so a construct with zero occurrences reported 1,890 — a number
  // that reads as a count of the construct and is a count of the corpus.
  if (dollarNewAll > 0) record("instantiates.dollar_new_total", label, `${dollarNewAll} Cls$new() in this file`)
  if (instantiatedAll > 0) record("instantiates.s4_new_total", label, `${instantiatedAll} new("Cls") in this file`)
  t.delete?.()
}

const hdr = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`INSTRUMENT B — R class-system construct counts`)
console.log(`corpus ${CR}; repos ${repos.length}: ${repos.join(", ")}; files ${files.length}`)
console.log("")
console.log(hdr("construct", 46) + hdr("occurrences", 13) + hdr("files", 8) + "examples")
for (const [k, v] of [...tally.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(hdr(k, 46) + hdr(String(v.n), 13) + hdr(String(v.files.size), 8) + v.examples.slice(0, 2).join(" | "))
}
console.log("")
console.log(`same-file member shadows (the construct an ` + "`overrides`" + ` edge would carry): ${hits.filter((h) => h.kind === "overrides.same_file_member_shadow").length}`)
for (const h of hits.filter((x) => x.kind === "overrides.same_file_member_shadow").slice(0, 10)) console.log(`    ${h.label} :: ${h.detail}`)
