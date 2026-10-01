// script/m14/verify-oracle-prototype-safety.ts — the oracle's registries are keyed by
// names that come from the SOURCE, and a plain object `{}` answers for names it never
// registered.
//
// Measured defect (2026-09-25, found by the family sharpness sweep at full extent):
// `deriveTreeEdges` registers a declaration with `if (!decls[nm]) decls[nm] = {…}`, and
// `decls` was `Record<string, …> = {}` — so for a class named after an Object.prototype
// member the guard never initializes the entry (`decls["toString"]` is inherited and
// truthy) and the next line dereferences a function:
//
//     class toString { def foo(): Int = 1 }   ->  TypeError: undefined is not an object
//
// The real corpus file that found it is scala3's `tests/neg-macros/i18825/Macro_1.scala`
// (`class toString extends MacroAnnotation :`). The harness calls the oracle OUTSIDE any
// try, so one such file is fatal for a lane — and no 60-file draw had ever sampled one.
//
// TWO INDEPENDENT DIMENSIONS. A registry keyed by a DECLARATION name breaks on a class
// named `toString` (read: the guard is skipped) or `__proto__` (write: the assignment
// rewrites the registry's prototype). A registry keyed by a MEMBER name breaks the same
// way, and the snippet below exercises that path with the member name parameterized too —
// a fix that special-cased only the class name would still fail the member runs.
//
// WHAT THIS GATE ASSERTS, per class-based lane, on synthetic name-swapped quads:
//   1. every run declares something (the check is not vacuous);
//   2. the POISON runs do not throw;
//   3. the CONTROL run yields its truth edges;
//   4. each poison run's edge set is ISOMORPHIC to the control's under the rename — the
//      oracle's answer depends on the code, never on the name's relationship to the JS
//      prototype.
// (4) is what makes this a contract rather than a smoke test: a "fix" that swallows the
// name (registering the class but dropping its members) passes (2) and fails (4).
//
// REACHABILITY, classified and re-checked. "Does not throw" is only evidence about the
// declaration registry if the snippet REACHES it, and reachability is not assumed here:
// the registry's own product is the `overrides` edge, so a lane is adjudicated when the
// control run emits one (`product`), or — for the one lane whose registry is populated
// while its `overrides` product is suppressed BY DESIGN (cpp: the oracle excludes cpp
// override truth and pins it with analyzer fixtures instead) — when the pre-fix run threw
// on the registry call for that lane (`throw-witness`, cited in the classification below
// and re-checked by requiring the product to stay absent). A lane with neither is not
// adjudicated: it is DISCLOSED, because a pass there would be a statement about a path the
// snippet never took.
//
// SENSITIVITY (negative, re-measured at every run, not remembered): the assertions in (2)
// can fail, and the mechanism is executed right here — the pre-fix registry shape throws
// on `toString` and is name-blind once the registry has no prototype. A gate that cannot
// fail is not evidence, so the failure path is kept alive next to the pass path.
//
// Run: bun run script/m14/verify-oracle-prototype-safety.ts [--verbose]
import fs from "node:fs"
import path from "node:path"
import { LANGS, deriveTreeEdges } from "./differential"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const VERBOSE = process.argv.includes("--verbose")

let passed = 0, failed = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  if (ok) { passed++; if (VERBOSE) console.log(`  ok   ${label}`) }
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

// The declaration-name dimension: the name the measured defect was reproduced with.
const POISON = "toString"
// The member-name dimension: `__proto__` (assignment to it rewrites the prototype) and
// `hasOwnProperty` (read from it returns an inherited function). Both are semantically
// inert as member names in all eight source languages below — `toString` deliberately is
// NOT used here, because in java/kotlin/scala overriding it is a real language rule and a
// difference under that rename would be a false conviction rather than a defect.
const POISON_MEMBERS = ["__proto__", "hasOwnProperty"]
const CONTROL_CLASS = "Ordinary"
const CONTROL_MEMBER = "foo"

// One snippet family per class-based lane: a base declaration with a member, and a
// subclass that overrides it. Every run differs ONLY in the two names, so (4) compares
// apples to apples. Languages with no class-shaped declaration in their grammar are
// listed as NOT_APPLICABLE below rather than silently omitted — an absence that is a
// decision, not an oversight.
const SNIPPETS: Record<string, (c: string, m: string) => string> = {
  java: (c, m) => `class ${c} { void ${m}() {} }\nclass Sub extends ${c} { void ${m}() {} }\n`,
  kotlin: (c, m) => `open class ${c} { open fun ${m}(): Int = 1 }\nclass Sub : ${c}() { override fun ${m}(): Int = 2 }\n`,
  scala: (c, m) => `class ${c} {\n  def ${m}(): Int = 1\n}\nclass Sub extends ${c} {\n  override def ${m}(): Int = 2\n}\n`,
  groovy: (c, m) => `class ${c} { def ${m}() { 1 } }\nclass Sub extends ${c} { def ${m}() { 2 } }\n`,
  cpp: (c, m) => `class ${c} { public: virtual int ${m}() { return 1; } };\nclass Sub : public ${c} { public: int ${m}() override { return 2; } };\n`,
  typescript: (c, m) => `class ${c} { ${m}(): number { return 1 } }\nclass Sub extends ${c} { override ${m}(): number { return 2 } }\n`,
  javascript: (c, m) => `class ${c} { ${m}() { return 1 } }\nclass Sub extends ${c} { ${m}() { return 2 } }\n`,
}
// How each adjudicated lane's registry reachability is established, and how that claim is
// re-checked against a live observable every run:
//   product        — the control run MUST emit an `overrides` edge; if it stops emitting
//                    one, the classification is falsified and the gate fails.
//   throw-witness  — the lane threw on the registry call before the fix (measured, same
//                    snippet, 61/14 red run recorded in reviews/m60-oracle-sharpness.md)
//                    while its `overrides` product is suppressed by design; the gate
//                    re-checks the suppression (the control must emit NO `overrides` edge)
//                    so a change that starts emitting them cannot leave this entry stale.
const REACH: Record<string, { kind: "product" | "throw-witness"; why: string }> = {
  java: { kind: "product", why: "control emits `overrides Sub.foo -> Ordinary.foo`" },
  kotlin: { kind: "product", why: "control emits `overrides Sub.foo -> Ordinary.foo`" },
  scala: { kind: "product", why: "control emits `overrides Sub.foo -> Ordinary.foo`" },
  groovy: { kind: "product", why: "control emits `overrides Sub.foo -> Ordinary.foo`" },
  cpp: { kind: "throw-witness", why: "cpp override truth is excluded from the oracle BY DESIGN (analyzer fixtures pin it), yet the pre-fix run threw `decls[nm].methods.add` on this exact snippet — the registry is populated, its product is suppressed" },
  typescript: { kind: "product", why: "control emits `overrides Sub.foo -> Ordinary.foo`" },
  javascript: { kind: "product", why: "control emits `overrides Sub.foo -> Ordinary.foo`" },
}
// Lanes whose grammar has no class-shaped declaration the collector can reach. Named so
// the absence is a decision.
const NO_CLASS_SYNTAX: Record<string, string> = {
  c: "struct/union only, and the collector's cpp specifier path does not apply to the c lane's routing",
  rust: "no class-shaped declaration in the grammar (impl/trait are not routed through the collector)",
  go: "no class-shaped declaration (structs are not routed through the collector)",
  zig: "no class-shaped declaration in the grammar",
  clojure: "no class-shaped declaration",
  elixir: "no class-shaped declaration",
  erlang: "no class-shaped declaration",
  haskell: "no class-shaped declaration",
}
// Single-file-component hosts: their script blocks ARE the typescript/javascript lanes,
// so the two snippets cover them.
const SFC_HOST: Record<string, string> = {
  vue: "SFC host — script blocks are routed through the typescript/javascript snippets",
  svelte: "SFC host — script blocks are routed through the typescript/javascript snippets",
}
// Lanes this instrument cannot adjudicate, with the reason: the oracle derives its
// override truth for this language only from a shape this synthetic pair does not
// produce (measured: the ORDINARY control yields 0 edges, so `did not throw` says nothing
// about the registry). They are DISCLOSED — never counted as passes, and the summary
// prints how many were disclosed — so a lane cannot hide in this list by accident.
const SNIPPET_UNVERIFIED: Record<string, string> = {
  dart: "the synthetic class pair yields heritage truth but NO registry truth (no `overrides` edge, measured), and no pre-fix throw was measured on this lane either — the snippet never reaches the declaration registry, so its exposure is unmeasured here, not denied (tried: plain extends, abstract+override, implements)",
  csharp: "the synthetic class pair yields no override truth for this lane (control 0 edges) — the collector's exposure is unmeasured here, not denied",
  swift: "the synthetic class pair yields no override truth for this lane (control 0 edges), while the poison name DOES throw — the exposure is real and the isomorphism half is unmeasured",
  objc: "@interface/@implementation shapes are not matched by this instrument's declaration walk",
  php: "the synthetic class pair yields no override truth for this lane (control 0 edges)",
  ruby: "the synthetic class pair yields no override truth for this lane (control 0 edges)",
  python: "the synthetic class pair yields no override truth for this lane (control 0 edges)",
  clean: "the synthetic class pair yields no override truth for this lane (control 0 edges)",
}

const ws: any = await import("web-tree-sitter")
const P: any = ws.Parser ?? ws.default ?? ws
const L: any = ws.Language ?? ws.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

const key = (e: any) => `${e.label} ${e.from} -> ${e.target}`
// Rename every poison name back to the control's, so the two edge sets can be compared
// as sets. Longest first: `hasOwnProperty` and `__proto__` are disjoint, and neither
// contains the class poison, but a future name could — the ordering rule is stated so a
// later addition cannot silently mis-rename.
const RENAME: [string, string][] = [
  ...POISON_MEMBERS.map((m): [string, string] => [m, CONTROL_MEMBER]),
  [POISON, CONTROL_CLASS],
]
const rename = (s: string) => RENAME.reduce((acc, [from, to]) => acc.split(from).join(to), s)

async function grammarFor(cfg: any): Promise<any> {
  return L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
}

// SENSITIVITY, part 1: the measured pre-fix mechanism, executed. Nothing here is a copy
// of the oracle — it is the four lines the oracle used to run, written the way the source
// wrote them, so the failure this gate looks for is reproducible in-process.
function preFixRegister(nm: string): void {
  const decls: Record<string, { methods: Set<string> }> = {}
  if (!decls[nm]) decls[nm] = { methods: new Set() }
  decls[nm].methods.add("x")
}
// SENSITIVITY, part 2: the same shape with a prototype-less registry — the fix this gate
// demands. If `postFixRegister` also threw, the gate's remedy would be wrong.
function postFixRegister(nm: string): void {
  const decls: Record<string, { methods: Set<string> }> = Object.create(null)
  if (!decls[nm]) decls[nm] = { methods: new Set() }
  decls[nm].methods.add("x")
}
const thrown = (f: () => void): string => { try { f(); return "" } catch (e: any) { return String(e?.message ?? e).slice(0, 70) } }

async function main() {
  // Negative first: evidence that the checks below have a failure path, re-measured now.
  check("sensitivity: the PRE-FIX registry shape throws on a source name it does not own",
    thrown(() => preFixRegister(POISON)) !== "", "the defect this gate looks for did not reproduce — the gate is vacuous")
  check("sensitivity: the same shape is calm on a name nothing inherits (the failure is the name, not the shape)",
    thrown(() => preFixRegister(CONTROL_CLASS)) === "")
  check("sensitivity: the PRE-FIX shape also breaks on a member name (`__proto__` rewrites the prototype)",
    POISON_MEMBERS.every((m) => thrown(() => preFixRegister(m)) !== ""))
  check("sensitivity: the remedy is name-blind — a prototype-less registry registers every poison name",
    [POISON, ...POISON_MEMBERS].every((m) => thrown(() => postFixRegister(m)) === ""))

  const grammarCache = new Map<string, any>()
  for (const [lang, snippet] of Object.entries(SNIPPETS)) {
    const cfg = (LANGS as any)[lang]
    if (!cfg) { check(`${lang}: lane exists in LANGS`, false, "no LANGS entry"); continue }
    if (!grammarCache.has(cfg.wasm)) grammarCache.set(cfg.wasm, await grammarFor(cfg))
    const grammar = grammarCache.get(cfg.wasm)
    const parser = new P()
    parser.setLanguage(grammar)

    const run = (cname: string, mname: string): { edges: string[] | null; error: string; decls: number } => {
      const src = snippet(cname, mname)
      let root: any
      try { root = parser.parse(src)?.rootNode ?? null } catch (e: any) { return { edges: null, error: `parse threw ${String(e?.message ?? e).slice(0, 60)}`, decls: 0 } }
      if (!root) return { edges: null, error: "no root", decls: 0 }
      // Vacuity guard: the snippet must actually declare something the collector walks,
      // otherwise "did not throw" would be a statement about an empty tree.
      let decls = 0
      const walk = (n: any): void => {
        if (/(class|interface|trait|object|record|struct|union)_?(declaration|definition|specifier)$/.test(n.type)) decls++
        for (const c of n.namedChildren) walk(c)
      }
      walk(root)
      try { return { edges: deriveTreeEdges(root, lang).map(key), error: "", decls } }
      catch (e: any) { return { edges: null, error: String(e?.message ?? e).slice(0, 90), decls } }
    }

    const control = run(CONTROL_CLASS, CONTROL_MEMBER)
    const controlSet = control.edges ? [...new Set(control.edges)].sort() : null
    check(`${lang}: the snippet declares something (the check is not vacuous)`, control.decls > 0,
      `declaration node(s) seen: control=${control.decls}`)
    if (control.decls === 0) { parser.delete?.(); continue }
    check(`${lang}: the control class named \`${CONTROL_CLASS}\` yields truth`, controlSet !== null && controlSet.length > 0,
      control.error || `${controlSet?.length ?? 0} edge(s)`)
    if (controlSet === null) { parser.delete?.(); continue }
    // Reachability, re-checked against the live product rather than remembered.
    const reach = REACH[lang]
    check(`${lang}: the adjudication names how this lane reaches the registry (a lane without a classification must not be in SNIPPETS)`,
      !!reach, "no REACH entry")
    if (!reach) { parser.delete?.(); continue }
    const emitsOverrides = controlSet.some((e) => e.startsWith("overrides "))
    check(`${lang}: reachability is \`${reach.kind}\` as classified (${reach.why})`,
      reach.kind === "product" ? emitsOverrides : !emitsOverrides,
      `control emits ${emitsOverrides ? "" : "no "}\`overrides\` edge(s) — the classification is falsified, so this lane's adjudication no longer describes the oracle`)

    // Five runs: the control, then each name dimension alone, then both together. The pair
    // dimensions are what a "fix" that special-cased one name would still fail.
    const cases: [string, string, string][] = [
      [`the class named \`${POISON}\``, POISON, CONTROL_MEMBER],
      ...POISON_MEMBERS.map((m): [string, string, string] => [`the member named \`${m}\``, CONTROL_CLASS, m]),
      [`both names poisoned (\`${POISON}\` class + \`__proto__\` member)`, POISON, POISON_MEMBERS[0]],
    ]
    for (const [label, cname, mname] of cases) {
      const r = run(cname, mname)
      check(`${lang}: ${label} does not throw the oracle`, r.edges !== null, r.error)
      if (r.edges === null) continue
      const a = [...new Set(r.edges.map(rename))].sort()
      check(`${lang}: truth is ISOMORPHIC under the rename for ${label} (a swallowed name is a failure, not a fix)`,
        a.length === controlSet.length && a.every((x, i) => x === controlSet[i]),
        a.length !== controlSet.length
          ? `${a.length} vs ${controlSet.length} edge(s)`
          : `poison-only: ${[...a.filter((x) => !controlSet.includes(x))].slice(0, 3).join(" | ")} control-only: ${[...controlSet.filter((x) => !a.includes(x))].slice(0, 3).join(" | ")}`)
    }
    parser.delete?.()
  }

  // Every lane must appear in exactly one list. An omission cannot be silent: this check
  // is what makes "the other lanes are fine" a verified statement rather than an absence.
  const lists: [string, string[]][] = [
    ["snippet", Object.keys(SNIPPETS)],
    ["no-class-syntax", Object.keys(NO_CLASS_SYNTAX)],
    ["sfc-host", Object.keys(SFC_HOST)],
    ["snippet-unverified", Object.keys(SNIPPET_UNVERIFIED)],
  ]
  const lanes = Object.keys(LANGS).sort()
  for (const [name, list] of lists) {
    const dupes = list.filter((l) => lists.some(([n, other]) => n !== name && other.includes(l)))
    check(`the ${name} list has no lane listed twice`, dupes.length === 0, dupes.join(", "))
  }
  const covered = lists.flatMap(([, l]) => l).sort()
  check("every lane is adjudicated or disclosed — none is absent from all four lists",
    covered.length === lanes.length && covered.every((l, i) => l === lanes[i]),
    `missing: ${lanes.filter((l) => !covered.includes(l)).join(", ") || "none"}; extra: ${covered.filter((l) => !lanes.includes(l)).join(", ") || "none"}`)

  console.log(`\nM14.0.F13: ${passed} passed, ${failed} failed, ${passed + failed} assertion(s), ${Object.keys(SNIPPETS).length} lane(s) adjudicated — the oracle's truth does not depend on a declaration or member name being a property of Object.prototype`)
  console.log(`  registry reachability, re-checked per lane: ${Object.entries(REACH).map(([l, r]) => `${l}=${r.kind}`).join(" ")}`)
  console.log(`  disclosed, not adjudicated (${Object.keys(SNIPPET_UNVERIFIED).length}): ${Object.keys(SNIPPET_UNVERIFIED).join(", ")}`)
  console.log(`  no class-shaped declaration (${Object.keys(NO_CLASS_SYNTAX).length}): ${Object.keys(NO_CLASS_SYNTAX).join(", ")}`)
  if (failures.length) { console.log("failures:"); for (const f of failures) console.log(`  - ${f}`) }
  process.exitCode = failed > 0 ? 1 : 0
}

await main()
