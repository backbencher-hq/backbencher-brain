// script/m60/callee-shape-census.ts — what each lane NAMES when a call's callee is
// not a plain name (M60 OO wave; found by #902).
//
// WHY THIS EXISTS
// ---------------
// #902 is one UNEXPLAINED `calls` edge on cython:python, in
//
//     with (cm1_getter if use_first else cm2_getter)():
//
// The differential oracle names a callee only when the call's function child is an
// `identifier` or an `attribute`; the python ANALYZER names one by descending into
// the callee's first named child whatever its type. So for a conditional callee the
// analyzer publishes `calls -> cm1_getter` (the `if` branch — not the callee, which
// is whichever branch the condition selects) and the oracle publishes nothing.
//
// Which side is wrong is a FAMILY question, not a python one: a grouped callee
// `(f)()` is statically `f` and should be named, a conditional callee `(a if c else b)()`
// is not statically any name, and `f()()` calls the RESULT of `f`, not `f`. Every lane
// with those shapes in its grammar answers it somewhere in its call walk, and nothing
// measured whether they answer it the same way. This census feeds each lane the same
// four shapes and records what it actually names — the analyzer's behaviour, not its
// source, so a lane cannot pass by looking right.
//
// SHAPES (per lane; `f` and `g` are declared functions in the file, so a `calls` edge
// to either is possible for a correctly parsed snippet)
//   control    `f()`                — must yield `calls f`, else the lane did not walk
//   grouped    `(f)()`              — transparent grouping: statically `f`
//   conditional `(a if c else b)()` — NOT statically a name (python/js/php/rust forms)
//   lambda     `(lambda: f)()`      — the callee is the lambda; `f` is its BODY
//   nested     `f()()`              — calls the result of `f()`, not `f`
//
// A lane whose grammar cannot write a shape is recorded `n/a` WITH the reason, never
// silently omitted — a language with no ternary is exempt by grammar, not by choice.
//
// BOUNDARIES, DISCLOSED
// ---------------------
//   * Snippets, not corpora: this measures the CONTRACT, not how often a corpus
//     exercises it. A lane can be contract-correct and still publish a fabricated
//     callee on some construction nobody wrote here.
//   * `calls` only, and only names: the question is which NAME a non-name callee
//     produces, so instance/attribute targets are read for their leaf.
//   * A shape's verdict says nothing about whether the edge should exist — `n/a` and
//     `names`/`refuses` are all honest; only a lane that names the WRONG thing for a
//     shape (a branch of a conditional, a lambda's body) is a finding.
//
// Run: bun script/m60/callee-shape-census.ts        (probe; writes no artifact)
// Exit: 0 always — this is a census, the ruling it informs is a separate round.
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const TMP = path.join(ROOT, "script/m14/tmp/.callee-shapes")

type Shape = "control" | "grouped" | "conditional" | "lambda" | "nested"

/**
 * Per language: the file extension ASTEngine routes on, and one source per shape.
 * `null` means the language's grammar cannot write that shape (the reason is in
 * SHAPE_NA). Snippets declare `f`/`g` as real functions so a `calls` edge to either
 * is reachable, and each body calls the shape from a function so python's
 * `caller = currentFunction` contract has an owner.
 */
export const SNIPPETS: Record<string, { ext: string; owner: string; shapes: Record<Shape, string | null> }> = {
  python: {
    ext: ".py",
    owner: "h",
    shapes: {
      control: "def f():\n    return 1\n\ndef g():\n    return 2\n\ndef h():\n    f()\n",
      grouped: "def f():\n    return 1\n\ndef g():\n    return 2\n\ndef h():\n    (f)()\n",
      conditional: "def f():\n    return 1\n\ndef g():\n    return 2\n\ndef h(c):\n    (f if c else g)()\n",
      lambda: "def f():\n    return 1\n\ndef h():\n    (lambda: f)()\n",
      nested: "def f():\n    return 1\n\ndef h():\n    f()()\n",
    },
  },
  javascript: {
    ext: ".js",
    owner: "h",
    shapes: {
      control: "function f(){return 1}\nfunction g(){return 2}\nfunction h(){ f() }\n",
      grouped: "function f(){return 1}\nfunction g(){return 2}\nfunction h(){ (f)() }\n",
      conditional: "function f(){return 1}\nfunction g(){return 2}\nfunction h(c){ (c ? f : g)() }\n",
      lambda: "function f(){return 1}\nfunction h(){ (() => f)() }\n",
      nested: "function f(){return 1}\nfunction h(){ f()() }\n",
    },
  },
  typescript: {
    ext: ".ts",
    owner: "h",
    shapes: {
      control: "function f(){return 1}\nfunction g(){return 2}\nfunction h(){ f() }\n",
      grouped: "function f(){return 1}\nfunction g(){return 2}\nfunction h(){ (f)() }\n",
      conditional: "function f(){return 1}\nfunction g(){return 2}\nfunction h(c: boolean){ (c ? f : g)() }\n",
      lambda: "function f(){return 1}\nfunction h(){ (() => f)() }\n",
      nested: "function f(){return 1}\nfunction h(){ f()() }\n",
    },
  },
  php: {
    ext: ".php",
    owner: "h",
    shapes: {
      control: "<?php\nfunction f(){return 1;}\nfunction g(){return 2;}\nfunction h(){ f(); }\n",
      grouped: "<?php\nfunction f(){return 1;}\nfunction g(){return 2;}\nfunction h(){ (f)(); }\n",
      conditional: "<?php\nfunction f(){return 1;}\nfunction g(){return 2;}\nfunction h($c){ ($c ? f : g)(); }\n",
      lambda: null, // a PHP closure body cannot name a function as a VALUE (a bare name
      // is not an expression; `'f'` is a string), so the python shape has no PHP spelling
      nested: "<?php\nfunction f(){return 1;}\nfunction h(){ f()(); }\n",
    },
  },
  go: {
    ext: ".go",
    owner: "h",
    shapes: {
      control: "package p\nfunc f() int { return 1 }\nfunc g() int { return 2 }\nfunc h() { f() }\n",
      grouped: "package p\nfunc f() int { return 1 }\nfunc g() int { return 2 }\nfunc h() { (f)() }\n",
      conditional: null, // no ternary in Go (by design, not by accident)
      lambda: null, // no lambda expression; func literals need an immediate call form
      nested: "package p\nfunc f() func() int { return nil }\nfunc h() { f()() }\n",
    },
  },
  rust: {
    ext: ".rs",
    owner: "h",
    shapes: {
      control: "fn f() -> i32 { 1 }\nfn g() -> i32 { 2 }\nfn h() { f(); }\n",
      grouped: "fn f() -> i32 { 1 }\nfn g() -> i32 { 2 }\nfn h() { (f)(); }\n",
      conditional: null, // no ternary (if/else is a statement/expression, not a callee form)
      lambda: "fn f() -> i32 { 1 }\nfn h() { (|| f)(); }\n",
      nested: "fn f() -> fn() -> i32 { f2 }\nfn f2() -> i32 { 2 }\nfn h() { f()(); }\n",
    },
  },
  java: {
    ext: ".java",
    owner: "h",
    shapes: {
      control: "class T { static int f(){return 1;} static int g(){return 2;} static void h(){ f(); } }\n",
      grouped: "class T { static int f(){return 1;} static int g(){return 2;} static void h(){ (f)(); } }\n",
      conditional: null, // a ternary is not a valid method-invocation target in Java
      lambda: null, // a lambda needs a functional-interface target to be invoked
      nested: null, // `f()()` is not a valid Java expression
    },
  },
  csharp: {
    ext: ".cs",
    owner: "H",
    shapes: {
      control: "class T { static int F(){return 1;} static int G(){return 2;} static void H(){ F(); } }\n",
      grouped: "class T { static int F(){return 1;} static int G(){return 2;} static void H(){ (F)(); } }\n",
      conditional: null, // a conditional expression cannot be invoked directly in C#
      lambda: null, // a lambda needs a delegate type to be invoked
      nested: null, // `F()()` is not a valid C# expression
    },
  },
  ruby: {
    ext: ".rb",
    owner: "h",
    shapes: {
      control: "def f\n  1\nend\ndef g\n  2\nend\ndef h\n  f\nend\n",
      grouped: "def f\n  1\nend\ndef g\n  2\nend\ndef h\n  (f).call\nend\n",
      conditional: null, // `(c ? f : g).call` calls a METHOD on the ternary's value, not the branch
      lambda: null, // a bare name in a Ruby block is a method CALL, not a value, so the
      // body cannot hold a reference to `f`; `method(:f)` would be a different shape
      nested: null, // Ruby invokes a returned callable with `.call`, not `f()()` — the
      // shape has no Ruby spelling (and `f.call` is a member call, already covered)
    },
  },
}

const SHAPE_NA: Record<string, string> = {
  "go:conditional": "Go has no ternary expression, by language design",
  "go:lambda": "a Go func literal must be invoked as a call form, not as a grouped callee",
  "rust:conditional": "Rust has no ternary; if/else cannot be a callee without a closure",
  "java:conditional": "a ternary is not a valid invocation target in Java",
  "java:lambda": "a lambda needs a functional-interface target to be invoked",
  "java:nested": "`f()()` is not a valid Java expression",
  "csharp:conditional": "a conditional expression cannot be invoked directly in C#",
  "csharp:lambda": "a lambda needs a delegate type to be invoked",
  "csharp:nested": "`F()()` is not a valid C# expression",
  "ruby:conditional": "`(c ? f : g).call` invokes a METHOD on the ternary's value, not a branch of it",
  "php:lambda": "a PHP closure body cannot hold a function as a value: a bare name is not an expression there",
  "ruby:lambda": "a bare name in a Ruby block is a method CALL, so the block cannot hold a value reference",
  "ruby:nested": "Ruby invokes a returned callable with `.call`, not `f()()`",
}

async function main() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  const rows: any[] = []
  for (const [lang, spec] of Object.entries(SNIPPETS)) {
    const cells: Record<string, string> = {}
    for (const shape of Object.keys(spec.shapes) as Shape[]) {
      const src = spec.shapes[shape]
      if (src === null) { cells[shape] = "n/a"; continue }
      const file = path.join(TMP, `snippet-${lang}-${shape}${spec.ext}`)
      writeFileSync(file, src)
      let rels: any[] = []
      try {
        const res: any = await ASTEngine.parseFile(file, src)
        rels = res?.relationships ?? []
      } catch (e: any) {
        cells[shape] = `error(${String(e?.message ?? e).slice(0, 40)})`
        continue
      }
      // Attribute by OWNER FUNCTION, not by line. The shape is always called inside
      // the owner (`h`/`H`) and never inside `f`/`g`, so an edge FROM the owner is the
      // shape's own edge — and unlike a line rule this survives languages whose block
      // closes after the call (ruby's `end`, php's `}`), which silently made a
      // line-based draft report "control missing" on lanes that were fine.
      // `target@line` is still carried so a line defect is visible beside the target.
      const owner = spec.owner
      const calls = rels
        .filter((r) => (r.type ?? r.relationshipType) === "calls")
        .filter((r) => {
          const from = String(r.fromSymbol ?? r.source ?? r.from ?? "")
          return from === owner || from.endsWith("." + owner) || from.toLowerCase() === owner.toLowerCase()
        })
        .map((r) => `${String(r.target)}@${r.line_number ?? r.line ?? 0}`)
        .sort()
      cells[shape] = calls.length ? calls.join("+") : "(none)"
    }
    rows.push({ lang, owner: spec.owner, cells })
    console.log(`${lang.padEnd(11)} control=${(cells.control ?? "?").padEnd(14)} grouped=${(cells.grouped ?? "?").padEnd(14)} conditional=${(cells.conditional ?? "?").padEnd(14)} lambda=${(cells.lambda ?? "?").padEnd(14)} nested=${cells.nested}`)
  }
  rmSync(TMP, { recursive: true, force: true })

  // The reading, per shape, from the owner's own edges.
  const targetsOf = (row: any, shape: Shape): string[] => {
    const cell = String(row.cells[shape] ?? "")
    // `n/a` is not a measurement: a shape a language cannot write is exempt by
    // grammar. Treating it as a target convicted five lanes for the string "n/a"
    // on the first run of this reader — the defect the reader exists to avoid.
    if (cell === "n/a" || cell === "(none)" || cell.startsWith("error(")) return []
    return cell.split("+").map((c) => c.slice(0, c.lastIndexOf("@")))
  }
  const wrong: string[] = []
  const controlMissing: string[] = []
  for (const row of rows) {
    // The lane spells its own symbols in its own case (csharp's `F`), so the control
    // is checked case-insensitively — a probe that convicts a lane for its naming
    // convention would be this instrument inventing a defect.
    if (!targetsOf(row, "control").map((s) => s.toLowerCase()).includes("f")) controlMissing.push(row.lang)
    const cond = targetsOf(row, "conditional")
    if (cond.length) wrong.push(`${row.lang}: names a CONDITIONAL BRANCH (${cond.join("+")})`)
    const lam = targetsOf(row, "lambda")
    if (lam.length) wrong.push(`${row.lang}: names a LAMBDA BODY (${lam.join("+")})`)
    // `nested` is NOT adjudicated here, and the reason is structural: the outer call's
    // callee IS the inner call, whose name and line are exactly what the inner call
    // legitimately emits — so the two are indistinguishable in the edge set. Reported
    // as a cell (read it), never convicted.
  }
  // Grouping is transparent, so naming the inner name is right; naming it WITH its
  // brackets is a separate defect — a target SPELLING, which R10 convicts as its
  // delimiter/whitespace class and which this census therefore reports, not convicts.
  const groupedNamed = (row: any) => targetsOf(row, "grouped").some((s) => s.toLowerCase() === "f")
  const groupedSpelled = rows.filter((r) => targetsOf(r, "grouped").some((s) => s.includes("("))).map((r) => r.lang)
  console.log(`\nlanes measured: ${rows.length} | control missing (lane did not walk calls): ${controlMissing.join(", ") || "none"}`)
  console.log(`names something that is not the callee: ${wrong.length ? wrong.join(" | ") : "none"}`)
  console.log(`grouped callee (transparent: statically a name) named as the inner name by: ${rows.filter((r) => groupedNamed(r)).map((r) => r.lang).join(", ") || "none"}`)
  console.log(`grouped callee published WITH its brackets as the target spelling (R10's delimiter class — reported, not convicted here): ${groupedSpelled.join(", ") || "none"}`)
  console.log(`n/a shapes are recorded with their reason in SHAPE_NA (${Object.keys(SHAPE_NA).length} entries)`)
}

if (import.meta.main) main()
