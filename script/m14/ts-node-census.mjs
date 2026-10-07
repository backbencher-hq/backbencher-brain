// ts-node-census.mjs — VERIFY_TS10 JOB 1 instrument A: GRAMMAR INVENTORY.
//
// Answers one question per relationship type, and it answers it by MEASURING THE
// LANGUAGE rather than by reading the analyzer: across a real corpus, which
// tree-sitter node types actually occur, and how many of them.
//
// The workstream's rule (ONTOLOGY-WORKSTREAM.md Part 2, "The two instruments")
// is that a text probe is the wrong instrument: the ontology gate's first version
// returned two false positives that way — `extends` matched the words `class
// voice` inside a telnet IAC word list in a string literal, and `instantiates`
// matched `new Map(` inside a heredoc. This instrument walks the AST through the
// cursor API and counts `node.type`, so a string literal cannot fake a construct
// and a comment cannot either.
//
// NO REGEX anywhere (hard rule 1). String `includes` / `endsWith` / Set
// membership only.
//
// Usage:
//   bun script/m14/ts-node-census.mjs [--repo element-plus] [--limit 0] [--max-bytes 400000]
//
// Reports, for the population it walked:
//   - every node type, with its count, so the denominator is printed with it
//   - the counts of the constructs each of the ten relationship types would need
//   - the same counts split by .d.ts / .tsx / plain .ts, because a corpus that is
//     mostly declaration files answers a different question than one that is not
//     (measured on the `typescript` corpus by REVIEW-2026-10-04.md §2 Defect A:
//     115/126 files are .d.ts there, so 0 calls and 0 imports is CORRECT, not a defect)

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

// Derived from this script's own location, so the analyzer under test is the one
// in THIS worktree. (The shared firing-check-v2.mjs hardcodes the main checkout's
// absolute path instead — reported to master as a harness defect.)
const REPO_ROOT = join(import.meta.dir, "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const argv = process.argv.slice(2)
const argOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPO = argOf("--repo") ?? "element-plus"
const LIMIT = Number(argOf("--limit") ?? "0")
const MAX_BYTES = Number(argOf("--max-bytes") ?? "400000")
const OUT = argOf("--out")

// ── population, DERIVED not hand-written ─────────────────────────────────────
// M14-HONESTY-CONTRACT.md "an instrument must declare the population it
// covered": a hand-written FILES array rots silently and keeps reporting a
// smaller N as though it were the whole.
const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"]

function endsWithAny(name, exts) {
  for (const e of exts) if (name.endsWith(e)) return true
  return false
}

function walk(dir, out, depth) {
  if (depth > 24 || out.length > 200_000) return
  let ents
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue
      walk(p, out, depth + 1)
    } else if (endsWithAny(e.name, TS_EXTS)) {
      out.push(p)
    }
  }
}

const root = join(CORPUS_ROOT, REPO)
const all = []
walk(root, all, 0)

let skippedTooBig = 0
let skippedUnreadable = 0
const files = []
for (const abs of all) {
  if (files.length >= LIMIT && LIMIT > 0) break
  try {
    if (statSync(abs).size > MAX_BYTES) {
      skippedTooBig++
      continue
    }
  } catch {
    skippedUnreadable++
    continue
  }
  files.push(abs)
}

const { getParser } = await import(`${REPO_ROOT}/src/ast/engine.ts`)

// ── the constructs each relationship type would need ────────────────────────
// Named here from the TypeScript grammar's own node types, not from the
// analyzer's source, so the probe cannot inherit an analyzer bug.
const CONSTRUCTS = [
  // declarations
  "class_declaration",
  "abstract_class_declaration",
  "class",
  "interface_declaration",
  "enum_declaration",
  "type_alias_declaration",
  "function_declaration",
  "generator_function_declaration",
  "method_definition",
  "abstract_method_signature",
  "method_signature",
  "property_signature",
  "public_field_definition",
  "module",
  "internal_module",
  // heritage — extends / implements
  "class_heritage",
  "extends_clause",
  "extends_type_clause",
  "implements_clause",
  // instantiation
  "new_expression",
  // calls / references / uses
  "call_expression",
  "new_expression_arguments",
  "type_annotation",
  "type_identifier",
  "nested_type_identifier",
  "generic_type",
  "type_reference",
  "type_query",
  // modules
  "import_statement",
  "import_clause",
  "export_statement",
  // other
  "decorator",
  "jsx_self_closing_element",
  "jsx_opening_element",
  "ERROR",
]

const nodeTotals = new Map()
const constructTotals = new Map()
const perFile = new Map() // rel path -> Map(nodeType -> count)
let parsed = 0
let failed = 0
let filesWithError = 0
let errorNodes = 0
const errorFiles = []

const parsers = { typescript: null, tsx: null }
const bucketOf = (rel) => {
  if (rel.endsWith(".d.ts")) return "d.ts"
  if (rel.endsWith(".tsx")) return "tsx"
  return "ts"
}
const bucketCounts = new Map() // bucket -> Map(construct -> count)
const bucketFiles = new Map()

for (const abs of files) {
  const rel = relative(root, abs)
  let content
  try {
    content = readFileSync(abs, "utf8")
  } catch {
    failed++
    continue
  }
  const lang = abs.endsWith(".tsx") ? "tsx" : "typescript"
  let root_ = null
  try {
    if (!parsers[lang]) parsers[lang] = await getParser(lang)
    const pr = await parsers[lang].parse(content, abs)
    root_ = pr.rootNode
  } catch {
    failed++
    continue
  }
  parsed++
  const local = new Map()
  const bucket = bucketOf(rel)
  if (!bucketCounts.has(bucket)) {
    bucketCounts.set(bucket, new Map())
    bucketFiles.set(bucket, new Set())
  }
  bucketFiles.get(bucket).add(rel)
  const bmap = bucketCounts.get(bucket)
  let fileErrors = 0

  // ONE walk, cursor-driven. node.type only — no text inspection anywhere.
  const cursor = root_.walk()
  let visited = 0
  let done = false
  while (!done) {
    const node = cursor.currentNode
    visited++
    if (visited > 4_000_000) break // poison guard, counted not hidden
    const t = node.type
    nodeTotals.set(t, (nodeTotals.get(t) ?? 0) + 1)
    local.set(t, (local.get(t) ?? 0) + 1)
    if (t === "ERROR" || node.isMissing) {
      fileErrors++
      errorNodes++
    }
    if (cursor.gotoFirstChild()) continue
    while (!cursor.gotoNextSibling()) {
      if (!cursor.gotoParent()) {
        done = true
        break
      }
    }
  }
  for (const c of CONSTRUCTS) {
    const n = local.get(c) ?? 0
    if (n) {
      constructTotals.set(c, (constructTotals.get(c) ?? 0) + n)
      bmap.set(c, (bmap.get(c) ?? 0) + n)
    }
  }
  perFile.set(rel, local)
  if (fileErrors) {
    filesWithError++
    if (errorFiles.length < 40) errorFiles.push(`${rel} (${fileErrors})`)
  }
}

const pct = (n, d) => (d === 0 ? "-" : `${((100 * n) / d).toFixed(1)}%`)
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n)

console.log(`ts-node-census — grammar inventory over ${REPO}`)
console.log(
  `POPULATION: ${files.length} .ts/.tsx/.mts/.cts files under ${root} ` +
    `(derived by readdir walk, extensions ${TS_EXTS.join("/")})`,
)
console.log(`  skipped ${skippedTooBig} over ${MAX_BYTES} bytes, ${skippedUnreadable} unreadable, ${all.length} seen in total`)
console.log(`  parsed ${parsed}, failed ${failed}; ${filesWithError} files carry ERROR/missing nodes (${errorNodes} nodes)`)
console.log(`  by bucket: ${[...bucketFiles.entries()].map(([b, s]) => `${b}=${s.size}`).join("  ")}`)
if (errorFiles.length) console.log(`  error files: ${errorFiles.join(", ")}`)

console.log(`\n--- constructs the ten relationship types would need (${files.length} files) ---`)
console.log(`${pad("node type", 32)}${pad("count", 10)}${pad("files", 8)}bucket breakdown`)
for (const c of CONSTRUCTS) {
  const total = constructTotals.get(c) ?? 0
  let nf = 0
  for (const [, local] of perFile) if ((local.get(c) ?? 0) > 0) nf++
  const bd = [...bucketCounts.entries()]
    .map(([b, m]) => `${b}:${m.get(c) ?? 0}`)
    .join(" ")
  console.log(`${pad(c, 32)}${pad(total.toLocaleString(), 10)}${pad(nf, 8)}${bd}`)
}

console.log(`\n--- every node type the grammar produced, ranked (denominator attached) ---`)
const ranked = [...nodeTotals.entries()].sort((a, b) => b[1] - a[1])
console.log(`distinct node types: ${ranked.length}; total node visits: ${ranked.reduce((a, [, n]) => a + n, 0).toLocaleString()}`)
for (let i = 0; i < ranked.length; i += 4) {
  console.log(
    ranked
      .slice(i, i + 4)
      .map(([t, n]) => pad(`${t}:${n}`, 34))
      .join(""),
  )
}

if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        repo: REPO,
        corpusRoot: CORPUS_ROOT,
        population: { files: files.length, skippedTooBig, skippedUnreadable, parsed, failed },
        buckets: Object.fromEntries([...bucketFiles.entries()].map(([b, s]) => [b, s.size])),
        filesWithError,
        errorNodes,
        constructs: Object.fromEntries(CONSTRUCTS.map((c) => [c, constructTotals.get(c) ?? 0])),
        nodeTypes: Object.fromEntries(nodeTotals),
      },
      null,
      2,
    ),
  )
  console.log(`\nwrote ${OUT}`)
}