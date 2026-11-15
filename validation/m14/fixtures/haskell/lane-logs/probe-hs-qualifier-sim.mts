/**
 * HASKELL LANE — probe v2: THE QUALIFIER, SIMULATED BEFORE THE EDIT.
 *
 * v1 established two facts that decide this lane:
 *   1. a module-level declaration is keyed by its BARE NAME — `parseFile` returns
 *      `qualifiedName === name` for it (measured: `"applyN" | scope "" | "applyN"`),
 *      so NO `Module.func` key exists in the project key space;
 *   2. `pool-worker`'s import mapping drops the analyzer's `metadata.alias`, so the
 *      call-site qualifier is the only record of it in the parse result.
 *
 * So this probe answers, by simulation and before any edit:
 *   Q1  how many qualified calls name an import ALIAS, and how many of those aliases
 *       resolve to a module a PROJECT FILE declares (the only ones a rebase can reach);
 *   Q2  the TWO-LAYER fix — target `${module}.${leaf}` AND module-qualified symbol keys
 *       — resolved / ambiguous / unresolved;
 *   Q3  the ONE-LAYER trap — target dropped to the bare leaf — resolved / ambiguous
 *       (declaration count > 1 is the tie-break class the indexer measures ~75% wrong);
 *   Q4  what the two-layer fix does to edges that are ALREADY resolved (can a new key
 *       steal or collide with an existing binding?).
 *
 * READ-ONLY. Same discovery, same stride and same production entry as the gate.
 *
 *   bun validation/m14/fixtures/haskell/lane-logs/probe-hs-qualifier-sim.mts [maxFiles]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX = Number(process.argv[2] ?? 400)
const SIZE_CAP = 1024 * 1024

const { parseFile } = await import(path.join(process.cwd(), "src/ast/pool-worker"))

function repoOf(f: string): string {
  return path.relative(CR, f).split(path.sep)[0]
}

function discover(): string[] {
  const found: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
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
  if (MAX > 0 && found.length > MAX) {
    const stride = Math.max(1, Math.floor(found.length / MAX))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
    return picked
  }
  return found
}

/** module name declared by a file's header, or "Main" (the language rule). PROBE-SIDE
 *  approximation of `ctx.currentModule`: one regex over the header, used only to build a
 *  SIMULATED key space, never to state a production number. */
function fileModule(src: string): string {
  const m = src.match(/^\s*module\s+([A-Z][\w.]*)/m)
  return m ? m[1] : "Main"
}
/** alias -> module, from the source. Same approximation caveat. */
function fileAliases(src: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /^\s*import\s+(?:safe\s+)?(qualified\s+)?([A-Z][\w.]*)\s+as\s+([A-Z][\w]*)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) out.set(m[3], m[2])
  return out
}

const files = discover()
type Sym = { name: string; q: string; module: string; kind: string }
const projKeys = new Map<string, Map<string, number>>() // name + genuine qname (the gate's key space)
const projSim = new Map<string, Map<string, number>>() // + SIMULATED `Module.name` keys
const projModules = new Map<string, Set<string>>() // module names a project file declares
const edges: { label: string; tgt: string; md: Record<string, any>; src: string; repo: string }[] = []
let parsed = 0

for (const file of files) {
  const repo = repoOf(file)
  let r: any
  try {
    r = await parseFile(file, repo, { projectRoot: path.join(CR, repo) } as any)
  } catch {
    continue
  }
  parsed++
  const src = readFileSync(file, "utf8")
  const mod = fileModule(src)
  let keys = projKeys.get(repo)
  if (!keys) projKeys.set(repo, (keys = new Map()))
  let sim = projSim.get(repo)
  if (!sim) projSim.set(repo, (sim = new Map()))
  let mods = projModules.get(repo)
  if (!mods) projModules.set(repo, (mods = new Set()))
  mods.add(mod)

  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const q = String(s?.qualifiedName ?? "")
    bump(keys, name)
    if (q && q !== name) bump(keys, q)
    bump(sim, name)
    if (q && q !== name) bump(sim, q)
    else bump(sim, `${mod}.${name}`) // THE SIMULATED DECLARATION-SIDE KEY
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const tgt = String(rel?.target ?? "")
    if (!tgt) continue
    edges.push({ label: String(rel?.type ?? ""), tgt, md: (rel?.metadata ?? {}) as any, src: file, repo })
  }
}

const isQCall = (e: any) => e.md.isQualifiedCall === true
const isQCtor = (e: any) => e.md.isQualifiedConstructorApplication === true
const isModulePathlike = (t: string) => /^[A-Z][\w]*(?:\.[A-Z][\w]*)+$/.test(t)

const q = {
  qualifiedCall: 0,
  qualifiedCtor: 0,
  aliasSpelled: 0,
  aliasToProjectModule: 0,
  fullPathSpelled: 0,
  fullPathToProjectModule: 0,
}
const sim = { resolved: 0, amb: 0, unresolved: 0 }
const leaf = { resolved: 0, amb: 0, unresolved: 0 }
const simAmbigExamples: string[] = []
const leafAmbigExamples: string[] = []
const simResolvedExamples: string[] = []
const rowSamples: string[] = []

let alreadyResolvedDotted = 0
let alreadyResolvedDottedWouldCollide = 0

for (const e of edges) {
  const keys = projKeys.get(e.repo)!
  const n = keys.get(e.tgt) ?? 0
  const resolvedNow = n === 1
  if (resolvedNow && e.tgt.includes(".")) {
    alreadyResolvedDotted++
    // a new `Module.name` key could collide with this binding
    const simCount = projSim.get(e.repo)!.get(e.tgt) ?? 0
    if (simCount > 1) alreadyResolvedDottedWouldCollide++
  }
  if (!isQCall(e) && !isQCtor(e)) continue
  const dot = e.tgt.lastIndexOf(".")
  if (dot <= 0) continue
  const qual = e.tgt.slice(0, dot)
  const leafName = e.tgt.slice(dot + 1)
  if (isQCall(e)) q.qualifiedCall++
  else q.qualifiedCtor++

  const aliases = fileAliases(readFileSync(e.src, "utf8"))
  const aliased = aliases.get(qual)
  const target = aliased ?? qual
  const inProject = projModules.get(e.repo)!.has(target)
  if (aliased) {
    q.aliasSpelled++
    if (inProject) q.aliasToProjectModule++
  } else {
    q.fullPathSpelled++
    if (inProject) q.fullPathToProjectModule++
  }

  // Q2 — TWO LAYERS: symbol keyed `Module.name` and target rebased to the module path
  const full = `${target}.${leafName}`
  const sn = projSim.get(e.repo)!.get(full) ?? 0
  if (sn === 1) {
    sim.resolved++
    if (simResolvedExamples.length < 12) simResolvedExamples.push(`${path.relative(CR, e.src)}  ${e.tgt} -> ${full}`)
  } else if (sn > 1) {
    sim.amb++
    if (simAmbigExamples.length < 12) simAmbigExamples.push(`${path.relative(CR, e.src)}  ${e.tgt} -> ${full} (${sn} decls)`)
  } else sim.unresolved++

  // Q3 — ONE LAYER (the trap): drop the qualifier, publish the bare leaf
  const ln = keys.get(leafName) ?? 0
  if (ln === 1) leaf.resolved++
  else if (ln > 1) {
    leaf.amb++
    if (leafAmbigExamples.length < 12)
      leafAmbigExamples.push(`${path.relative(CR, e.src)}  ${e.tgt} -> ${leafName} (${ln} decls)`)
  } else leaf.unresolved++
  if (rowSamples.length < 12 && (e.md.context ?? "") === "$ application")
    rowSamples.push(`${path.relative(CR, e.src)}  ${e.tgt}`)
}

const o = (s: string) => process.stdout.write(s + "\n")
o(`HASKELL QUALIFIER SIMULATION — read-only, before any edit`)
o(`population: ${parsed} parsed of ${files.length} sampled · repos ${projKeys.size} · edges ${edges.length}`)
o(``)
o(`Q1  QUALIFIED SPELLINGS`)
o(`    isQualifiedCall edges .......... ${q.qualifiedCall}`)
o(`    isQualifiedCtor edges .......... ${q.qualifiedCtor}`)
o(`    qualifier is an import ALIAS ... ${q.aliasSpelled}   of which the module IS a project file: ${q.aliasToProjectModule}`)
o(`    qualifier is a FULL module path  ${q.fullPathSpelled}   of which the module IS a project file: ${q.fullPathToProjectModule}`)
o(`    (= a rebase can only reach the ${q.aliasToProjectModule + q.fullPathToProjectModule} whose module this project declares)`)
o(``)
o(`Q2  TWO-LAYER FIX (symbol keyed \`Module.name\` + target rebased to the module path)`)
o(`    resolved ${sim.resolved} · ambiguous ${sim.amb} · unresolved ${sim.unresolved}   of ${q.qualifiedCall + q.qualifiedCtor}`)
o(`    resolved examples:`)
for (const s of simResolvedExamples) o(`      ${s}`)
o(`    ambiguous examples:`)
for (const s of simAmbigExamples) o(`      ${s}`)
o(``)
o(`Q3  ONE-LAYER TRAP (drop the qualifier, publish the bare leaf)`)
o(`    resolved ${leaf.resolved} · AMBIGUOUS ${leaf.amb} · unresolved ${leaf.unresolved}`)
o(`    (ambiguous is the forbidden class: no answer -> a tie-break the indexer measures ~75% wrong)`)
for (const s of leafAmbigExamples) o(`      ${s}`)
o(``)
o(`Q4  EFFECT ON ALREADY-RESOLVED DOTTED TARGETS`)
o(`    dotted targets resolved today .......... ${alreadyResolvedDotted}`)
o(`    of those whose key would gain a second declaration under the two-layer fix: ${alreadyResolvedDottedWouldCollide}`)
