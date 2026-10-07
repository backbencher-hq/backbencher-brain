/**
 * KOTLIN_GAP — construct probe (the falsifiability instrument).
 *
 * A ruling with no measurement is a defect, so every RULED verdict needs a
 * count that could come back non-zero. This is that count. Two instruments,
 * chosen by the QUESTION (the same split ontology-coverage-gate.ts uses):
 *
 *   A: GRAMMAR INVENTORY — for a type that would need a node type the language
 *      does not have. Enumerating every node type the grammar actually produces
 *      across the corpus is POSITIVE evidence OF ABSENCE.
 *   B: PARSE-TREE SEMANTIC COUNT — for a construct the language CAN express,
 *      counted on the tree where a comment or a string literal cannot fake it.
 *
 * Probed constructs, and why each one is the right probe for its type:
 *   imports      B  `import_header` — kotlin's import statement
 *   exports      A  any node type expressing an export declaration
 *   exports      B  a TOP-LEVEL declaration that is public (kotlin has no export
 *                    keyword: visibility IS the export mechanism)
 *   implements   B  `delegation_specifier` carrying a bare `user_type` and no
 *                    `constructor_invocation` (kotlin's interface supertype)
 *   overrides    B  a `modifiers` node carrying the `override` keyword
 *   instantiates B  a `call_expression` whose callee leaf begins upper case
 *                    (kotlin's construction syntax)
 *   extends      B  `delegation_specifier` carrying a `constructor_invocation`
 *   calls        B  a `call_expression` with a name-bearing callee
 *   contains     B  a declaration with a named enclosing declaration
 *   references   B  a type reference in a declaration position
 *   uses         B  a navigation/qualified access on a receiver
 *
 * NO REGEX. Node types are compared by string equality against a Set; a
 * modifier is a NAMED CHILD node whose `type` is the keyword; "upper case" is a
 * char-code range test on one character.
 *
 * Usage: bun run script/m14/kotlin-gap/construct-probe.ts [fileCount] [--repo DIR]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const repoIdx = argv.indexOf("--repo")
const REPO_DIR = repoIdx >= 0 ? argv[repoIdx + 1] : "kotlin"
const outIdx = argv.indexOf("--out")
const outPath = outIdx >= 0 ? argv[outIdx + 1] : undefined
const want = Number(argv.find((a) => !a.startsWith("--")) ?? "400")

const tracked: string[] = execFileSync("git", ["-C", path.join(CR, REPO_DIR), "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)
const KT = [".kt", ".kts"]
const candidates = tracked.filter((rel) => KT.some((e) => path.extname(rel).toLowerCase() === e)).sort()
const stride = Math.max(1, Math.floor(candidates.length / want))
const files: string[] = []
for (let i = 0; i < candidates.length && files.length < want; i += stride) files.push(candidates[i])

// Instrument A: node types that would EXPRESS an export declaration. A grammar
// that cannot name one has no such construct, and enumerating what it DOES name
// is how absence becomes a fact rather than an assertion.
const EXPORT_NODE_TYPES = new Set([
  "export_statement",
  "export_declaration",
  "export_list",
  "export_specifier",
  "module_export",
  "public_declaration",
])
// kotlin DOES express the export decision through visibility, and the grammar
// names it: `visibility_modifier` is a child of `modifiers` whose text is
// `public`/`internal`/`private`/`protected`. It is deliberately NOT in the set
// above — a visibility modifier is not an export STATEMENT — and is reported
// separately as the mechanism Kotlin actually has.
const VISIBILITY_NODE_TYPES = new Set(["modifiers", "visibility_modifier"])
const MEMBER_MODIFIER = "member_modifier"

const parser = await getParser("kotlin")

const nodeTypes = new Map<string, number>()
const hits: Record<string, { n: number; files: number; examples: string[] }> = {
  "imports:B:import_header": { n: 0, files: 0, examples: [] },
  "exports:A:export_node_type": { n: 0, files: 0, examples: [] },
  "exports:B:public_top_level_declaration": { n: 0, files: 0, examples: [] },
  "implements:B:bare_delegation_specifier": { n: 0, files: 0, examples: [] },
  "overrides:B:override_modifier": { n: 0, files: 0, examples: [] },
  "instantiates:B:pascal_case_call": { n: 0, files: 0, examples: [] },
  "extends:B:ctor_delegation_specifier": { n: 0, files: 0, examples: [] },
  "calls:B:call_expression_named": { n: 0, files: 0, examples: [] },
  "uses:B:navigation_expression": { n: 0, files: 0, examples: [] },
}
const hitFiles: Record<string, Set<string>> = {}
for (const k of Object.keys(hits)) hitFiles[k] = new Set()

const DECL_TYPES = new Set(["class_declaration", "object_declaration", "function_declaration", "property_declaration"])
const NON_PUBLIC = new Set(["private", "internal", "protected", "local"])

const isUpper = (ch: string) => ch >= "A" && ch <= "Z"

let parsed = 0
let rootLevelDecls = 0
const modifierInventory: Record<string, number> = {}
for (const rel of files) {
  const p = path.join(CR, REPO_DIR, rel)
  let content: string
  try { content = readFileSync(p, "utf8") } catch { continue }
  let tree: any
  try { tree = await parser.parse(content, p) } catch { continue }
  if (!tree) continue
  parsed++

  const bump = (key: string, label: string) => {
    const h = hits[key]
    h.n++
    hitFiles[key].add(rel)
    if (h.examples.length < 3) h.examples.push(`${rel}:${label}`)
  }

  // stack walk; `declDepth` counts enclosing DECLARATION nodes so a top-level
  // declaration is one with no declaration ancestor
  const stack: { n: any; declDepth: number }[] = [{ n: tree.rootNode, declDepth: 0 }]
  while (stack.length > 0) {
    const { n, declDepth } = stack.pop()!
    const t = n.type
    nodeTypes.set(t, (nodeTypes.get(t) ?? 0) + 1)

    if (EXPORT_NODE_TYPES.has(t)) bump("exports:A:export_node_type", `${rel}: ${t}`)
    if (t === "import_header") bump("imports:B:import_header", `${rel}: ${n.text.slice(0, 60)}`)

    if (t === "delegation_specifier") {
      let ctor = false
      let bare = false
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "constructor_invocation") ctor = true
        if (c.type === "user_type" || c.type === "nullable_type") bare = true
      }
      if (ctor) bump("extends:B:ctor_delegation_specifier", `${rel}: ${n.text.slice(0, 50)}`)
      else if (bare) bump("implements:B:bare_delegation_specifier", `${rel}: ${n.text.slice(0, 50)}`)
    }

    if (t === "modifiers") {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c) continue
        // `override` is a member_modifier child of `modifiers`; its TEXT is the
        // keyword. Reading the node type alone finds nothing (the type is always
        // member_modifier), which is how the first version of this probe
        // measured 0 occurrences on a corpus where the analyzer emits 162
        // override edges — a probe that reports 0 on a construct the analyzer
        // reads 300 times is a broken probe, not a language fact.
        if (c.type === MEMBER_MODIFIER || c.type === "visibility_modifier") {
          modifierInventory[c.text] = (modifierInventory[c.text] ?? 0) + 1
          if (c.text === "override") bump("overrides:B:override_modifier", `${rel}: override`)
        }
      }
    }

    if (t === "call_expression") {
      // callee leaf: the first simple_identifier/type_identifier reachable as a
      // DIRECT child, or through a navigation_expression's own identifier chain
      let leafName = ""
      for (let i = 0; i < n.namedChildCount && !leafName; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "simple_identifier" || c.type === "type_identifier" || c.type === "identifier") leafName = c.text
        else if (c.type === "navigation_expression") {
          for (let j = c.namedChildCount - 1; j >= 0; j--) {
            const g = c.namedChild(j)
            if (g && (g.type === "simple_identifier" || g.type === "type_identifier")) { leafName = g.text; break }
          }
        }
      }
      if (leafName) {
        bump("calls:B:call_expression_named", `${rel}: ${leafName}`)
        if (isUpper(leafName[0])) bump("instantiates:B:pascal_case_call", `${rel}: ${leafName}`)
      }
    }

    if (t === "navigation_expression") bump("uses:B:navigation_expression", `${rel}: ${n.text.slice(0, 40)}`)

    if (DECL_TYPES.has(t)) {
      if (declDepth === 0) {
        rootLevelDecls++
        let publicish = true
        for (let i = 0; i < n.childCount && publicish; i++) {
          const c = n.child(i)
          if (c && NON_PUBLIC.has(c.type)) publicish = false
        }
        if (publicish) bump("exports:B:public_top_level_declaration", `${rel}: ${t}`)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push({ n: c, declDepth: declDepth + 1 })
      }
      continue
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, declDepth })
    }
  }
  tree.delete?.()
}

const visibilitySeen = [...VISIBILITY_NODE_TYPES].filter((n) => nodeTypes.has(n))
console.log(`kotlin construct probe — corpus ${REPO_DIR}, ${parsed} files parsed, ${files.length} admitted`)
console.log(`\nINSTRUMENT A — GRAMMAR INVENTORY`)
console.log(`  distinct node types the grammar produced across the corpus: ${nodeTypes.size}`)
console.log(`  node types that would EXPRESS an export declaration and did NOT appear: ${[...EXPORT_NODE_TYPES].join(" ")}`)
const present = [...EXPORT_NODE_TYPES].filter((n) => nodeTypes.has(n))
console.log(`  …of those, present on the tree: ${present.length ? present.join(" ") : "NONE"}`)
console.log(`  visibility-bearing node types present (kotlin's actual export mechanism): ${visibilitySeen.join(" ") || "NONE"}`)
console.log(`\nINSTRUMENT B — PARSE-TREE SEMANTIC COUNTS`)
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`  ${w("construct", 42)}${w("occurrences", 13)}${w("files", 8)}example`)
console.log("  " + "-".repeat(110))
for (const [k, h] of Object.entries(hits)) {
  console.log(`  ${w(k, 42)}${w(h.n.toLocaleString(), 13)}${w(String(hitFiles[k].size), 8)}${h.examples[0] ?? ""}`)
}
console.log("  " + "-".repeat(110))
console.log(`  top-level declarations seen: ${rootLevelDecls}`)
console.log(`\n  modifier keyword inventory (node text, counted off the tree):`)
const modKeys = Object.keys(modifierInventory).sort()
console.log(`  ${modKeys.map((k) => `${k}=${modifierInventory[k]}`).join("  ")}`)

if (outPath) {
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        corpus: { root: CR, repo: REPO_DIR, filesParsed: parsed, filesAdmitted: files.length },
        instrumentA: {
          distinctNodeTypes: nodeTypes.size,
          exportNodeTypesProbed: [...EXPORT_NODE_TYPES],
          exportNodeTypesPresent: present,
          visibilityNodeTypesPresent: visibilitySeen,
        },
        instrumentB: Object.fromEntries(
          Object.entries(hits).map(([k, v]) => [k, { occurrences: v.n, files: hitFiles[k].size, examples: v.examples }]),
        ),
        topLevelDeclarations: rootLevelDecls,
        modifierInventory,
      },
      null,
      1,
    ),
  )
  console.log(`\nwrote ${outPath}`)
}
