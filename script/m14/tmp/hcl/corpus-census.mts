/**
 * HCL CORPUS CENSUS — every node type that actually occurs in real
 * .tf/.tfvars/.hcl/.tofu across the pinned repos, plus grammar-health counts and
 * per-construct frequencies.
 *
 * This is the F8 blind-spot detector for HCL: an unclassified node type is an
 * unmeasured hole. Also budgets grammar damage (ERROR/MISSING) rather than
 * assuming it away.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { execFileSync } from "node:child_process"
import { Parser, Language } from "web-tree-sitter"

const WASM = "<corpus-root>/backbencher-brain/wasm/tree-sitter-hcl.wasm"
const REPOS = "<corpus-root>/bb_tests/hcl/repos"
const OUT = "<corpus-root>/bb_tests/hcl/out"
const EXT = /\.(tf|tfvars|hcl|tofu)$/i

await Parser.init()
const lang = await Language.load(WASM)
const parser = new Parser()
parser.setLanguage(lang)

const observedTypes = new Map<string, number>()
const observedAnon = new Map<string, number>()
const blockTypes = new Map<string, number>()
const attrValueKinds = new Map<string, number>()
const labelNodeTypes = new Map<string, number>()
const fieldCounts = new Map<string, number>()
const errorSamples: { file: string; line: number; col: number; kind: string; text: string }[] = []

interface RepoStat {
  repo: string
  rev: string
  files: number
  bytes: number
  nodes: number
  errorFiles: number
  errorNodes: number
  missingNodes: number
}
const repos: RepoStat[] = []

function walk(node: any, file: string, s: RepoStat) {
  s.nodes++
  const t = node.type
  if (node.isNamed) observedTypes.set(t, (observedTypes.get(t) ?? 0) + 1)
  else observedAnon.set(t, (observedAnon.get(t) ?? 0) + 1)
  if (t === "ERROR") {
    s.errorNodes++
    s.errorFiles++
    if (errorSamples.length < 60)
      errorSamples.push({
        file,
        line: node.startPosition.row + 1,
        col: node.startPosition.column + 1,
        kind: "ERROR",
        text: node.text.slice(0, 120).replace(/\n/g, "\\n"),
      })
  }
  if (node.isMissing) {
    s.missingNodes++
    if (errorSamples.length < 60)
      errorSamples.push({ file, line: node.startPosition.row + 1, col: node.startPosition.column + 1, kind: "MISSING", text: t })
  }
  if (t === "block") {
    let first = true
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (first && c.type === "identifier") {
        blockTypes.set(c.text, (blockTypes.get(c.text) ?? 0) + 1)
        first = false
      } else {
        labelNodeTypes.set(c.type, (labelNodeTypes.get(c.type) ?? 0) + 1)
      }
    }
  }
  if (t === "attribute") {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c?.type !== "expression") continue
      const v = c.namedChild(0)
      const k = v ? v.type : "(empty-expression)"
      attrValueKinds.set(k, (attrValueKinds.get(k) ?? 0) + 1)
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const f = node.fieldNameForChild ? node.fieldNameForChild(i) : null
    if (f) fieldCounts.set(f, (fieldCounts.get(f) ?? 0) + 1)
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walk(c, file, s)
  }
}

function* walkFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (e === ".git" || e === "node_modules") continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walkFiles(p)
    else if (EXT.test(e)) yield p
  }
}

const repoDirs = readdirSync(REPOS)
  .filter((d) => {
    try {
      return statSync(join(REPOS, d)).isDirectory()
    } catch {
      return false
    }
  })
  .sort()

let totalFiles = 0
for (const d of repoDirs) {
  let rev = "unknown"
  try {
    rev = execFileSync("git", ["-C", join(REPOS, d), "rev-parse", "HEAD"], { encoding: "utf8" }).trim().slice(0, 12)
  } catch {}
  const s: RepoStat = { repo: d, rev, files: 0, bytes: 0, nodes: 0, errorFiles: 0, errorNodes: 0, missingNodes: 0 }
  for (const f of walkFiles(join(REPOS, d))) {
    const src = readFileSync(f, "utf8")
    if (src.length > 4_000_000) continue
    s.files++
    s.bytes += src.length
    const tree = parser.parse(src)
    walk(tree.rootNode, relative(REPOS, f), s)
    tree.delete()
  }
  repos.push(s)
  totalFiles += s.files
  process.stderr.write(
    `  ${d}@${rev.slice(0, 7)}: ${s.files} files, ${s.nodes} nodes, ${s.errorFiles} err-files, ${s.missingNodes} missing\n`,
  )
}

const byCount = (m: Map<string, number>) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]))
const out = {
  generatedAt: new Date().toISOString(),
  wasm: WASM,
  totalFiles,
  totalNodes: repos.reduce((a, r) => a + r.nodes, 0),
  totalErrorFiles: repos.reduce((a, r) => a + r.errorFiles, 0),
  totalMissing: repos.reduce((a, r) => a + r.missingNodes, 0),
  repos,
  observedNamedNodeTypes: byCount(observedTypes),
  observedAnonymousNodeTypes: byCount(observedAnon),
  observedFieldNames: byCount(fieldCounts),
  distinctBlockTypes: blockTypes.size,
  blockTypesByFrequency: byCount(blockTypes),
  attributeValueKinds: byCount(attrValueKinds),
  blockChildNodeTypes: byCount(labelNodeTypes),
  errorSamples,
}
writeFileSync(`${OUT}/corpus-census.json`, JSON.stringify(out, null, 2) + "\n")

console.log(`files=${totalFiles} nodes=${out.totalNodes} errFiles=${out.totalErrorFiles} missing=${out.totalMissing}`)
console.log(`distinct named node types observed: ${observedTypes.size}`)
console.log(`distinct block types: ${blockTypes.size}`)
console.log(`observed field names: ${JSON.stringify(byCount(fieldCounts))}`)
console.log(`\nattribute value kinds:`)
for (const [k, v] of [...attrValueKinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(8)}  ${k}`)
console.log(`\nblock child node types:`)
for (const [k, v] of [...labelNodeTypes.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(8)}  ${k}`)
console.log(`\nnamed node types NOT observed in corpus (grammar-only):`)
const observedSet = new Set(observedTypes.keys())
for (let i = 0; i < lang.nodeTypeCount; i++) {
  if (!lang.nodeTypeIsNamed(i)) continue
  const t = lang.nodeTypeForId(i)
  if (!observedSet.has(t)) console.log(`   ${t}`)
}
