// ts-construct-sites.mjs — VERIFY_TS10 JOB 1 instrument B: PARSE-TREE SEMANTIC
// COUNT, at the SITE level.
//
// ts-node-census.mjs answers "does the corpus contain this node type". This
// answers "where, on what, and would the analyzer's rule have fired there" —
// which is the only way to separate "the language cannot express it" (RULED)
// from "the analyzer does not read it" (GAP) for a type whose corpus count is
// small but non-zero.
//
// Everything is read off the tree-sitter AST by node type and named child. NO
// REGEX (hard rule 1) and no source-text matching: a `new Map(` inside a string
// literal cannot appear here, which is exactly the failure the workstream
// records for the ontology gate's first text probe.
//
// Usage:
//   bun script/m14/ts-construct-sites.mjs --repo element-plus \
//        [--sites implements_clause,extends_clause,class_heritage] [--new-census]
//        [--max-bytes 400000] [--out path.json]

import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

const REPO_ROOT = join(import.meta.dir, "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const argv = process.argv.slice(2)
const argOf = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPO = argOf("--repo") ?? "element-plus"
const MAX_BYTES = Number(argOf("--max-bytes") ?? "400000")
const OUT = argOf("--out")
const NEW_CENSUS = argv.includes("--new-census")
const SITE_TYPES = new Set(
  (argOf("--sites") ?? "implements_clause,extends_clause,class_heritage,extends_type_clause")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)

const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"]
const endsWithAny = (name, exts) => {
  for (const e of exts) if (name.endsWith(e)) return true
  return false
}

const all = []
;(function walk(dir, depth) {
  if (depth > 24) return
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
      walk(p, depth + 1)
    } else if (endsWithAny(e.name, TS_EXTS)) all.push(p)
  }
})(join(CORPUS_ROOT, REPO), 0)

const { getParser } = await import(`${REPO_ROOT}/src/ast/engine.ts`)
const root = join(CORPUS_ROOT, REPO)

const sites = []
const newSites = []
let parsed = 0
let failed = 0
let admitted = 0
let skippedBig = 0

const parsers = { typescript: null, tsx: null }

/** Every named descendant whose type is in `wanted`, with its ancestor chain. */
function collectSites(node, wanted, chain, hits) {
  const cursor = node.walk()
  let done = false
  while (!done) {
    const cur = cursor.currentNode
    if (wanted.has(cur.type)) {
      const anc = []
      let p = cur.parent
      while (p && anc.length < 12) {
        anc.push(p.type)
        p = p.parent
      }
      hits.push({ node: cur, chain: anc })
    }
    if (cursor.gotoFirstChild()) continue
    while (!cursor.gotoNextSibling()) {
      if (!cursor.gotoParent()) {
        done = true
        break
      }
    }
  }
}

/** First descendant of `type` on a path that does not cross `stopAt`. */
function firstDescendant(node, type, stopAt) {
  const stack = [node]
  while (stack.length) {
    const n = stack.pop()
    if (n === node && n.type !== type) {
      for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
      continue
    }
    if (n.type === type) return n
    if (stopAt && n !== node && stopAt.has(n.type)) continue
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
  return null
}

/** Type names appearing inside a heritage clause, read structurally. */
function heritageTargets(clause) {
  const names = []
  const cursor = clause.walk()
  let done = false
  while (!done) {
    const n = cursor.currentNode
    if (n.type === "identifier" || n.type === "type_identifier") {
      // the direct child of extends/implements, or nested inside them
      let p = n.parent
      let depth = 0
      let inside = false
      while (p && p !== clause.parent && depth < 6) {
        if (
          p.type === "extends_clause" ||
          p.type === "implements_clause" ||
          p.type === "extends_type_clause" ||
          p.type === "extends_clause" ||
          p.type === "class_heritage"
        ) {
          inside = true
          break
        }
        p = p.parent
        depth++
      }
      if (inside) names.push(n.text)
    }
    if (cursor.gotoFirstChild()) continue
    while (!cursor.gotoNextSibling()) {
      if (!cursor.gotoParent()) {
        done = true
        break
      }
    }
  }
  return names
}

const CONTAINER = new Set(["class_declaration", "interface_declaration", "enum_declaration", "abstract_class_declaration"])

for (const abs of all) {
  const rel = relative(root, abs)
  let content
  try {
    if (readFileSync(abs).length > MAX_BYTES) {
      skippedBig++
      continue
    }
  } catch {
    continue
  }
  try {
    content = readFileSync(abs, "utf8")
  } catch {
    failed++
    continue
  }
  const lang = abs.endsWith(".tsx") ? "tsx" : "typescript"
  let tree = null
  try {
    if (!parsers[lang]) parsers[lang] = await getParser(lang)
    tree = await parsers[lang].parse(content, abs)
  } catch {
    failed++
    continue
  }
  admitted++
  parsed++

  // container -> member names, for the in-file override resolvability question
  const containers = new Map()
  const hits = []
  collectSites(tree.rootNode, SITE_TYPES, [], hits)
  for (const h of hits) {
    let owner = h.node.parent
    let ownerName = "(top level)"
    while (owner && !CONTAINER.has(owner.type)) owner = owner.parent
    if (owner) ownerName = owner.childForFieldName("name")?.text ?? "(anonymous)"
    const targets = heritageTargets(h.node)
    sites.push({
      file: rel,
      line: h.node.startPosition.row + 1,
      siteType: h.node.type,
      container: ownerName,
      containerKind: owner ? owner.type : "(none)",
      targets,
      chain: h.chain.slice(0, 5),
    })
  }

  if (NEW_CENSUS) {
    const nh = []
    collectSites(tree.rootNode, new Set(["new_expression"]), [], nh)
    for (const h of nh) {
      const callee = h.node.childForFieldName("constructor")
      newSites.push({
        file: rel,
        line: h.node.startPosition.row + 1,
        constructor: callee ? callee.text : "(none)",
        calleeType: callee ? callee.type : "(none)",
      })
    }
  }

  // declarations by name, per file, for override resolvability
  {
    const cursor = tree.rootNode.walk()
    let done = false
    while (!done) {
      const n = cursor.currentNode
      if (CONTAINER.has(n.type)) {
        const nm = n.childForFieldName("name")?.text ?? ""
        const members = []
        const body = n.childForFieldName("body")
        if (body) {
          const mc = body.walk()
          let mdone = false
          while (!mdone) {
            const m = mc.currentNode
            if (m.type === "method_definition" || m.type === "method_signature" || m.type === "property_signature" || m.type === "public_field_definition") {
              const mn = m.childForFieldName("name")?.text
              if (mn) members.push(mn)
            }
            if (mc.gotoFirstChild()) continue
            while (!mc.gotoNextSibling()) {
              if (!mc.gotoParent()) {
                mdone = true
                break
              }
            }
          }
        }
        const list = containers.get(nm) ?? []
        list.push({ kind: n.type, line: n.startPosition.row + 1, members })
        containers.set(nm, list)
      }
      if (cursor.gotoFirstChild()) continue
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) {
          done = true
          break
        }
      }
    }
  }

  // THE override question, measured rather than assumed: does any base name in
  // this file resolve to a DECLARATION IN THE SAME FILE, and do the two member
  // sets intersect? If the answer is zero across the corpus, `overrides` has no
  // in-file construct here and the analyzer's in-file scope is the reason.
  for (const s of sites.filter((x) => x.file === rel)) {
    const decls = containers.get(s.container)
    if (!decls) continue
    for (const t of s.targets) {
      const base = containers.get(t)
      if (!base) continue
      for (const d of decls) {
        for (const b of base) {
          const shared = d.members.filter((m) => b.members.includes(m))
          s.inFileBaseResolved = true
          s.inFileMembers = shared.length
          s.inFileSharedNames = shared.slice(0, 8)
        }
      }
    }
  }
}

const bySite = new Map()
for (const s of sites) {
  const k = s.siteType
  const list = bySite.get(k) ?? []
  list.push(s)
  bySite.set(k, list)
}

console.log(`ts-construct-sites — ${REPO}`)
console.log(`POPULATION: ${admitted} files parsed (of ${all.length} .ts/.tsx seen; ${skippedBig} over ${MAX_BYTES} bytes), ${failed} failed`)

for (const [k, list] of bySite) {
  console.log(`\n=== ${k}: ${list.length} site(s) in ${new Set(list.map((x) => x.file)).size} file(s) ===`)
  for (const s of list.slice(0, 60)) {
    const extra = s.inFileBaseResolved ? `  IN-FILE BASE ${s.container}->${s.targets.join(",")} shared members=${s.inFileMembers} ${JSON.stringify(s.inFileSharedNames)}` : ""
    console.log(`  ${s.file}:${s.line}  ${s.containerKind} ${s.container}  targets=[${s.targets.join(", ")}]${extra}`)
  }
  if (list.length > 60) console.log(`  ... ${list.length - 60} more`)
  const resolved = list.filter((x) => x.inFileBaseResolved)
  console.log(`  MEASUREMENT: bases that resolve to a declaration in the SAME file: ${resolved.length} / ${list.length}`)
  const withMembers = resolved.filter((x) => x.inFileMembers > 0)
  console.log(`  MEASUREMENT: of those, pairs sharing >=1 member name: ${withMembers.length}`)
}

if (NEW_CENSUS) {
  console.log(`\n=== new_expression sites: ${newSites.length} in ${new Set(newSites.map((x) => x.file)).size} files ===`)
  const byCtor = new Map()
  for (const s of newSites) {
    const k = s.constructor
    const l = byCtor.get(k) ?? []
    l.push(s)
    byCtor.set(k, l)
  }
  const ranked = [...byCtor.entries()].sort((a, b) => b[1].length - a[1].length)
  console.log(`  distinct constructor expressions: ${ranked.length}`)
  for (const [k, v] of ranked.slice(0, 40)) {
    console.log(`  ${String(v.length).padStart(5)}  ${k}   e.g. ${v[0].file}:${v[0].line}`)
  }
  if (ranked.length > 40) console.log(`  ... ${ranked.length - 40} more distinct constructor expressions`)
}

if (OUT) writeFileSync(OUT, JSON.stringify({ repo: REPO, population: { all: all.length, admitted, failed, skippedBig }, sites, newSites }, null, 2))
if (OUT) console.log(`\nwrote ${OUT}`)