/**
 * HCL PROBE — measure the four types HCL-D1 rules on PROSE, before ruling any of them.
 *
 * ## Why this file exists
 *
 * HCL is one of three laptop-B lanes with NO ruling table. Its verdicts come from
 * `script/m14/spec/hcl-completeness.json` HCL-D1, and the arbiter itself prints the
 * caveat: "a spec ruling is prose; a table ruling is a corpus probe. They are not
 * equally strong."
 *
 * HCL-D1 rules FIVE types NOT APPLICABLE: calls, extends, implements, overrides,
 * instantiates. Two of those five are contradicted by the analyzer's own source:
 *
 *   - `real-hcl-analyzer.ts:528` emits `RelationshipType.Calls` for a callee a
 *     `function` block in the same file declares. HCL-D1 says "NOT ONE callee
 *     resolves to a symbol the project declares, because the grammar provides no
 *     syntax for declaring one" — and `FUNCTION_DECL_BLOCKS` (line 131) is the
 *     syntax it means, in the same file.
 *   - `real-hcl-analyzer.ts:485` emits `RelationshipType.Overrides`, and the
 *     OVERRIDE_BLOCK_KIND table (line 150) is a measured 71 blocks / 33 files.
 *     HCL-D1 lists `overrides` among the five INEXPRESSIBLE kinds.
 *
 * So the first question is not "is HCL-D1 right" but "which half is stale". A ruling
 * that contradicts the code it governs is not a ruling, in either direction.
 *
 * ## The discipline this probe follows, and why each part is here
 *
 * 1. POSITIVE CONTROL FIRST. Every probe below is paired with a synthetic file that
 *    MUST produce a hit. The programme has three recorded instances of a probe that
 *    returned a confident zero because it could not fire — PHP's `define()` probe
 *    (read `namedChild(0)` where the grammar puts an `argument` node in between, so
 *    no corpus could ever falsify it), CSS's pass-1 containment check (read
 *    `symbol.range.start.line`, but `parseFile` returns no `range`), and ZIG's P12
 *    (buckets swapped, so 0 edges over 1,528 sites read as clean). A zero from a
 *    probe that has never been shown to fire is not a finding about HCL.
 *
 * 2. BOTH INSTRUMENTS, CHOSEN BY THE QUESTION. Instrument A (grammar inventory) for a
 *    type needing a node type HCL lacks — enumerating what the grammar DOES produce is
 *    positive evidence of absence. Instrument B (parse-tree count) for a type HCL CAN
 *    express, where only the tree can decide and no string or heredoc can fake it.
 *
 * 3. NO REGEX over source text. Regex matches comments and string literals. Every
 *    count here comes off the tree.
 *
 * 4. THE POPULATION IS PRINTED. Every number states the corpus it was measured over,
 *    because a count without a population is the defect this programme keeps paying for.
 *
 * ## Usage
 *
 *   npx tsx script/m14/hcl-probe.ts            # corpus + controls
 *   npx tsx script/m14/hcl-probe.ts --controls # controls only, no corpus walk
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import * as wts from "web-tree-sitter"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const SIZE_CAP = 1024 * 1024
const CONTROLS_ONLY = process.argv.includes("--controls")

/** Explicit-stack preorder, identical order to the recursive form. Recursion dies on
 *  deep nesting — dart's own suite keeps such a file in order to exercise it. */
function walkPreorder(root: any, visit: (n: any) => void): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    visit(n)
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
  }
}

// ---------------------------------------------------------------- the probes
//
// Each probe reports hits on the TREE. `describe` is what it looked for, and it is
// what the ruling table will publish, so a reader can check the probe against the
// verdict rather than trust the verdict.

type Probe = {
  type: string
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  describe: string
  /** For A: node types whose presence in the observed grammar would express the construct. */
  wouldMeanIt?: string[]
  countOnTree?: (root: any, label: string, hits: string[]) => void
}

const text = (n: any): string => (n == null ? "" : String(n.text ?? ""))

/**
 * Labels of a one-or-more-label block, the HCL spelling `type "name" { … }`.
 *
 * TWO DEFECTS FOUND HERE BY THE POSITIVE CONTROLS, both of which had made every
 * control read 0 — the exact PHP `define()` failure (a probe that cannot fire returns
 * the same number as a clean one):
 *
 *  1. A `string_lit` node's `.text` INCLUDES ITS QUOTES. `function "bindir"` yields
 *     the label `"bindir"`, quotes included, which never equals the callee `bindir`
 *     the `function_call` node spells. The first version compared them directly, so
 *     the declaration set was `{'"bindir"'}` and every call missed it.
 *  2. A `block` with NO labels — `override_resource { … }` — yields only its
 *     identifier, and its `body`/`attribute` children are not label-shaped, so a naive
 *     filter is right by accident here while a block with labels needs the unwrapping.
 *
 * Measured shape, from `.tmp-probe/hcl/shape2.mts`:
 *   (block (identifier) (string_lit …) (block_start) (body …) (block_end))
 *   (block (identifier) (block_start) (body (attribute (identifier) …)) (block_end))
 */
function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, "").replace(/^"|"$/g, "")
}

/** Labels of a block, unquoted, in source order. */
function blockLabels(block: any): string[] {
  return block.namedChildren
    .filter((c: any) => c.type === "identifier" || c.type === "string_lit" || c.type === "quoted_template")
    .map((c: any) => unquote(text(c)))
}

/**
 * The key of an `attribute` node.
 *
 * NOT `blockLabels`. An attribute is `(attribute (identifier) (expression …))`, so its
 * key is a bare `identifier` child — but reading it through a shared label helper is
 * what made the overrides probe vacuous, because that helper was also being asked for
 * block labels and the two node shapes are not interchangeable.
 */
function attributeKey(attr: any): string {
  return unquote(text(attr.namedChildren?.[0]))
}

const PROBES: Probe[] = [
  {
    type: "extends",
    instrument: "A:grammar-inventory",
    describe: "a type declaration carrying a supertype clause",
    wouldMeanIt: [
      "class_declaration",
      "class_specifier",
      "interface_declaration",
      "struct_declaration",
      "trait_declaration",
      "inheritance_specifier",
      "extends_clause",
      "base_clause",
      "superclass",
      "implements_clause",
    ],
  },
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    describe: "a supertype clause naming an implemented or inherited type",
    wouldMeanIt: [
      "implements_clause",
      "interface_implementation",
      "implements_list",
      "extends_clause",
      "superclass",
      "base_clause",
    ],
  },
  {
    type: "instantiates",
    instrument: "A:grammar-inventory",
    describe: "a constructor call — `new T(…)` or a declared-type construction",
    wouldMeanIt: [
      "new_expression",
      "object_creation_expression",
      "constructor_invocation",
      "instantiation_expression",
      "new_declaration",
    ],
  },
  {
    // `calls` is the sharp one. HCL-D1 says no callee resolves to a project
    // declaration, and this probe tests that claim DIRECTLY rather than by counting
    // `function_call` nodes — a count of call nodes cannot distinguish a global
    // builtin call from a call to something the same file declares, which is
    // precisely the distinction the ruling turns on.
    type: "calls",
    instrument: "B:parse-tree-count",
    describe:
      "a `function_call` whose callee is declared by a `function` block in the SAME file (docker-bake / Terraform 1.8+ `func`)",
    countOnTree: (root, label, hits) => {
      const decls = new Set<string>()
      walkPreorder(root, (n: any) => {
        if (n.type !== "block") return
        const labels = blockLabels(n)
        const kw = labels[0]
        if ((kw === "function" || kw === "func") && labels.length > 1) decls.add(labels[1])
      })
      if (decls.size === 0) return
      walkPreorder(root, (n: any) => {
        if (n.type !== "function_call") return
        const fn = n.childForFieldName?.("function") ?? n.namedChildren?.[0]
        const callee = text(fn).replace(/^.*::/, "")
        if (decls.has(callee)) hits.push(`${label}: call ${callee} (declared in this file)`)
      })
    },
  },
  {
    type: "overrides",
    instrument: "B:parse-tree-count",
    describe:
      "an `override_resource`/`override_data`/`override_module` block carrying a `target` attribute — Terraform's own override spelling",
    countOnTree: (root, label, hits) => {
      walkPreorder(root, (n: any) => {
        if (n.type !== "block") return
        const kw = blockLabels(n)[0]
        if (kw !== "override_resource" && kw !== "override_data" && kw !== "override_module") return
        let hasTarget = false
        walkPreorder(n, (c: any) => {
          if (c.type === "attribute" && attributeKey(c) === "target") hasTarget = true
        })
        if (hasTarget) hits.push(`${label}: ${kw} with target`)
      })
    },
  },
]

// ---------------------------------------------------------------- positive controls
//
// These are the reason this probe exists. Each is a synthetic HCL file whose
// construct the matching probe MUST find. If a control reports 0, that probe is
// broken and every zero it produces over the corpus is void — which is the PHP
// `define()` and CSS containment failure exactly.

const CONTROLS: { name: string; expectType: string; source: string }[] = [
  {
    name: "calls/function-decl",
    expectType: "calls",
    source: [
      'function "bindir" {',
      '  return "/usr/local/bin"',
      "}",
      'resource "x" "y" {',
      '  a = bindir()',
      "}",
    ].join("\n"),
  },
  {
    // Terraform 1.8+ spells the same construct `func`. HCL's own analyzer comment
    // (line 122) says `func` occurs 0 times in the corpus and is NOT read — this
    // control exists so that if anyone adds `func` to FUNCTION_DECL_BLOCKS, the
    // corpus count they report has a control that fires.
    name: "calls/func-decl",
    expectType: "calls",
    source: ['func "greet" {', '  return "hi"', "}", 'locals {', '  a = greet()', "}"].join("\n"),
  },
  {
    name: "overrides/resource",
    expectType: "overrides",
    source: ['override_resource {', '  target = aws_instance.first', '  ami = "x"', "}"].join("\n"),
  },
  {
    name: "overrides/module",
    expectType: "overrides",
    source: ["override_module {", '  target = module.vpc', "}"].join("\n"),
  },
  {
    // NEGATIVE CONTROL. A plain block with no override keyword must NOT hit the
    // overrides probe. A probe with no negative control cannot distinguish "found
    // the construct" from "matches blocks", which is the TOML `references` and ZIG
    // P12 shape.
    name: "overrides/NEGATIVE-plain-block",
    expectType: "overrides",
    source: ['resource "aws_instance" "first" {', '  ami = "x"', "}"].join("\n"),
  },
]

/**
 * Run every semantic probe over one tree.
 *
 * `tree` is a web-tree-sitter TREE, not a root node, and the `.rootNode` is taken HERE
 * rather than by the caller. That was the third defect the controls caught, and it is
 * the most expensive of the three to see by reading: the caller passed a `Tree`, every
 * probe walked `n.type` on a node whose `type` is undefined, every probe matched
 * nothing, and all five controls reported 0 in a single clean sweep. Nothing threw.
 *
 * A probe that receives the wrong shape and reports zero is indistinguishable from a
 * probe that is correct and the language is silent, which is why the controls assert a
 * HIT rather than asserting the absence of a crash.
 */
function runProbes(tree: any, label: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const root = tree?.rootNode ?? tree
  for (const p of PROBES) {
    if (!p.countOnTree) continue
    const hits: string[] = []
    p.countOnTree(root, label, hits)
    out.set(p.type, hits)
  }
  return out
}

// ---------------------------------------------------------------- main
const Parser = (wts as any).Parser ?? (wts as any).default?.Parser ?? (wts as any).default
const Language = (wts as any).Language ?? (wts as any).default?.Language ?? (wts as any).default
await Parser.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new Parser()
parser.setLanguage(
  await Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-hcl.wasm"))),
)

console.log("HCL PROBE — measuring the five types HCL-D1 rules on prose")
console.log(`population: $HOME/fixtures/repositories, ${CR}`)
console.log()

// ---- controls first. A probe whose control cannot fire is not measured at all.
console.log("POSITIVE CONTROLS (must fire; a zero here voids that probe's corpus result)")
let controlsOk = true
for (const c of CONTROLS) {
  const tree = parser.parse(c.source)
  const hits = runProbes(tree as any, c.name)
  const got = hits.get(c.expectType) ?? []
  const isNegative = c.name.includes("NEGATIVE")
  const pass = isNegative ? got.length === 0 : got.length > 0
  if (!pass) controlsOk = false
  console.log(
    `  ${pass ? "PASS" : "FAIL"}  ${c.name.padEnd(38)} expected ${c.expectType} ${isNegative ? "0 hits" : ">=1 hit"}, got ${got.length}` +
      (got.length && !isNegative ? `  e.g. ${got[0]}` : ""),
  )
}
console.log()
if (!controlsOk) {
  console.log("REFUSING TO REPORT. At least one control did not behave as declared, so a zero from")
  console.log("that probe over the corpus would be a broken instrument reading as a finding about HCL.")
  process.exit(1)
}
console.log("all controls behaved as declared — corpus results below are instrumented, not assumed")
console.log()

if (CONTROLS_ONLY) process.exit(0)

// ---- corpus
const files: { repo: string; rel: string; abs: string; text: string }[] = []
const excluded = { tracked: 0, absent: 0, overCap: 0 }
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    excluded.tracked++
    let t: string
    try {
      const size = statSync(abs).size
      if (size > SIZE_CAP) {
        if (detectLanguageFromPath(abs) === "hcl") excluded.overCap++
        continue
      }
      t = readFileSync(abs, "utf8")
    } catch {
      if (detectLanguageFromPath(abs) === "hcl") excluded.absent++
      continue
    }
    if (detectLanguageFromPath(abs, t) !== "hcl") continue
    files.push({ repo: e, rel, abs, text: t })
  }
}
console.log(
  `corpus: ${files.length} admitted .hcl files; walked ${excluded.tracked} tracked paths; ` +
    `this lane EXCLUDED ${excluded.absent} absent/unreadable + ${excluded.overCap} over the 1 MB cap`,
)
console.log()

// Instrument A: the grammar's own vocabulary, observed across the whole corpus.
//
// NAMED and ANONYMOUS are counted SEPARATELY, and the reason is a bookkeeping collision
// worth naming: the spec's `corpus.grammarNamedTypes` is 64, and a single flat count of
// every node type the parser produces reads 86. Those are not two measurements of one
// population — the flat count includes anonymous punctuation tokens (`{`, `}`, `=`, `(`,
// `)`, `,`, `[`, `]`), and a node-type inventory used as evidence of ABSENCE must say
// which set it enumerated. Conflating them makes an inventory look larger than the
// grammar's declared vocabulary, which would overstate the strength of every ruling
// built on it.
const grammarTypes = new Map<string, number>()
const grammarNamed = new Set<string>()
const grammarAnon = new Set<string>()
// Instrument B: semantic counts.
const hitsByType = new Map<string, { n: number; files: Set<string>; examples: string[] }>()
const probesWithB = PROBES.filter((p) => p.countOnTree)

let filesWithFunctionDecl = 0
const functionDeclNames = new Map<string, number>()

for (const f of files) {
  const tree = parser.parse(f.text)
  if (!tree) continue
  walkPreorder(tree.rootNode, (n: any) => {
    grammarTypes.set(n.type, (grammarTypes.get(n.type) ?? 0) + 1)
    ;(n.isNamed ? grammarNamed : grammarAnon).add(n.type)
  })

  for (const p of probesWithB) {
    const before = (hitsByType.get(p.type)?.n ?? 0)
    const hits: string[] = []
    p.countOnTree!(tree.rootNode, `${f.repo}/${f.rel}`, hits)
    const row = hitsByType.get(p.type) ?? { n: 0, files: new Set<string>(), examples: [] }
    row.n += hits.length
    if (hits.length > 0) {
      row.files.add(`${f.repo}/${f.rel}`)
      if (row.examples.length < 5) row.examples.push(...hits.slice(0, 5 - row.examples.length))
    }
    if (row.n !== before) hitsByType.set(p.type, row)
  }

  // Independent count of function declarations, so the `calls` verdict is not taken
  // on the probe's own word: this walks for `function`/`func` blocks directly.
  let declHere = false
  walkPreorder(tree.rootNode, (n: any) => {
    if (n.type !== "block") return
    const labels = blockLabels(n)
    if ((labels[0] === "function" || labels[0] === "func") && labels.length > 1) {
      declHere = true
      functionDeclNames.set(labels[1], (functionDeclNames.get(labels[1]) ?? 0) + 1)
    }
  })
  if (declHere) filesWithFunctionDecl++

  tree.delete?.()
}

console.log(`GRAMMAR INVENTORY (instrument A)`)
console.log(
  `   ${grammarTypes.size} distinct node types the parser produced over ${files.length} files, of which`,
)
console.log(
  `   ${grammarNamed.size} are NAMED (grammar vocabulary) and ${grammarAnon.size} are ANONYMOUS (punctuation/keywords:`,
)
console.log(`   ${[...grammarAnon].sort().join(" ")})`)
console.log(
  `   The instrument-A denominator below is the ${grammarNamed.size} NAMED types. A flat count including`,
)
console.log(`   punctuation would overstate the grammar's vocabulary and inflate every absence ruling.`)
console.log()

for (const p of PROBES) {
  if (p.instrument === "A:grammar-inventory") {
    const present = (p.wouldMeanIt ?? []).filter((t) => grammarTypes.has(t))
    console.log(`${p.type}  [A:grammar-inventory]  ${p.describe}`)
    console.log(`   probed for ${(p.wouldMeanIt ?? []).length} node types: ${present.length} present`)
    if (present.length) {
      console.log(`   PRESENT: ${present.join(", ")}  <-- the ruling is FALSIFIED, these nodes exist`)
      for (const t of present) console.log(`     ${t}: ${grammarTypes.get(t)} occurrences`)
    }
    console.log()
  } else {
    const row = hitsByType.get(p.type)
    console.log(`${p.type}  [B:parse-tree-count]  ${p.describe}`)
    console.log(`   ${row?.n ?? 0} occurrences across ${row?.files.size ?? 0} files`)
    for (const ex of row?.examples ?? []) console.log(`     ${ex}`)
    console.log()
  }
}

console.log(`INDEPENDENT CHECK — function declarations found by a walk separate from the probes:`)
console.log(`   ${functionDeclNames.size} distinct name(s) across ${filesWithFunctionDecl} file(s)`)
for (const [n, c] of [...functionDeclNames].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`     ${n}: ${c}`)
console.log()
console.log("The `calls` verdict is only sound if the probe and this independent count agree.")
console.log("A probe reporting a hit with no declaration behind it is a name collision — the exact")
console.log("shape HCL-D1 claims for `length`/`file`/`timestamp`/`lower`/`object`.")
console.log(`A declaration with no probe hit is a probe that cannot see its own construct.`)