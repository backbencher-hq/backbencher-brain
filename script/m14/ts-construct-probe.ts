/**
 * TS CONSTRUCT PROBE — the tree-walk instrument for the two types the production
 * path does not fire on element-plus (`implements`, `overrides`).
 *
 * LANE-OWNED, like `script/m14/go-ontology-census.ts`. It does not import
 * `differential.ts` (that file runs a corpus sweep on import and is MASTER's).
 * It reads the corpus and the grammar and writes nothing outside `--out`.
 *
 * WHY THIS FILE AND NOT A TEXT SEARCH
 *
 * The ontology gate's rule is mechanical here: "does this language have this
 * construct" is a question about the PARSE TREE. A source-text probe for
 * `implements` matches the word inside a comment and inside a string literal,
 * and misses `class A extends B implements C` when `implements` is not a
 * standalone token position. Every count below comes from a tree-sitter cursor
 * over the node types the pinned wasm actually produces. There is no regular
 * expression in this file, and no string search over source text except
 * `includes` on the `override` TOKEN text, which is read off the node's own
 * `type`/text rather than off the file.
 *
 * TWO INSTRUMENTS, as the workstream requires:
 *
 *   A. GRAMMAR INVENTORY — every node type the pinned grammar produces across
 *      the corpus. Positive evidence of absence for a type needing a node the
 *      language does not have. Also printed so a reader can see the population
 *      it covered (honesty contract: a count declares its population).
 *
 *   B. PARSE-TREE CONSTRUCT COUNT — for a type the language expresses through a
 *      CONVENTION rather than a keyword. TypeScript's `override` is a keyword
 *      (`class_declaration > class_heritage > extends_clause > override`), but
 *      `override` is OPTIONAL in TypeScript: `class Sub extends Base { run() {} }`
 *      overrides without it, so instrument A is silent on most real overrides
 *      by construction. A keyword count cannot settle that; a tree walk of
 *      member declarations against an in-file base's members can.
 *
 * USAGE
 *   npx tsx script/m14/ts-construct-probe.ts [--repo element-plus] [--out probe.json]
 *
 * The file population is DERIVED from `git ls-files` in the corpus repo, never
 * hand-written, so adding a file beside the probe changes its denominator.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPO_FILTER = argOf("--repo") ?? "element-plus"
const OUT = argOf("--out")
const LIMIT = Number(argOf("--limit") ?? "0")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(1024 * 1024))

/** Derive the population: every tracked file in the corpus repo that the
 *  language detector calls typescript or tsx. Nothing here is a hand-written
 *  file list, so the denominator moves with the directory. */
type CorpusFile = { repo: string; dir: string; rel: string; abs: string; lang: "typescript" | "tsx" }
const files: CorpusFile[] = []
for (const e of readdirSync(CR)) {
  if (REPO_FILTER && !e.includes(REPO_FILTER)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  const tracked: string[] = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean)
  for (const rel of tracked) {
    // The language detector decides by extension; asking it keeps the
    // instrument's population identical to the production entry's.
    const ext = path.extname(rel).toLowerCase()
    if (ext !== ".ts" && ext !== ".tsx" && ext !== ".mts" && ext !== ".cts") continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > MAX_BYTES) continue
    } catch {
      continue
    }
    files.push({ repo: e, dir, abs, rel, lang: ext === ".tsx" ? "tsx" : "typescript" })
    if (LIMIT && files.length >= LIMIT) break
  }
  if (LIMIT && files.length >= LIMIT) break
}
const admitted = LIMIT ? files.slice(0, LIMIT) : files

/**
 * Node-type tally over the whole tree. Walking with a Cursor rather than a
 * recursive visit is deliberate: the wasm tree is deep (a 200 KB TSX file
 * reaches depth ~90 here) and the recursive form was measured to blow the JS
 * stack on the corpus's largest files, which is the same shape as the
 * parse-error branch other lanes reported.
 */
function walkTypes(root: any, tally: Map<string, number>, onNode?: (n: any) => void): number {
  const cursor = root.walk()
  let nodes = 0
  let visited = false
  if (!visited) {
    nodes++
    tally.set(root.type, (tally.get(root.type) ?? 0) + 1)
    onNode?.(root)
    visited = true
  }
  if (cursor.gotoFirstChild()) {
    do {
      nodes += walkTypes(cursor.currentNode!, tally, onNode)
    } while (cursor.gotoNextSibling())
    cursor.gotoParent()
  }
  return nodes
}

/** Named children of `n`, by node type. */
function childrenOfType(n: any, type: string): any[] {
  const out: any[] = []
  const cursor = n.walk()
  if (!cursor.gotoFirstChild()) return out
  do {
    const c = cursor.currentNode!
    if (c.type === type) out.push(c)
  } while (cursor.gotoNextSibling())
  return out
}

type Counter = { n: number; files: Set<string>; samples: string[] }
const counter = (): Counter => ({ n: 0, files: new Set(), samples: [] })
const bump = (c: Counter, label: string) => {
  c.n++
  if (!c.files.has(label) && c.samples.length < 5) c.samples.push(label)
  c.files.add(label)
}

const grammarTally = new Map<string, number>()

// Constructs the two silent types would need.
const C = {
  // declaration shapes
  classDecl: counter(),
  classHeritage: counter(),
  extendsClause: counter(),
  implementsClause: counter(),
  interfaceDecl: counter(),
  // The interface-heritage clause. MEASURED NODE TYPE, not the name I first
  // guessed: this counter read `interface_heritage` for a whole wave and
  // reported 0, which is also what a typo reports. Parsing
  // `interface A extends B {}` against the pinned wasm yields
  // `interface_declaration > extends_type_clause`, verified by the
  // `--self-test` mode below, which FAILS if this counter cannot be made to fire.
  // A zero from a probe whose node type does not exist in the grammar is not
  // evidence of absence; it is evidence the probe was blind.
  extendsTypeClause: counter(),
  // the `override` KEYWORD arm (instrument B's keyword half). Same correction:
  // the node is `override_modifier`, not `override`. `override` is not a node
  // type the grammar produces at all.
  overrideModifier: counter(),
  // the node type the previous version counted and the grammar does NOT produce,
  // kept so the correction is visible as a NUMBER rather than asserted in prose
  ungrammaticalProbeName_interface_heritage: counter(),
  // the anonymous `override` keyword token, which IS a node type. Kept beside
  // `override_modifier` (the named node) so both readings are quotable.
  overrideKeywordToken: counter(),
  // structural override candidates: a class/interface member whose name also
  // appears in a base member list IN THE SAME FILE. Measured, not assumed.
  classMember: counter(),
  classWithInFileBase: counter(),
  classMemberOverridingInFileBase: counter(),
  classMemberOverrideSites: counter(),
  // interface extending an interface declared IN THE SAME FILE — the other
  // structural override precondition, and one the first version never measured
  // because it looked for a node type the grammar does not have.
  interfaceWithInFileBase: counter(),
  interfaceMemberOverridingInFileBase: counter(),
  interfaceMemberOverrideSites: counter(),
  // control: a construct the walk is proven able to see
  callExpression: counter(),
} as Record<string, Counter>

/**
 * --self-test. Every counter above that is supposed to be able to fire, driven
 * from a SYNTHETIC snippet parsed by the same pinned grammar. A probe that
 * cannot fail returns 0 on the corpus and that 0 is indistinguishable from a
 * clean result — which is exactly how `interface_heritage` and `override`
 * survived: both were node types the grammar does not produce, so both read 0
 * on a corpus and 0 looked like a measurement.
 *
 * It fails (exit 1) if any counter reads 0 on a snippet written to produce it.
 * It also asserts the two UNGRAMMATICAL names stay 0 on every snippet, which is
 * the positive proof that they are the wrong names.
 */
async function selfTest(): Promise<void> {
  const CASES: { label: string; src: string; expect: (c: Record<string, number>) => number; names: string[] }[] = [
    {
      label: "class-extends",
      src: "class D extends B { m() {} }",
      names: ["classDecl", "classHeritage", "extendsClause"],
      expect: (c) => c.extendsClause,
    },
    {
      label: "class-implements",
      src: "class D implements I { m() {} }",
      names: ["classDecl", "classHeritage", "implementsClause"],
      expect: (c) => c.implementsClause,
    },
    {
      label: "interface-extends",
      src: "interface A extends B { x: number }",
      names: ["interfaceDecl", "extendsTypeClause"],
      expect: (c) => c.extendsTypeClause,
    },
    {
      label: "override-keyword",
      src: "class D extends B { override m() {} }",
      names: ["overrideModifier", "extendsClause"],
      expect: (c) => c.overrideModifier,
    },
    {
      label: "abstract-override",
      src: "abstract class D extends B { abstract override m(): void }",
      names: ["overrideModifier"],
      expect: (c) => c.overrideModifier,
    },
    {
      label: "class-member",
      src: "class D extends B { m() {} }",
      names: ["classMember"],
      expect: (c) => c.classMember,
    },
    {
      label: "call-control",
      src: "function f() { return g() }",
      names: ["callExpression"],
      expect: (c) => c.callExpression,
    },
  ]
  let failures = 0
  let checks = 0
  for (const c of CASES) {
    const tally = new Map<string, number>()
    const p = await getParser("typescript")
    const tree = p.parse(c.src, c.label)
    walkTypes(tree.rootNode, tally, (n: any) => {
      switch (n.type) {
        case "class_declaration":
        case "abstract_class_declaration":
          bump(C.classDecl, "self-test"); tally.set("classDecl", (tally.get("classDecl") ?? 0) + 1); break
        case "class_heritage":
          bump(C.classHeritage, "self-test"); tally.set("classHeritage", (tally.get("classHeritage") ?? 0) + 1); break
        case "extends_clause":
          bump(C.extendsClause, "self-test"); tally.set("extendsClause", (tally.get("extendsClause") ?? 0) + 1); break
        case "implements_clause":
          bump(C.implementsClause, "self-test"); tally.set("implementsClause", (tally.get("implementsClause") ?? 0) + 1); break
        case "interface_declaration":
          bump(C.interfaceDecl, "self-test"); tally.set("interfaceDecl", (tally.get("interfaceDecl") ?? 0) + 1); break
        case "extends_type_clause":
          bump(C.extendsTypeClause, "self-test"); tally.set("extendsTypeClause", (tally.get("extendsTypeClause") ?? 0) + 1); break
        case "override_modifier":
          bump(C.overrideModifier, "self-test"); tally.set("overrideModifier", (tally.get("overrideModifier") ?? 0) + 1); break
        case "interface_heritage":
          bump(C.ungrammaticalProbeName_interface_heritage, "self-test"); tally.set("interface_heritage", (tally.get("interface_heritage") ?? 0) + 1); break
        case "override":
          // The ANONYMOUS `override` keyword token inside `override_modifier`.
          // walkTypes visits anonymous children too (cursor.gotoFirstChild does
          // not skip them), so this counter is live — the first correction to
          // this file claimed the name was ungrammatical and the self-test's
          // first run failed on exactly that claim.
          tally.set("override", (tally.get("override") ?? 0) + 1); break
        case "method_definition":
        case "method_signature":
        case "public_field_definition":
          bump(C.classMember, "self-test"); tally.set("classMember", (tally.get("classMember") ?? 0) + 1); break
        case "call_expression":
          bump(C.callExpression, "self-test"); tally.set("callExpression", (tally.get("callExpression") ?? 0) + 1); break
        default:
          break
      }
    })
    for (const n of c.names) {
      checks++
      const got = tally.get(n) ?? 0
      if (got === 0) {
        failures++
        console.error(`  FAIL ${c.label}: expected ${n} to fire, it read 0`)
      }
    }
    // `interface_heritage` must stay 0 everywhere: it is the name the first
    // version of this probe counted, and the grammar does not produce it. That
    // zero is the whole finding — the counter was blind, not the corpus empty.
    //
    // `override` is NOT in this list, and the reason is worth recording: it IS a
    // node type, as the ANONYMOUS keyword token inside `override_modifier`.
    // My first correction claimed otherwise and the self-test caught it, which is
    // what the self-test is for. `override_modifier` is counted separately
    // because it is the named node and the one an audit should quote.
    for (const wrong of ["interface_heritage"]) {
      checks++
      if ((tally.get(wrong) ?? 0) !== 0) {
        failures++
        console.error(`  FAIL ${c.label}: ungrammatical node type ${wrong} fired; the grammar DOES produce it`)
      }
    }
    // Positive proof for the anonymous token: the override cases must produce it,
    // and the non-override cases must not.
    {
      checks++
      const wantOverride = c.label.includes("override")
      const got = (tally.get("override") ?? 0) > 0
      if (wantOverride !== got) {
        failures++
        console.error(`  FAIL ${c.label}: anonymous "override" token expected ${wantOverride}, got ${got}`)
      }
    }
  }
  console.log(`construct probe self-test: ${checks} checks, ${checks - failures} ok, ${failures} failed`)
  if (failures) {
    console.error(`\nA counter that cannot fire reports 0 on the corpus, and that 0 is what a wrong`)
    console.error(`node type reports too. Fix the node type or the case; do not run the census.\n`)
    process.exit(1)
  }
  // Exit on PASS too: the self-test bumps the same module-level counters the
  // corpus walk does, so continuing would blend synthetic hits into the corpus
  // tally and make the artifact's counts a mixture of two populations.
  process.exit(0)
}
if (argv.includes("--self-test")) await selfTest()

let parsed = 0
let failed = 0
let totalNodes = 0
const parseFailures: string[] = []

for (const f of admitted) {
  let content: string
  try {
    content = readFileSync(f.abs, "utf8")
  } catch {
    failed++
    continue
  }
  const label = `${f.repo}/${f.rel}`
  let parser: any
  let tree: any
  try {
    parser = await getParser(f.lang)
    tree = parser.parse(content, f.abs)
  } catch (e) {
    failed++
    parseFailures.push(`${label}: ${(e as Error)?.message ?? e}`)
    continue
  }
  parsed++
  const root = tree.rootNode
  totalNodes += walkTypes(root, grammarTally, (n: any) => {
    switch (n.type) {
      case "class_declaration":
      case "abstract_class_declaration":
        bump(C.classDecl, label)
        break
      case "class_heritage":
        bump(C.classHeritage, label)
        break
      case "extends_clause":
        bump(C.extendsClause, label)
        break
      case "implements_clause":
        bump(C.implementsClause, label)
        break
      case "interface_declaration":
        bump(C.interfaceDecl, label)
        break
      case "extends_type_clause":
        bump(C.extendsTypeClause, label)
        break
      case "override_modifier":
        bump(C.overrideModifier, label)
        break
      // kept only to publish the correction as a number
      case "interface_heritage":
        bump(C.ungrammaticalProbeName_interface_heritage, label)
        break
      case "override":
        bump(C.overrideKeywordToken, label)
        break
      case "method_definition":
      case "method_signature":
      case "public_field_definition":
        bump(C.classMember, label)
        break
      case "call_expression":
        bump(C.callExpression, label)
        break
      default:
        break
    }
  })

  // Structural override probe, per file, using the same tree. In-file only: a
  // base declared in a sibling file is a cross-file question and is reported
  // by the census, not here.
  const classes: { name: string; bases: string[]; members: string[] }[] = []
  const interfaces: { name: string; bases: string[]; members: string[] }[] = []
  const byName = new Map<string, { members: string[] }>()
  const visit = (n: any) => {
    if (n.type === "class_declaration" || n.type === "abstract_class_declaration") {
      const nameNode = n.childForFieldName("name")
      const name = nameNode ? nameNode.text : ""
      const bases: string[] = []
      const heritage = childrenOfType(n, "class_heritage")[0]
      if (heritage) {
        for (const clause of childrenOfType(heritage, "extends_clause")) {
          const b = clause.childForFieldName("value")
          if (b) bases.push(b.text)
          for (const ch of [clause.namedChild(0), clause.namedChild(1)]) {
            if (ch && ch.type !== "extends_clause") {
              // `_identifier` / `member_expression` — take the leaf's own text
              const leaf = ch.type === "member_expression" ? ch.childForFieldName("property") : ch
              if (leaf) bases.push(leaf.text)
            }
          }
        }
      }
      const members: string[] = []
      const body = n.childForFieldName("body")
      if (body) {
        walkTypes(body, new Map(), (m: any) => {
          if (m.type === "method_definition") {
            const nm = m.childForFieldName("name")
            if (nm) members.push(nm.text)
          } else if (m.type === "public_field_definition") {
            const nm = m.childForFieldName("name")
            if (nm) members.push(nm.text)
          }
        })
      }
      classes.push({ name, bases, members })
    }
    if (n.type === "interface_declaration") {
      const nameNode = n.childForFieldName("name")
      const name = nameNode ? nameNode.text : ""
      // MEASUREMENT DEFECT (fixed 2026-10-05). The interface branch collected
      // members but NEVER collected the interface's `extends` bases, so the
      // structural override probe could not see `interface A extends B` even when
      // both were in the same file — it only ever compared classes against the
      // interface map, and `byName` held interfaces alone. A class base declared
      // in the same file was therefore invisible too: `byName` never held classes.
      // Both preconditions are now collected for both declaration kinds.
      const bases: string[] = []
      walkTypes(n, new Map(), (m: any) => {
        if (m.type !== "extends_type_clause") return
        for (let i = 0; i < m.namedChildCount; i++) {
          const ch = m.namedChild(i)
          if (!ch) continue
          const leaf = ch.type === "nested_type_identifier" ? ch.childForFieldName("name") ?? ch.namedChild(0) : ch
          if (leaf) bases.push(leaf.text)
        }
      })
      const members: string[] = []
      const body = n.childForFieldName("body")
      if (body) {
        walkTypes(body, new Map(), (m: any) => {
          if (m.type === "method_signature") {
            const nm = m.childForFieldName("name")
            if (nm) members.push(nm.text)
          } else if (m.type === "property_signature") {
            const nm = m.childForFieldName("name")
            if (nm) members.push(nm.text)
          }
        })
      }
      interfaces.push({ name, bases, members })
      byName.set(name, { members })
    }
  }
  walkTypes(root, new Map(), visit)
  // Classes go into `byName` AFTER the walk so a class declared later in the
  // file is still visible to an earlier declaration's base lookup. Order within a
  // file does not decide inheritance in TypeScript.
  for (const cl of classes) if (cl.name) byName.set(cl.name, { members: cl.members })

  for (const cl of classes) {
    for (const base of cl.bases) {
      if (base === cl.name) continue
      const b = byName.get(base)
      if (!b) continue
      bump(C.classWithInFileBase, label)
      let hits = 0
      for (const mem of cl.members) if (b.members.includes(mem)) hits++
      if (hits > 0) {
        bump(C.classMemberOverridingInFileBase, label)
        C.classMemberOverrideSites.n += hits
        C.classMemberOverrideSites.files.add(label)
      }
    }
  }
  for (const it of interfaces) {
    for (const base of it.bases) {
      if (base === it.name) continue
      const b = byName.get(base)
      if (!b) continue
      bump(C.interfaceWithInFileBase, label)
      let hits = 0
      for (const mem of it.members) if (b.members.includes(mem)) hits++
      if (hits > 0) {
        bump(C.interfaceMemberOverridingInFileBase, label)
        C.interfaceMemberOverrideSites.n += hits
        C.interfaceMemberOverrideSites.files.add(label)
      }
    }
  }
}

const out: any = {
  at: new Date().toISOString(),
  corpusRoot: CR,
  repoFilter: REPO_FILTER,
  populationDerivedFrom: "git ls-files in the corpus repo, filtered by the production language detector's extensions",
  filesAdmitted: admitted.length,
  filesParsed: parsed,
  filesFailed: failed,
  parseFailures: parseFailures.slice(0, 10),
  nodesWalked: totalNodes,
  constructs: {},
  grammarNodeTypesSeen: grammarTally.size,
}
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`ts construct probe — corpus ${CR}/${REPO_FILTER}`)
console.log(
  `population: ${admitted.length} tracked typescript/tsx files derived from git ls-files (max ${MAX_BYTES} bytes)`,
)
console.log(`parsed ${parsed}  failed ${failed}  nodes walked ${totalNodes.toLocaleString()}`)
console.log(`distinct grammar node types produced: ${grammarTally.size}\n`)
console.log(`${w("construct", 34)}${w("occurrences", 13)}${w("files", 8)}sample files`)
console.log("-".repeat(120))
for (const [k, c] of Object.entries(C)) {
  out.constructs[k] = { occurrences: c.n, files: c.files.size, samples: [...c.samples] }
  console.log(`${w(k, 34)}${w(c.n.toLocaleString(), 13)}${w(String(c.files.size), 8)}${c.samples.slice(0, 2).join("  ")}`)
}
out.grammarTypesTop = [...grammarTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)
if (OUT) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${OUT}`)
}