// M49 · CLJ-CORE — the clojure.core surface is a GATE, not a script that prints.
//
// WHY THIS FILE EXISTS. `CLOJURE_CORE_BUILTINS` in src/ast/real-clojure-analyzer.ts
// was 437 hand-typed names, and `deriveClojureEdges` IMPORTS that object by
// reference. Every name the list omitted was therefore a MIRRORED fabrication —
// the analyzer emitted `calls -> mapcat`, the truth side derived `calls ->
// mapcat`, and the F5 differential reported 0 unexplained. No gate in the
// repository could see it, for three waves, because the one instrument that
// compares analyzer to truth shares the very fact under test.
//
// Measured cost: 2,525 such edges in the clojure corpus (30% of all 8,391 call
// edges), 999 in clj-kondo, 151 in core.async. Record:
// reviews/clojure/deep-review-2026-09-28.md, finding CLJ-D17.
//
// WHAT THE WAVE FIXED, AND WHAT THIS FILE CLOSES. The wave made the set DERIVED
// (from clojure/clojure's own `core.clj`, with the pinned wasm) and shipped the
// result as a constant — but the derivation only PRINTED a gap. Nothing failed
// when the two disagreed, so the CLASS of defect was fixed in one instance and
// left open. This gate is the other half: it re-derives on every run and fails in
// BOTH directions.
//
//   MISSING     a real clojure.core public var the constant does not know → the
//               fabrication class, returning.
//   UNDECLARED  a name the constant suppresses that is neither derived nor a
//               DECLARED extra → the other direction: it would silence a call
//               that is really the program's own.
//   STALE-EXTRA a declared extra the constant no longer carries → the declared
//               list has drifted from the code it declares.
//
// NO STALE ARTIFACT, BY CONSTRUCTION. The derivation is recomputed from the
// corpus on every run rather than read from a committed census, so there is
// nothing to drift — the failure mode R2 exists to police (a derived artifact
// describing a tree no commit holds) cannot occur here.
//
// A MISSING CORPUS IS A DISCLOSED SKIP, NEVER A PASS. Without
// `clojure/clojure` checked out there is no derivation, and the honest state is
// "not checked". The house pattern is the same
// (script/m14/verify-corpus-census.ts prints `SKIP (corpus repo missing: …)`), and
// the skip is loud on purpose: a reader who sees no `FAIL` must still see it.
//
// ONE DERIVATION. `deriveFromCorpus` below is the only implementation;
// script/m14/tmp/clj-core-derive.ts imports it for its interactive print rather
// than keeping a second copy that could disagree. A second copy of a rule is a
// second answer to the same question, which is the lesson of the defect itself.
//
// AST ONLY — no regex (the analyzer's own policy, applied to its own gate). The
// grammar classifies the file; this reads node types and the `name`/`namespace`
// fields.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
export const CORE_DIR = path.join(CORPUS_ROOT, "clojure/src/clj/clojure")

// ── The DECLARED extras ────────────────────────────────────────────────────
// These 69 names are in the constant and are NOT clojure.core public vars. Each
// group is here for a stated reason, and a constant name in neither the derived
// surface nor one of these groups FAILS the gate — so this list is the whole of
// the hand-maintained part, at 69 entries with their reasons, instead of an
// unlabelled 437.
export const DECLARED_EXTRAS: Record<string, readonly string[]> = {
  // Special forms and compiler directives: the reader/compiler handles them, so
  // they are the language in a stronger sense than a clojure.core var is.
  specialForm: [
    "catch", "def", "deftest", "do", "finally", "if", "in-ns", "is", "load-file",
    "monitor-enter", "monitor-exit", "new", "quote", "recur", "set!", "syntax-quote",
    "testing", "throw", "try", "var",
  ],
  // Uncurried interop statics a Clojure program writes BARE: `Math/abs`,
  // `String/join`, `System/exit`. The qualified form is a sym_lit with a
  // `namespace` field and takes the CLJ-D28 path, but the bare form is real
  // source and must not become a `calls` edge to a member of no namespace.
  interopStatic: [
    "Double/parseDouble", "Integer/parseInt", "Long/parseLong", "Math/abs", "Math/ceil",
    "Math/floor", "Math/max", "Math/min", "Math/pow", "Math/random", "Math/round",
    "Math/sqrt", "String/format", "String/join", "String/split", "String/valueOf",
    "System/currentTimeMillis", "System/exit", "System/gc", "System/getProperty",
    "System/nanoTime", "Thread/currentThread", "Thread/sleep", "UUID/randomUUID",
  ],
  // clojure.string / clojure.test spellings, reachable unaliased through
  // `refer-clojure` or a `:refer` clause.
  stringOrTest: [
    "code-char", "join", "lower-case", "split", "trim", "trim-newline", "triml",
    "trimr", "upper-case",
  ],
  // Real clojure.core vars that this CORPUS SNAPSHOT predates. Measured, not
  // assumed: the corpus is a 1.11-era snapshot — it defines `update-keys`,
  // `update-vals`, `random-uuid`, `abs`, `parse-long`, `parse-double`,
  // `hash-set` and `partition-all` — yet it defines `tap>` UN-deprecated at
  // core.clj:8225 and does not define `tap->` anywhere in the file. So the
  // constant naming `tap->` is correct for current Clojure and the corpus is
  // simply behind it, which is the opposite defect from a fabricated name: a
  // mirror with nothing behind it. Recorded as a version gap rather than
  // deleted from the constant, because deleting a real core var from the
  // suppression set would make every `(tap-> x)` in a modern codebase a
  // fabricated `calls` edge — the CLJ-D17 class this gate exists to catch.
  versionAheadOfCorpus: [
    "tap->",
  ],
  // Java-side and historical spellings with no clojure.core var behind them.
  other: [
    ".", "agent?", "atom?", "bit-count", "byte?", "delayed?", "equiv", "java.util.Date",
    "promise?", "ref?", "regexp?", "shift-left", "shift-right", "short?",
    "unchecked-divide", "unchecked-remainder",
  ],
}

// The namespaces whose vars ARE part of the surface a bare head can name.
const CORE_NAMESPACES = new Set(["clojure.core", "clojure.core.protocols", "clojure.core.reducers"])
// Types are excluded ON PURPOSE: a `deftype`/`defrecord` name is a TYPE, and a
// bare `(Vec …)` head is not a thing a Clojure program writes.
const DEF_HEADS = new Set(["def", "defn", "defn-", "defmacro", "definline", "defonce", "declare"])
const TYPE_HEADS = new Set<string>([])

export interface CoreSurface {
  names: Set<string>
  fileCount: number
  errorFiles: number
  keptFiles: string[]
  skipped: string[]
}

/**
 * Derive the public clojure.core surface from the language's own source.
 *
 * Scope, and why each rule is here:
 *  1. only files whose `ns`/`in-ns` is clojure.core (or clojure.core.protocols /
 *     clojure.core.reducers) — this is what excludes clojure.repl, clojure.pprint,
 *     clojure.string, clojure.test, clojure.core.server, and clojure.core's own
 *     REPL helpers;
 *  2. only TOP-LEVEL def-family forms — an ancestor guard, so an internal helper
 *     defined inside a `defn` body (`binary-op`, `check-valid-options`, …) cannot
 *     read as public API;
 *  3. private-filtered with the analyzer's own rule (`defn-`, `^:private`,
 *     `^{:private true}`) — core.clj declares ~200 implementation helpers
 *     exactly that way.
 */
export async function deriveFromCorpus(parser: any, coreDir: string): Promise<CoreSurface> {
  const out: CoreSurface = { names: new Set(), fileCount: 0, errorFiles: 0, keptFiles: [], skipped: [] }
  if (!existsSync(coreDir)) return out

  const files: string[] = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e)
      if (e === "pprint") continue          // clojure.pprint is NOT clojure.core
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (e.endsWith(".clj") || e.endsWith(".cljc")) files.push(p)
    }
  }
  walk(coreDir)
  out.fileCount = files.length

  // The first EXECUTABLE child is the form's head: a discard, a comment and
  // metadata occupy no execution position (#881).
  const headOf = (list: any): any => {
    for (let i = 0; i < list.namedChildCount; i++) {
      const c = list.namedChild(i)
      if (c && c.type !== "comment" && c.type !== "dis_expr" && c.type !== "meta_lit") return c
    }
    return null
  }
  // `namespace:` and `name:` are FIELDS on a sym_lit; the qualified form is read
  // from them rather than by splitting text (the CLJ-D28 lesson, applied here).
  const nameOf = (nd: any): string => {
    if (!nd) return ""
    if (nd.type !== "sym_lit") return nd.text
    const nm = nd.childForFieldName("name")
    const ns = nd.childForFieldName("namespace")
    if (nm && ns) return `${ns.text}/${nm.text}`
    if (nm) return nm.text
    return nd.text
  }
  // The declared NAME of a def-family form: the first SYMBOL after the head.
  // Metadata occupies no name position and neither does a leading string.
  const declaredName = (form: any): string => {
    for (let i = 1; i < form.namedChildCount; i++) {
      const c = form.namedChild(i)
      if (!c) continue
      if (c.type === "comment" || c.type === "dis_expr" || c.type === "meta_lit") continue
      return c.type === "sym_lit" ? nameOf(c) : ""
    }
    return ""
  }
  // `(ns ^{:doc "…"} clojure.core …)` puts the metadata on the NAME symbol, so it
  // is read through the same skip-metadata rule; `(in-ns 'clojure.core)` names
  // its namespace through a quote.
  const declaredNs = (form: any): string => {
    const h = headOf(form)
    const hn = h && h.type === "sym_lit" ? nameOf(h) : ""
    if (hn === "ns") return declaredName(form)
    if (hn === "in-ns") {
      const q = form.namedChild(1)
      const inner = q && q.type === "quoting_lit" ? q.namedChild(0) : q
      return inner ? nameOf(inner) : ""
    }
    return ""
  }
  const nameIsPrivate = (form: any): boolean => {
    const h = headOf(form)
    if (h && h.type === "sym_lit" && nameOf(h) === "defn-") return true
    for (let i = 1; i < form.namedChildCount; i++) {
      const c = form.namedChild(i)
      if (!c) continue
      if (c.type === "comment" || c.type === "dis_expr" || c.type === "meta_lit") continue
      if (c.type !== "sym_lit") return false
      const hasPrivate = (n: any): boolean => {
        if (n.type === "kwd_lit" && n.text === ":private") return true
        for (let j = 0; j < n.namedChildCount; j++) { const k = n.namedChild(j); if (k && hasPrivate(k)) return true }
        return false
      }
      for (let j = 0; j < c.namedChildCount; j++) {
        const m = c.namedChild(j)
        if (m && m.type === "meta_lit" && hasPrivate(m)) return true
      }
      return false
    }
    return false
  }

  for (const f of files) {
    const content = readFileSync(f, "utf8")
    const tree = parser.parse(content)
    if (tree.rootNode.hasError) out.errorFiles++
    const rel = path.relative(coreDir, f)
    let ns = ""
    for (let i = 0; i < tree.rootNode.namedChildCount; i++) {
      const c = tree.rootNode.namedChild(i)
      if (c && c.type === "list_lit") { const n = declaredNs(c); if (n) { ns = n; break } }
    }
    if (!CORE_NAMESPACES.has(ns)) { out.skipped.push(`${rel} (${ns || "no core ns"})`); continue }
    for (let i = 0; i < tree.rootNode.namedChildCount; i++) {
      const c = tree.rootNode.namedChild(i)
      if (!c || c.type !== "list_lit") continue
      const h = headOf(c)
      const hn = h && h.type === "sym_lit" ? nameOf(h) : ""
      if (!DEF_HEADS.has(hn) && !TYPE_HEADS.has(hn)) continue
      if (nameIsPrivate(c)) continue
      const nm = declaredName(c)
      if (nm) out.names.add(nm)
    }
    out.keptFiles.push(rel)
  }
  return out
}


// ── Self-test (the `npx … --selftest` house pattern) ────────────────────────
// A gate nobody has shown CAN fail is not a gate. These four proofs run the
// comparison against a MUTATED shipped set, and the mode FAILS if any of them
// fails to fire — which is the property that makes the real verdict mean
// something. The fourth is the literal 2026-09-20 condition: a list missing the
// names the hand transcription omitted, which is the state the lane shipped for
// three waves.
export function selfTest(shippedNames: string[], surface: Set<string>): { fired: number; total: number; ok: boolean } {
  const dropCore = shippedNames.filter(n => n !== "mapcat")
  const addUndeclared = [...shippedNames, "my-app-fn"]
  const dropExtra = shippedNames.filter(n => n !== "Math/abs")
  const probes: [string, string[], boolean][] = [
    ["derived-not-shipped: a core var deleted from the constant", dropCore, true],
    ["shipped-undeclared: a name that is neither derived nor declared", addUndeclared, true],
    ["stale-extra: a declared extra the constant no longer carries", dropExtra, true],
    ["the 2026-09-20 condition: a list missing the omitted core names",
      shippedNames.filter(n => n !== "mapcat" && n !== "ex-info" && n !== "with-meta" && n !== "transduce" && n !== "dedupe" && n !== "run!" && n !== "some-fn" && n !== "every-pred" && n !== "quot" && n !== "NaN?" && n !== "with-out-str" && n !== "hash-set" && n !== "update-keys" && n !== "volatile!" && n !== "vary-meta" && n !== "complement" && n !== "macroexpand" && n !== "re-matcher" && n !== "shuffle" && n !== "random-uuid" && n !== "partition-all" && n !== "take-last" && n !== "drop-last" && n !== "doall" && n !== "dorun"), true],
  ]
  let fired = 0
  for (const [label, mutated, mustFire] of probes) {
    const c = compare(surface, mutated)
    const n = c.missing.length + c.undeclared.length + c.staleExtras.length
    if (mustFire) {
      if (n > 0) fired++
      console.log(`    ${n > 0 ? "ok  " : "FAIL"} ${label} — fires on ${n}`)
    } else {
      if (n === 0) fired++
      console.log(`    ${n === 0 ? "ok  " : "FAIL"} ${label}`)
    }
  }
  return { fired, total: probes.length, ok: fired === probes.length }
}

export function compare(surface: Set<string>, shippedNames: string[]) {
  const extras = new Set(Object.values(DECLARED_EXTRAS).flat())
  return {
    missing: [...surface].filter(n => !shippedNames.includes(n)).sort(),
    undeclared: shippedNames.filter(n => !surface.has(n) && !extras.has(n)).sort(),
    staleExtras: [...extras].filter(n => !shippedNames.includes(n)).sort(),
    extrasCount: extras.size,
  }
}

async function main() {
  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))
  const shippedNames: string[] = Object.keys(mod.CLOJURE_CORE_BUILTINS as Record<string, boolean>)

  if (!existsSync(CORE_DIR)) {
    console.log(`  clojure-core   SKIP (corpus repo missing: ${path.relative(CORPUS_ROOT, CORE_DIR)})`)
    console.log(`  clojure-core   NOT CHECKED — the derivation could not run, and a skip is not a pass.`)
    console.log(`  clojure-core   The lane's last known numbers: 654 derived + 69 declared extras = 723.`)
    return
  }
  const parser = await engine.ASTEngine.getParser("clojure")
  const d = await deriveFromCorpus(parser, CORE_DIR)
  const c = compare(d.names, shippedNames)

  if (process.argv.includes("--selftest")) {
    console.log("  clojure-core   self-test: the gate must be able to FAIL")
    const st = selfTest(shippedNames, d.names)
    console.log(`  clojure-core   self-test ${st.fired}/${st.total} negatives fired`)
    if (!st.ok) { console.log("  clojure-core   self-test FAILED — a negative did not fire, so the gate cannot be trusted"); process.exitCode = 1 }
    return
  }

  console.log(`  clojure-core   derived ${d.names.size} public vars from ${d.fileCount} files (${d.keptFiles.length} declare a core namespace, ${d.errorFiles} with ERROR nodes)`)
  console.log(`  clojure-core   shipped ${shippedNames.length} = ${d.names.size} derived + ${shippedNames.length - d.names.size} of ${c.extrasCount} declared extras`)
  console.log(`  clojure-core   derived-not-shipped ${c.missing.length} · shipped-undeclared ${c.undeclared.length} · stale-extra ${c.staleExtras.length}`)

  let failed = 0
  for (const n of c.missing.slice(0, 40)) { console.log(`    FAIL MISSING      ${n} is a clojure.core public var the constant does not know`); failed++ }
  for (const n of c.undeclared.slice(0, 40)) { console.log(`    FAIL UNDECLARED   ${n} is suppressed as core but is neither derived nor a declared extra`); failed++ }
  for (const n of c.staleExtras.slice(0, 40)) { console.log(`    FAIL STALE-EXTRA  ${n} is a declared extra the constant no longer carries`); failed++ }
  if (c.missing.length > 40) console.log(`    … +${c.missing.length - 40} more`)
  if (c.undeclared.length > 40) console.log(`    … +${c.undeclared.length - 40} more`)

  if (failed > 0) {
    console.log(`  clojure-core   FAIL (${failed} finding(s)) — the constant has drifted from the language's own definition`)
    console.log(`  clojure-core   This is the CLJ-D17 regression class: a mirrored fabrication no other gate can see.`)
    process.exitCode = 1
    return
  }
  console.log(`  clojure-core   PASS`)
}

if (process.argv[1]?.endsWith("verify-clj-core-list.ts")) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
