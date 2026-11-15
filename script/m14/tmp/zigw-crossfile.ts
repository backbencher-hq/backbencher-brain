// ZIG.GAP.3, measured rather than restated: what is left for `instantiates` once
// the in-file population is closed, and how much of it a CROSS-FILE type index
// could actually resolve.
//
// The in-file class is done: 828 edges over 400 files, gated 0 phantom / 0
// missing. What remains is every construction and generic application whose TYPE
// is declared in ANOTHER file, which no single-file analyzer can see. The claim
// under test is the one the lane has been carrying as a number -- "19,318
// qualified-callee sites plus 381 non-local identifier callees" -- and the
// question worth asking is not how big the remainder is but WHETHER a cross-file
// index can resolve it, because a remainder that no index can reach is a
// permanent limit and one that an index trivially reaches was a missing
// instrument.
//
// So this builds a REAL index rather than estimating one:
//   1. every file's `@import` bindings, with the import path RESOLVED against the
//      filesystem (relative to the importing file, with and without `.zig`), so
//      `const x = @import("../foo.zig")` becomes a real target rather than a string;
//   2. every file's exported surface (its `pub` declarations, plus its `pub const`
//      re-exports), because `@import` can only see what a module exports;
//   3. then every qualified callee `A.B.C(..)`, walking `A` through the import
//      bindings and `B`, `C` through the target module's exports.
//
// Whatever this resolves is what a cross-file type index buys. Whatever it does
// NOT resolve is the honest remainder, and it is named per shape.
import * as fs from "fs"
import * as path from "path"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const REPOS = ["zig", "zls", "ghostty"]

interface FileInfo {
  file: string
  dir: string
  bindings: Map<string, string> // import alias -> resolved module path
  exports: Set<string> // pub names
  allNames: Set<string> // every declared name, for the unexported fallback
}

/** Resolve an `@import` literal to a real file, or null. */
function resolveImport(fromDir: string, spec: string): string | null {
  const base = path.resolve(fromDir, spec)
  for (const cand of [base, `${base}.zig`, path.join(base, "src/main.zig"), path.join(base, "src/lib.zig")]) {
    try {
      if (fs.statSync(cand).isFile() && cand.endsWith(".zig")) return cand
    } catch {
      /* not a file */
    }
  }
  return null
}

const unquote = (t: string): string => {
  const s = String(t ?? "")
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1)
  return s
}

await init()
const limit = Number(process.argv[2] ?? 400)
const files = zigFiles(REPOS, limit)
console.log(`indexing ${files.length} files ...`)

const info = new Map<string, FileInfo>()
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const tree = parser().parse(src)
  const bindings = new Map<string, string>()
  const exports = new Set<string>()
  const allNames = new Set<string>()
  const dir = path.dirname(f)

  const walk = (n: any, inContainer: boolean, isPub: boolean): void => {
    const pub = isPub || n.type === "export_statement"
    if (n.type === "variable_declaration" || n.type === "function_declaration" || n.type === "container_field") {
      let name = ""
      const c0 = n.namedChild(0)
      if (c0 && c0.type === "identifier") name = String(c0.text)
      if (name) {
        allNames.add(name)
        if (pub && !inContainer) exports.add(name)
      }
      // `const alias = @import("spec")`
      if (n.type === "variable_declaration" && name) {
        let found: string | null = null
        const scan = (x: any): void => {
          if (x.type === "string" || x.type === "string_content") { found = unquote(x.text); return }
          for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) scan(c) }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) scan(c) }
        if (found) {
          const target = resolveImport(dir, found)
          if (target) bindings.set(name, target)
        }
      }
    }
    const childPub = pub
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c, inContainer || n.type === "struct_declaration" || n.type === "enum_declaration" || n.type === "union_declaration", childPub)
    }
  }
  // file-scope pass with the `pub` token detected structurally
  const fileWalk = (n: any, inContainer: boolean): void => {
    const tok = String((n as any).text ?? "")
    const isPub = n.type === "variable_declaration" || n.type === "function_declaration"
      ? /\b(pub|export)\b/.test(tok) || (() => { for (let i = 0; i < n.childCount; i++) { const c = (n as any).child(i); if (c && /^(pub|export)$/.test(String(c.type))) return true } return false })()
      : false
    if (n.type === "variable_declaration" || n.type === "function_declaration" || n.type === "container_field") {
      let name = ""
      const c0 = n.namedChild(0)
      if (c0 && c0.type === "identifier") name = String(c0.text)
      if (name) {
        allNames.add(name)
        if (isPub && !inContainer) exports.add(name)
        if (n.type === "variable_declaration" && !inContainer) {
          let found: string | null = null
          const scan = (x: any): void => {
            if (x.type === "string" || x.type === "string_content") { found = unquote(x.text); return }
            for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) scan(c) }
          }
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) scan(c) }
          if (found) { const t = resolveImport(dir, found); if (t) bindings.set(name, t) }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) fileWalk(c, inContainer || n.type === "struct_declaration" || n.type === "enum_declaration" || n.type === "union_declaration")
    }
  }
  fileWalk(tree.rootNode, false)
  tree.delete()
  info.set(f, { file: f, dir, bindings, exports, allNames })
}

let idxFiles = 0
let idxBindings = 0
for (const i of info.values()) {
  idxFiles++
  idxBindings += i.bindings.size
}
console.log(`index: ${idxFiles} files, ${idxBindings} resolved import bindings`)

// ── now classify every construction / application site ────────────────────────
const shapes = new Map<string, { n: number; sample: string }>()
let inFile = 0
let qualifiedTotal = 0
let qualifiedResolved = 0
let bareNonLocal = 0
let bareResolved = 0
const note = (k: string, where: string): void => {
  const p = shapes.get(k)
  if (p) p.n++
  else shapes.set(k, { n: 1, sample: where })
}

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const tree = parser().parse(src)
  const me = info.get(f)!
  const res = analyzer().analyze(tree.rootNode, src, f) as any
  const rel_ = f.split("/repositories/")[1] ?? f
  const symNames = new Set<string>((res.symbols ?? []).map((s: any) => String(s.name ?? "")))
  // Every name bound INSIDE a function body — params, `var`/`const`, payload
  // captures. A chain rooted at one of these is a value chain, and that
  // distinction is the whole measurement.
  const localNames = new Set<string>()
  {
    const scan = (n: any, inFn: boolean): void => {
      const nowInFn = inFn || n.type === "function_declaration" || n.type === "test_declaration"
      if (nowInFn && (n.type === "variable_declaration" || n.type === "parameter" || n.type === "optional_pattern" || n.type === "identifier" && n.parent?.type === "optional_pattern")) {
        const c0 = n.namedChildCount > 0 ? n.namedChild(0) : n
        if (c0 && (c0.type === "identifier" || c0.type === "field_identifier")) localNames.add(String(c0.text ?? ""))
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) scan(c, nowInFn) }
    }
    scan(tree.rootNode, false)
  }

  const walk = (n: any): void => {
    if (n.type === "struct_initializer") {
      const first = n.namedChildCount > 0 ? n.namedChild(0) : null
      if (first && first.type !== "call_expression") {
        const raw = String(first.text ?? "")
        const leaf = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw
        if (symNames.has(leaf)) inFile++
        // Z54: the first version counted EVERY struct_initializer whose type leaf is
        // not in this file as a "construction of a type not declared in this file",
        // and its own sample was `[0][]const u8` — an ARRAY expression, not a
        // construction at all. 96,277 rows at full corpus, most of them not
        // instantiations, which would have made the published ceiling nonsense by an
        // order of magnitude.
        //
        // A construction of a NAMED type has an identifier or a field_expression as
        // its type child. `.{ .a = 1 }` (anonymous) and `[_]struct { A, B }{ ... }`
        // (a type expression) are not constructions of a named type and cannot be
        // cross-file instantiations, so they are counted separately rather than
        // folded into the ceiling.
        if (first.type === "identifier" || first.type === "field_expression") {
          const mod = me.bindings.get(raw.split(".")[0])
          if (!symNames.has(leaf)) {
            if (mod && info.get(mod)) note("construction of a type from an IMPORTED module — cross-file instantiates candidate", `${rel_}:${n.startPosition.row + 1}  ${raw}`)
            else note("construction of a type not declared in this file", `${rel_}:${n.startPosition.row + 1}  ${raw}`)
          }
        } else {
          note("anonymous or type-expression initializer — not a construction of a named type", `${rel_}:${n.startPosition.row + 1}  ${JSON.stringify(raw).slice(0, 40)}`)
        }
      }
    }
    if (n.type === "call_expression") {
      const callee = n.namedChildCount > 0 ? n.namedChild(0) : null
      if (callee && callee.type === "field_expression") {
        qualifiedTotal++
        const raw = String(callee.text ?? "")
        const segs = raw.split(".")
        const head = segs[0]
        const leaf = segs[segs.length - 1]
        const mod = me.bindings.get(head)
        // WHAT IS THE BASE? The lane has carried "19,318 qualified-callee sites" as
        // the cross-file remainder, and that number is a SYNTACTIC count: it says
        // nothing about what the base of the chain DENOTES. The first version of
        // this probe put every non-binding base in one bucket, and the first sample
        // was `b.build_root.handle.readFileAlloc` — `b` is a local builder VALUE,
        // `.build_root` and `.handle` are its fields, and `.readFileAlloc` is a
        // method on a runtime value. That is a method call, NOT a type application,
        // and no cross-file index should ever resolve it. 17,573 of 19,318 (91%)
        // are in that bucket, so the number the gap is stated in mostly counts
        // something that was never missing.
        if (!mod) {
          // resolve the base: a local/param/field binding is a VALUE, and a
          // file-scope type is an in-file type
          const baseLocal = localNames.has(head)
          if (baseLocal) note("method call through a VALUE chain (b.field.method) — not an instantiation", `${rel_}:${n.startPosition.row + 1}  ${raw}`)
          else if (symNames.has(head)) note("chain rooted at a type declared in this file", `${rel_}:${n.startPosition.row + 1}  ${raw}`)
          else note("chain rooted at a name this file does not declare", `${rel_}:${n.startPosition.row + 1}  ${raw}`)
        } else {
          const target = info.get(mod)
          if (!target) note("module-qualified callee whose module is outside the indexed corpus", `${rel_}:${n.startPosition.row + 1}  ${raw}`)
          else if (target.exports.has(leaf) || target.allNames.has(leaf)) { qualifiedResolved++ }
          else if (target.exports.has(segs[1] ?? "")) note("module-qualified type application with a method leaf (`mod.Type.method`) — resolvable once the type's members are indexed", `${rel_}:${n.startPosition.row + 1}  ${raw}`)
          else note("module-qualified callee whose leaf is not in the target module", `${rel_}:${n.startPosition.row + 1}  ${raw}`)
        }
      } else if (callee && callee.type === "identifier") {
        const nm = String(callee.text ?? "")
        if (!symNames.has(nm) && nm !== "std") {
          bareNonLocal++
          const mod = me.bindings.get(nm)
          if (mod && (info.get(mod)?.allNames.has(nm) ?? false)) bareResolved++
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(tree.rootNode)
  tree.delete()
}

console.log(`\n--- construction / application sites ---`)
console.log(`  in-file constructions (already emitted):        ${inFile}`)
console.log(`  QUALIFIED callees  a.b.C(..):                   ${qualifiedTotal}`)
console.log(`    resolvable by a cross-file import index:      ${qualifiedResolved}   (${((qualifiedResolved / Math.max(1, qualifiedTotal)) * 100).toFixed(1)}%)`)
console.log(`    ...so the cross-file type index ZIG.GAP.3 asks for would buy at most`)
console.log(`       ${qualifiedResolved} of ${qualifiedTotal} — and the rest must first be shown to be MISSING EDGES rather than method calls`)
console.log(`  BARE callees whose name is not declared here:   ${bareNonLocal}`)
console.log(`    with an import binding to a module that has it: ${bareResolved}`)
console.log(`\nunresolved shapes: ${shapes.size}`)
for (const [k, v] of [...shapes].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(v.n).padStart(6)}x  ${k}`)
  console.log(`           e.g. ${v.sample}`)
}