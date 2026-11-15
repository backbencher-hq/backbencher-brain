/**
 * HASKELL LANE — probe v3: IS THE TOP CAUSE DOABLE?
 *
 * v2 measured the sample's own key space, in which a project module is visible only if one
 * of its files happened to be sampled. That understates the answer: a rebased target
 * `Distribution.Simple.PackageIndex.insert` can only resolve if THAT module's file is in
 * the key space, and the stride sample holds 400 of 3,695 files.
 *
 * So v3 builds the PROJECT-WIDE module map first (`module M` header of every tracked .hs
 * file — a cheap regex, no parsing), then parses ONLY the module files a qualified edge
 * actually names, and asks the two doability questions over the whole project:
 *
 *   D1  how many of the qualified spellings name a module SOME PROJECT FILE declares;
 *   D2  of those, how many would RESOLVE under the two-layer fix (declaration keyed
 *       `Module.name` + the call target rebased to the module path) — resolved / ambiguous /
 *       still unresolved, with the leaf-alone trap counted beside it for the same edges;
 *   D3  the local-call bucket: how many of the 902 `context+haskellSpecific` unresolved
 *       edges carry a DOTTED scoped identity (`owner.local`) and how many carry a bare name.
 *
 * READ-ONLY. Same discovery, same stride, same production entry as the gate.
 *
 *   bun validation/m14/fixtures/haskell/lane-logs/probe-hs-qualifier-project.mts [maxFiles]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX = Number(process.argv[2] ?? 400)
const SIZE_CAP = 1024 * 1024

const { parseFile } = await import(path.join(process.cwd(), "src/ast/pool-worker"))

const repoOf = (f: string) => path.relative(CR, f).split(path.sep)[0]

function discover(): { all: string[]; sample: string[] } {
  const found: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(".hs")) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) continue
      } catch {
        continue
      }
      found.push(abs)
    }
  }
  found.sort()
  let sample = found
  if (MAX > 0 && found.length > MAX) {
    const stride = Math.max(1, Math.floor(found.length / MAX))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
    sample = picked
  }
  return { all: found, sample }
}

const srcOf = new Map<string, string>()
const read = (f: string) => {
  let s = srcOf.get(f)
  if (s === undefined) {
    try {
      s = readFileSync(f, "utf8")
    } catch {
      s = ""
    }
    srcOf.set(f, s)
  }
  return s
}
const fileModule = (src: string) => src.match(/^\s*module\s+([A-Z][\w.]*)/m)?.[1] ?? "Main"
function fileAliases(src: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /^\s*import\s+(?:safe\s+)?(qualified\s+)?([A-Z][\w.]*)\s+as\s+([A-Z][\w]*)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) out.set(m[3], m[2])
  return out
}

// ---- project-wide module map, from the header of every tracked file (regex, no parse)
const { all, sample } = discover()
const moduleFiles = new Map<string, Map<string, string[]>>() // repo -> module -> files
for (const f of all) {
  const repo = repoOf(f)
  if (!moduleFiles.has(repo)) moduleFiles.set(repo, new Map())
  const mod = fileModule(read(f))
  const m = moduleFiles.get(repo)!
  if (!m.has(mod)) m.set(mod, [])
  m.get(mod)!.push(f)
}
process.stderr.write(`discovery: ${all.length} tracked .hs, sampled ${sample.length}, repos ${moduleFiles.size}\n`)

// ---- parse the sample: edges + key space
type E = { tgt: string; md: Record<string, any>; src: string; repo: string; label: string }
const edges: E[] = []
const projKeys = new Map<string, Map<string, number>>()
let parsed = 0
for (const file of sample) {
  const repo = repoOf(file)
  let r: any
  try {
    r = await parseFile(file, repo, { projectRoot: path.join(CR, repo) } as any)
  } catch {
    continue
  }
  parsed++
  let keys = projKeys.get(repo)
  if (!keys) projKeys.set(repo, (keys = new Map()))
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    keys.set(name, (keys.get(name) ?? 0) + 1)
    const q = String(s?.qualifiedName ?? "")
    if (q && q !== name) keys.set(q, (keys.get(q) ?? 0) + 1)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const tgt = String(rel?.target ?? "")
    if (!tgt) continue
    edges.push({ tgt, md: (rel?.metadata ?? {}) as any, src: file, repo, label: String(rel?.type ?? "") })
  }
}

// ---- module-file symbol names, parsed ON DEMAND and memoized
const modNames = new Map<string, Map<string, number>>() // file -> bare symbol name -> count
async function namesOfModuleFile(f: string): Promise<Map<string, number>> {
  let m = modNames.get(f)
  if (m) return m
  m = new Map()
  modNames.set(f, m)
  let r: any
  try {
    r = await parseFile(f, repoOf(f), { projectRoot: path.join(CR, repoOf(f)) } as any)
  } catch {
    return m
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const n = String(s?.name ?? "")
    const q = String(s?.qualifiedName ?? "")
    // a module-level declaration is the one whose qualifiedName is its bare name
    if (n && (!q || q === n)) m.set(n, (m.get(n) ?? 0) + 1)
  }
  return m
}

const d = { qualified: 0, projectModule: 0, resolve: 0, amb: 0, unresolved: 0, leafResolve: 0, leafAmb: 0, leafUnresolved: 0 }
const examples: string[] = []
const ambExamples: string[] = []
const namedModules = new Set<string>()

for (const e of edges) {
  const isQC = e.md.isQualifiedCall === true
  const isQK = e.md.isQualifiedConstructorApplication === true
  if (!isQC && !isQK) continue
  d.qualified++
  const dot = e.tgt.lastIndexOf(".")
  if (dot <= 0) continue
  const qual = e.tgt.slice(0, dot)
  const leaf = e.tgt.slice(dot + 1)
  const aliases = fileAliases(read(e.src))
  const module = aliases.get(qual) ?? qual
  const files = moduleFiles.get(e.repo)?.get(module)
  if (!files || files.length === 0) {
    d.unresolved++
    continue
  }
  d.projectModule++
  namedModules.add(`${e.repo}:${module}`)
  // the two-layer key `Module.leaf`: how many MODULE-LEVEL declarations of `leaf` the module's files hold
  let n = 0
  for (const f of files) n += (await namesOfModuleFile(f)).get(leaf) ?? 0
  if (n === 1) {
    d.resolve++
    if (examples.length < 15) examples.push(`${path.relative(CR, e.src)}  ${e.tgt} -> ${module}.${leaf}`)
  } else if (n > 1) {
    d.amb++
    if (ambExamples.length < 15) ambExamples.push(`${path.relative(CR, e.src)}  ${e.tgt} -> ${module}.${leaf} (${n} decls)`)
  } else d.unresolved++
  // the leaf-alone trap on the SAME edges, measured in the sample's key space
  const ln = projKeys.get(e.repo)!.get(leaf) ?? 0
  if (ln === 1) d.leafResolve++
  else if (ln > 1) d.leafAmb++
  else d.leafUnresolved++
}

// ---- D3: the local-call bucket
let localDotted = 0
let localBare = 0
const localDottedExamples: string[] = []
for (const e of edges) {
  if (e.md.context !== "local function call") continue
  const keys = projKeys.get(e.repo)!
  const n = keys.get(e.tgt) ?? 0
  if (n === 1) continue // resolves today
  if (e.tgt.includes(".")) {
    localDotted++
    if (localDottedExamples.length < 8) localDottedExamples.push(`${path.relative(CR, e.src)}  ${e.tgt}`)
  } else localBare++
}

const o = (s: string) => process.stdout.write(s + "\n")
o(`HASKELL DOABILITY PROBE v3 — the top cause against the WHOLE PROJECT's module map`)
o(`tracked .hs ${all.length} · sampled ${parsed} · edges ${edges.length} · repos ${moduleFiles.size}`)
o(``)
o(`D1  qualified spellings (calls + qualified ctor applications) .......... ${d.qualified}`)
o(`    whose qualifier names a module SOME PROJECT FILE declares ......... ${d.projectModule}`)
o(`    distinct project modules named .................................... ${namedModules.size}`)
o(``)
o(`D2  TWO-LAYER FIX over those edges (whole-project module map, module files parsed):`)
o(`      RESOLVED ${d.resolve} · AMBIGUOUS ${d.amb} · still unresolved ${d.unresolved}`)
for (const s of examples) o(`        ${s}`)
o(`      ambiguous:`)
for (const s of ambExamples) o(`        ${s}`)
o(`    ONE-LAYER TRAP on the SAME edges (bare leaf, sample key space):`)
o(`      resolved ${d.leafResolve} · AMBIGUOUS ${d.leafAmb} · unresolved ${d.leafUnresolved}`)
o(``)
o(`D3  the local-call bucket, unresolved after removing those that resolve today:`)
o(`    dotted scoped identity (\`owner.local\`) .... ${localDotted}`)
o(`    bare name ................................. ${localBare}`)
for (const s of localDottedExamples) o(`        ${s}`)
