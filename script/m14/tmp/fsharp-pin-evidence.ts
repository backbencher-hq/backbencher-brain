/**
 * script/m14/tmp/fsharp-pin-evidence.ts
 *
 * The fsharp pin says: "the wired wasm is upstream tree-sitter-fsharp@0.3.11 plus
 * exactly two grammar rules (`module_val_declaration`, `nullable_type`) plus a
 * scanner patch whose source is not in-tree". Two of those three clauses can be
 * measured offline, and this probe measures them:
 *
 *   (a) SOURCE DELTA — the vendored `grammars/tree-sitter-fsharp/fsharp/grammar.js`
 *       rule set against the npm 0.3.11 tarball's generated `fsharp/src/grammar.json`
 *       rule set. Extraction traps, both hit while building this: rules whose
 *       builder takes `(_)` instead of `($)`, and rules generated through computed
 *       keys (`["preproc_if" + suffix]: ...` inside `preprocIf()`) — a naive
 *       `name: ($) =>` regex reported 29 phantom deletions and then 10 more.
 *   (b) CONSTRUCT A/B — the wired wasm against the npm 0.3.11 wasm, on the two
 *       patched constructs plus the scanner's recorded complaint (the FIRST
 *       `interface T` inside an implicit class body), plus a control.
 *
 * Writes validation/m14/results/archive/fsharp-pin-evidence.json. Changes nothing.
 */
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { execSync } from "child_process"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun.main), "..", "..", "..")
const HOME = process.env.HOME ?? ""
const TARBALL = path.join(HOME, ".bun/install/cache/tree-sitter-fsharp@0.3.11@@@1")
const OUT = path.join(ROOT, "validation/m14/results/archive/fsharp-pin-evidence.json")
const VENDORED_GRAMMAR = path.join(ROOT, "grammars/tree-sitter-fsharp/fsharp/grammar.js")

/** Grammar-level keys are not rules: they configure the generator, they do not
 * produce node types. `global` is one of them (see the artifact's `grammarKeys`). */
const GRAMMAR_KEYS = new Set(["conflicts", "externals", "extras", "inline", "supertypes", "word", "global"])

function vendoredRuleNames(src: string): Set<string> {
  const names = new Set<string>()
  // plain rules: `name: ($) =>` / `name: (_) =>`
  for (const m of src.matchAll(/^\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*\(\s*[$_]\s*\)\s*=>/gm)) {
    if (!GRAMMAR_KEYS.has(m[1])) names.add(m[1])
  }
  // spread-generated rules: `["preproc_if" + suffix]: ($) => ...`
  const generated: string[] = []
  for (const m of src.matchAll(/\["([a-zA-Z_]+)"\s*\+\s*suffix\]\s*:\s*\(\s*[$_]\s*\)\s*=>/g)) generated.push(m[1])
  // the suffixes actually passed to the generator: `...preprocIf("", ...)`, `...preprocIf("_in_expression", ...)`
  const suffixes = new Set<string>([""])
  for (const m of src.matchAll(/\.\.\.preprocIf\(\s*"([a-zA-Z_]*)"/g)) suffixes.add(m[1])
  for (const g of generated) for (const s of suffixes) names.add(g + s)
  return names
}

function dump(node: any, depth = 0, out: string[] = []): string[] {
  out.push(`${"  ".repeat(depth)}${node.type}${node.childCount === 0 ? ` ${JSON.stringify(node.text)}` : ""}`)
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c) dump(c, depth + 1, out)
  }
  return out
}

const SNIPPETS: Array<{ id: string; construct: string; source: string }> = [
  {
    id: "nullable-type-return",
    construct: "`member … : string | null` — tree-sitter-fsharp#nullable_type (patched rule)",
    source: "type C() =\n  member _.M() : string | null = null\n",
  },
  {
    id: "nullable-type-binding",
    construct: "`let x : string | null` — the patched rule in a value binding",
    source: "let x : string | null = null\n",
  },
  {
    id: "nullable-type-abbrev",
    construct: "`type T = string | null` — the patched rule in a type abbreviation",
    source: "type T = string | null\n",
  },
  {
    id: "nullable-type-param",
    construct: "`let f (x: string | null)` — the patched rule in a parameter annotation",
    source: "let f (x: string | null) = x\n",
  },
  {
    id: "implicit-class-interface-first",
    construct: "an IMPLICIT class body (`type C =`, no ctor args) whose first member is `interface I with` — the scanner's recorded complaint",
    source: "type I =\n  abstract member F : unit -> unit\n\ntype C =\n  interface I with\n    member _.F() = ()\n",
  },
  {
    id: "implicit-class-interface-only",
    construct: "an implicit class body whose ONLY member is `interface I with`",
    source: "type I =\n  abstract member F : unit -> unit\n\ntype C =\n  interface I with\n    member _.F() = ()\n",
  },
  {
    id: "module-val-declaration",
    construct: "a `val` declaration inside a module — tree-sitter-fsharp#module_val_declaration (patched rule)",
    source: "module M =\n  val x : int\n",
  },
  {
    id: "interface-first-member",
    construct: "the FIRST `interface T` inside an implicit class body — the scanner's recorded complaint",
    source: "type I =\n  abstract member F : unit -> unit\n\ntype C() =\n  interface I with\n    member _.F() = ()\n  member _.G() = ()\n",
  },
  {
    id: "interface-only-member",
    construct: "an implicit class body whose ONLY member is the interface implementation",
    source: "type I =\n  abstract member F : unit -> unit\n\ntype C() =\n  interface I with\n    member _.F() = ()\n",
  },
  {
    id: "control-plain-class",
    construct: "control: ordinary class members (no patched construct)",
    source: "type C() =\n  member _.G() = ()\n  member _.H(x: int) = x\n",
  },
]

async function main() {
  const src = fs.readFileSync(VENDORED_GRAMMAR, "utf8")
  const vendored = vendoredRuleNames(src)
  const upstream = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(TARBALL, "fsharp/src/grammar.json"), "utf8")).rules as Record<string, unknown>))
  const vendoredOnly = [...vendored].filter((n) => !upstream.has(n)).sort()
  const upstreamOnly = [...upstream].filter((n) => !vendored.has(n)).sort()
  const grammarKeysInVendored = [...GRAMMAR_KEYS].filter((k) => new RegExp(`^\\s+${k}\\s*:` , "m").test(src))

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const wiredWasm = fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))
  const baseWasm = fs.readFileSync(path.join(TARBALL, "tree-sitter-fsharp.wasm"))
  const wired = await Language.load(wiredWasm)
  const base = await Language.load(baseWasm)

  const snippets: any[] = []
  for (const s of SNIPPETS) {
    const row: any = { id: s.id, construct: s.construct, source: s.source }
    for (const [label, g] of [["wired", wired], ["npm-0.3.11-unpatched", base]] as const) {
      const p = new ParserClass()
      p.setLanguage(g)
      const tree = p.parse(s.source)
      row[label] = { hasError: tree.rootNode.hasError, tree: dump(tree.rootNode) }
      tree.delete?.()
      p.delete?.()
    }
    row.treesDiffer = JSON.stringify(row.wired.tree) !== JSON.stringify(row["npm-0.3.11-unpatched"].tree)
    snippets.push(row)
  }

  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
    grammarSource:
      "grammars/tree-sitter-fsharp/fsharp/grammar.js vs the npm tree-sitter-fsharp@0.3.11 tarball's generated fsharp/src/grammar.json",
    vendoredGrammarSha256: createHash("sha256").update(src).digest("hex"),
    sourceDelta: {
      vendoredRuleCount: vendored.size,
      upstreamRuleCount: upstream.size,
      vendoredOnly,
      upstreamOnly,
      grammarKeysInVendored,
      reading:
        vendoredOnly.join(",") === "module_val_declaration,nullable_type" && upstreamOnly.length === 0
          ? "the vendored grammar's rule set is the 0.3.11 rule set plus exactly the two patched rules; its grammar-level keys (which produce no node types) are listed in grammarKeysInVendored"
          : "the vendored grammar's rule set differs from 0.3.11 in ways beyond the two patched rules — read the lists",
    },
    wasmSHAs: {
      wired: createHash("sha256").update(wiredWasm).digest("hex"),
      "npm-0.3.11-unpatched": createHash("sha256").update(baseWasm).digest("hex"),
    },
    constructAB: snippets,
    scannerClaim: (() => {
      const variants = snippets.filter((s) => s.id.startsWith("implicit-class-interface"))
      const differing = variants.filter((s) => s.treesDiffer).map((s) => s.id)
      if (differing.length) return `the interface-in-implicit-class snippets parse DIFFERENTLY under the wired wasm and unpatched 0.3.11 (${differing.join(", ")}), consistent with a scanner patch that is not vendored`
      return "the interface-in-implicit-class snippets parse IDENTICALLY under the wired wasm and unpatched 0.3.11: for these inputs the wired wasm shows no scanner-patch behaviour, so nothing here corroborates the manifest's scanner claim — and the claimed patch's source is not in the tree either, so the claim stays recorded-not-corroborated"
    })(),
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")

  console.log(`vendored rules ${vendored.size} vs upstream ${upstream.size}`)
  console.log(`  vendored-only: ${vendoredOnly.join(", ") || "(none)"}`)
  console.log(`  upstream-only: ${upstreamOnly.join(", ") || "(none)"}`)
  console.log(`  => ${out.sourceDelta.reading}`)
  console.log("\nconstruct A/B (wired vs npm-0.3.11-unpatched):")
  for (const s of snippets) {
    console.log(`  ${s.id.padEnd(26)} wired.error=${String(s.wired.hasError).padEnd(5)} base.error=${String(s["npm-0.3.11-unpatched"].hasError).padEnd(5)} treesDiffer=${s.treesDiffer}`)
  }
  console.log(`\n  scanner claim: ${out.scannerClaim}`)
  console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
