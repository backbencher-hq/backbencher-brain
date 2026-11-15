// CANDIDATE-SET EQUIVALENCE — does the TEXT filter find the same siblings a PARSE would?
//
// THE QUESTION, and it is the Lead's, asked because `resolveSameDirectoryResource` reads a sibling as
// TEXT rather than parsing it (`analyze()` is synchronous; the only parser accessor is async and
// lives in a shared file). The departure is only safe if it is INVISIBLE, and "invisible" has a
// measurable meaning:
//
//   * same candidate SET      -> the text read costs nothing; a parse would buy nothing
//   * text MISSES a candidate -> an edge a parse would resolve stays UNRESOLVED. That is the safe
//                                direction (a miss, not a mis-binding), and it shows up as unresolved
//                                edges in the same-directory class — count them
//   * text finds EXTRA        -> the unsafe direction, and the one that would need a parse: a
//                                candidate no parse would produce can bind an edge to the wrong
//                                document. Count these too; that is why this probe is not
//                                one-directional.
//
// It runs the production path for the EDGE side (`pool-worker.parseFile` with a project root, the
// analyzer's own emitted edges) and the engine's parser for the ORACLE side (a tree walk for the two
// spellings). The text side calls the analyzer's OWN filter (`RealYamlAnalyzer.declaresResource`)
// rather than a copy, so the thing under test is the thing that runs.
//
// COST, and why it is shaped this way: each sibling is parsed ONCE and its tree freed immediately.
// Two earlier versions died of their own memory — the first held one parser handle across the
// engine's parser recycling (`memory access out of bounds`), the second parsed every sibling for
// every edge and kept every tree (`Aborted()` inside `ts_parser_parse_wasm`). A probe that dies of
// its own memory tells you nothing about the question it was written for.
//
//   npx tsx validation/m14/fixtures/yaml/same-directory-candidate-set-probe.ts
const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { RealYamlAnalyzer } = await import(`${REPO}/src/ast/real-yaml-analyzer.ts`)
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = [".yaml", ".yml"]
const KIND = (RealYamlAnalyzer as any).KIND_FOR_RESOURCE_KEY as Record<string, string>

/** THE PARSE ORACLE — the same two lookups the text filter makes, but on the TREE: a top-level
 *  `kind` pair and a `name` pair inside a top-level `metadata` pair, against the grammar's own shapes
 *  (stream > document > block_node > block_mapping > block_mapping_pair). */
const scalarText = (n: any): string => {
  let cur = n
  for (let i = 0; i < 8 && cur; i++) {
    if (String(cur.type).endsWith("scalar")) break
    const next = cur.namedChildCount > 0 ? cur.namedChild(cur.namedChildCount - 1) : null
    if (!next) break
    cur = next
  }
  return String(cur?.text ?? "").replace(/^["']|["']$/g, "")
}
const firstMapping = (n: any): any => {
  if (!n) return null
  if (n.type === "block_mapping" || n.type === "flow_mapping") return n
  for (let i = 0; i < n.namedChildCount; i++) {
    const hit = firstMapping(n.namedChild(i))
    if (hit) return hit
  }
  return null
}
const declarationOf = async (content: string, path: string): Promise<{ kind: string; name: string } | null> => {
  // THE PARSER IS FETCHED PER CALL: the engine recycles its parser every 500 parses, so a handle
  // captured once goes stale and the next parse traps.
  const p = await getParser("yaml")
  let tree: any
  try {
    tree = p.parse(content, path)
    const mapping = firstMapping(tree.rootNode)
    if (!mapping) return null
    let kind: string | null = null
    let name: string | null = null
    for (let i = 0; i < mapping.namedChildCount; i++) {
      const pair = mapping.namedChild(i)
      const key = scalarText(pair.childForFieldName?.("key") ?? pair)
      const value = pair.childForFieldName?.("value") ?? null
      if (!value) continue
      if (key === "kind") kind = scalarText(value)
      if (key === "metadata") {
        const inner = firstMapping(value)
        if (!inner) continue
        for (let j = 0; j < inner.namedChildCount; j++) {
          const p2 = inner.namedChild(j)
          if (scalarText(p2.childForFieldName?.("key") ?? p2) !== "name") continue
          const v2 = p2.childForFieldName?.("value") ?? null
          if (v2) name = scalarText(v2)
        }
      }
    }
    return kind !== null && name !== null ? { kind, name } : null
  } catch {
    return null
  } finally {
    // FREE THE TREE. The WASM heap is shared with every parse this process makes.
    try { tree?.delete?.() } catch { /* older builds have no delete */ }
  }
}

// ── the population, the gate's own discovery rule ────────────────────────────────────────
const perRepo = new Map<string, { root: string; files: string[] }>()
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith(e))) continue
    const abs = join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  if (files.length) perRepo.set(name, { root: dir, files })
}

// ── PHASE 1: the edges, through the production path ──────────────────────────────────────
type Edge = { root: string; dir: string; abs: string; key: string; kind: string; target: string; resolved: boolean }
const edges: Edge[] = []
const siblingsNeeded = new Set<string>()
let parsedFiles = 0
for (const [repo, { root, files }] of perRepo) {
  for (const abs of files) {
    let r: any
    try { r = await parseFile(abs, root, { projectRoot: root }) } catch { continue }
    if (!r) continue
    parsedFiles++
    for (const e of r.relationships ?? []) {
      if (e.metadata?.relationshipType !== "yaml_resource_ref") continue
      const source = String(e.source ?? "")
      const key = source.slice(source.lastIndexOf(".") + 1)
      const kind = KIND[key]
      if (kind === undefined) continue
      const dir = abs.slice(0, abs.lastIndexOf("/"))
      edges.push({ root, dir, abs, key, kind, target: String(e.target ?? ""), resolved: e.metadata?.resolved === true })
      try {
        for (const entry of readdirSync(dir)) {
          if (!EXTS.some((x) => entry.toLowerCase().endsWith(x))) continue
          const sib = `${dir}/${entry}`
          if (sib !== abs) siblingsNeeded.add(sib)
        }
      } catch { /* an unreadable directory is a miss, not a crash */ }
    }
  }
  process.stderr.write(`  ${repo}: ${files.length} files\n`)
}

// ── PHASE 2: ONE parse per sibling, each tree freed ──────────────────────────────────────
const declarations = new Map<string, { dir: string; text: string; parsed: { kind: string; name: string } | null }>()
for (const sib of siblingsNeeded) {
  let text = ""
  try { text = readFileSync(sib, "utf8") } catch { continue }
  const parsed = await declarationOf(text, sib)
  declarations.set(sib, { dir: sib.slice(0, sib.lastIndexOf("/")), text, parsed })
}
process.stderr.write(`  phase 2: ${declarations.size} sibling(s) parsed once each\n`)

// ── PHASE 3: compare the candidate SETS ─────────────────────────────────────────────────
let equal = 0, textMisses = 0, textExtra = 0, unresolvedWithParseCandidate = 0
const missRows: string[] = [], extraRows: string[] = []
for (const e of edges) {
  const text: string[] = []
  const parse: string[] = []
  for (const [sib, d] of declarations) {
    if (d.dir !== e.dir || sib === e.abs) continue
    const entry = sib.slice(sib.lastIndexOf("/") + 1)
    if ((RealYamlAnalyzer as any).declaresResource(d.text, e.kind, e.target)) text.push(entry)
    if (d.parsed !== null && d.parsed.kind === e.kind && d.parsed.name === e.target) parse.push(entry)
  }
  text.sort(); parse.sort()
  const sameSet = text.length === parse.length && text.every((x, i) => x === parse[i])
  if (sameSet) equal++
  else {
    const parseMore = parse.some((p) => !text.includes(p))
    const textMore = text.some((t) => !parse.includes(t))
    const where = `${e.abs.slice(e.root.length + 1)} key=${e.key} target=${JSON.stringify(e.target)} text=${JSON.stringify(text)} parse=${JSON.stringify(parse)}`
    if (parseMore) { textMisses++; missRows.push(`  ${where}`) }
    if (textMore) { textExtra++; extraRows.push(`  ${where}`) }
  }
  if (!e.resolved && parse.length > 0) unresolvedWithParseCandidate++
}

console.log(`\nparsed ${parsedFiles} files across ${perRepo.size} repos`)
console.log(`kind-mapped resource-reference edges: ${edges.length}`)
console.log(`  candidate SET identical (text == parse): ${equal}`)
console.log(`  TEXT MISSES a parse candidate          : ${textMisses}   ${textMisses === 0 ? "<- the safe direction, and it is EMPTY" : "<- a parse would resolve more"}`)
console.log(`  TEXT FINDS an extra candidate          : ${textExtra}   ${textExtra === 0 ? "<- the unsafe direction, and it is EMPTY" : "<- text can mis-bind"}`)
for (const r of missRows.slice(0, 10)) console.log(r)
for (const r of extraRows.slice(0, 10)) console.log(r)
console.log(`\nunresolved same-directory-class edges for which a PARSE finds a candidate: ${unresolvedWithParseCandidate}`)
console.log(textMisses === 0 && textExtra === 0
  ? "VERDICT: the text read is INVISIBLE on this population — a parse would find the SAME candidate set, so a synchronous parser accessor would buy nothing."
  : "VERDICT: the text read DIFFERS from a parse on this population — see the rows above.")
