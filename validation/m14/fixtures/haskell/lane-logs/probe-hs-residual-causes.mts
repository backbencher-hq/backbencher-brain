/**
 * HASKELL LANE — the residual bucketed by NAMED CAUSE, and the QUALIFIER question
 * answered BEFORE any edit.
 *
 * READ-ONLY. It parses the same population the incoming gate parses (same discovery
 * rule, same stride, same `pool-worker.parseFile` production path) and rebuilds the
 * same project-scoped key space (a symbol answers to its `name` AND to a
 * `qualifiedName` that genuinely qualifies — differs from the name), then asks three
 * questions the gate's capped worklist cannot answer:
 *
 *   A. WHAT KEYS EXIST. Does any symbol carry a MODULE-qualified name
 *      (`Module.func`)? This decides whether rebasing a qualified call from its
 *      local import ALIAS to the module path can resolve anything at all.
 *   B. WHAT EACH UNRESOLVED EDGE WOULD DO UNDER THREE SPELLINGS of the same call:
 *      as-written (`P.runParser`), rebased to the module (`Text.Parsec.runParser`),
 *      and the bare leaf (`runParser`). The leaf is the PRICED TRAP: it converts
 *      unresolved into a tie-break, and this probe counts how many picks that
 *      tie-break would have to make (declaration count > 1) rather than asserting it.
 *   C. THE CAUSE BUCKETS, by marker signature and by construct shape, with counts
 *      that close on the gate's own `unresolved` column.
 *
 *   bun validation/m14/fixtures/haskell/lane-logs/probe-hs-residual-causes.mts [maxFiles]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX = Number(process.argv[2] ?? 400)
const SIZE_CAP = 1024 * 1024
const LANG = "haskell"
const EXT = "hs"

const { parseFile } = await import(path.join(process.cwd(), "src/ast/pool-worker"))

type Entry = { file: string; repo: string }

function discover(): Entry[] {
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
      if (!rel.toLowerCase().endsWith(`.${EXT}`)) continue
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
    return picked.map((f) => ({ file: f, repo: repoOf(f) }))
  }
  return found.map((f) => ({ file: f, repo: repoOf(f) }))
}

function repoOf(f: string): string {
  const rel = path.relative(CR, f)
  return rel.split(path.sep)[0]
}

type Pending = {
  label: string
  tgt: string
  sig: string
  repo: string
  srcFile: string
  line: number | null
  meta: Record<string, any>
}

const files = discover()
const projects = new Map<string, Map<string, number>>()
const pending: Pending[] = []
const fileAlias = new Map<string, Map<string, string>>() // file -> alias -> module
const bareNameCount = new Map<string, number>() // project -> bare count (diagnostic)
const moduleKeys = new Set<string>() // keys that look module-qualified
let parsed = 0
let failed = 0

const PROGRESS = 200

for (const { file, repo } of files) {
  let r: any
  try {
    r = await parseFile(file, repo, { projectRoot: path.join(CR, repo) } as any)
  } catch {
    failed++
    continue
  }
  parsed++
  if (parsed % PROGRESS === 0) process.stderr.write(`  … ${parsed}/${files.length}\n`)
  let keys = projects.get(repo)
  if (!keys) {
    keys = new Map()
    projects.set(repo, keys)
  }
  const alias = new Map<string, string>()
  for (const im of Array.isArray(r.imports) ? r.imports : []) {
    const a = im?.metadata?.alias
    const mod = String(im?.module ?? im?.source ?? "")
    if (a && mod && a !== mod) alias.set(String(a), mod)
  }
  if (alias.size > 0) fileAlias.set(file, alias)

  const bump = (k: string) => keys!.set(k, (keys!.get(k) ?? 0) + 1)
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    bump(name)
    const q = String(s?.qualifiedName ?? "")
    if (q && q !== name) {
      bump(q)
      if (q.includes(".")) moduleKeys.add(q)
    }
  }

  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? "")
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (!tgt) continue
    const md = (rel?.metadata ?? {}) as Record<string, any>
    const markKeys = Object.keys(md).filter(
      (k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null,
    )
    markKeys.sort()
    pending.push({
      label,
      tgt,
      sig: markKeys.length ? markKeys.join("+") : "(no marker)",
      repo,
      srcFile: file,
      line: Number(rel?.line_number ?? rel?.lineNumber ?? rel?.line ?? 0) || null,
      meta: md,
    })
  }
}

// -- project key space, exactly the gate's: name + genuine qualifiedName
const outcomes = { resolved: 0, amb: 0, unresolved: 0 }
const bySig = new Map<string, Record<string, number>>()
const unresByShape = new Map<string, number>()
const qualifiedThesis = {
  qualifiedCallEdges: 0,
  aliasBacked: 0,
  alreadyFullPath: 0,
  aliasModuleInCorpus: 0,
  asWrittenResolved: 0,
  rebasedResolved: 0,
  rebasedAmbig: 0,
  rebasedUnresolved: 0,
  leafResolved: 0,
  leafAmbig: 0,
  leafUnresolved: 0,
}
/** the rebased-into-collRes trap, quantified: how many declarations answer the LEAF name */
const leafCollisionHist = new Map<number, number>()

const isQualifiedCall = (p: Pending) => p.meta.isQualifiedCall === true
const isQualifiedCtor = (p: Pending) => p.meta.isQualifiedConstructorApplication === true

for (const p of pending) {
  const keys = projects.get(p.repo)!
  const n = keys.get(p.tgt) ?? 0
  const out = n === 1 ? "resolved" : n > 1 ? "amb" : "unresolved"
  outcomes[out as keyof typeof outcomes]++
  let row = bySig.get(p.sig)
  if (!row) {
    row = { resolved: 0, amb: 0, unresolved: 0 }
    bySig.set(p.sig, row)
  }
  row[out]++

  const bare = p.tgt.includes(".") ? p.tgt.slice(p.tgt.lastIndexOf(".") + 1) : p.tgt
  if (out === "unresolved") {
    // ---- named-cause shape, from the construct the edge came from
    let shape: string
    if (p.meta.isHaskellImport === true) shape = "imports: a module path no file in this project declares"
    else if (isQualifiedCall(p) || isQualifiedCtor(p))
      shape = `qualified spelling (${p.meta.isQualifiedCall ? "call" : "constructor"}): a qualifier production has no key for`
    else if (p.meta.isConstructorApplication === true)
      shape = "bare constructor application: a data constructor declared nowhere in the project"
    else if (p.meta.derived === true) shape = "derived instance: a class name (Prelude/base) declared nowhere in the project"
    else if (p.meta.isInstance === true) shape = "instance declaration: the instantiated type/class declared nowhere in the project"
    else if (p.meta.isSuperclass === true) shape = "class superclass: the base class declared nowhere in the project"
    else if (p.meta.isReExport === true) shape = "re-export (`module M`): the re-exported module declared nowhere in the project"
    else if (p.label === "uses") shape = "type usage: a type name declared nowhere in the project"
    else if (p.label === "exports") shape = "export list: a name this file does not declare"
    else if (p.label === "calls" && p.meta.context === "local function call")
      shape = "local call: the scoped lexical identity (`owner.local`) is deliberately not a symbol"
    else shape = `${p.label}: other`
    unresByShape.set(shape, (unresByShape.get(shape) ?? 0) + 1)
  }

  if (!isQualifiedCall(p)) continue
  qualifiedThesis.qualifiedCallEdges++
  if (out === "resolved") qualifiedThesis.asWrittenResolved++
  const dot = p.tgt.lastIndexOf(".")
  if (dot <= 0) continue
  const qual = p.tgt.slice(0, dot)
  const leaf = p.tgt.slice(dot + 1)
  const alias = fileAlias.get(p.srcFile)?.get(qual)
  if (!alias) {
    qualifiedThesis.alreadyFullPath++
    continue
  }
  qualifiedThesis.aliasBacked++
  const rebased = `${alias}.${leaf}`
  const rn = keys.get(rebased) ?? 0
  if (rn === 1) qualifiedThesis.rebasedResolved++
  else if (rn > 1) qualifiedThesis.rebasedAmbig++
  else qualifiedThesis.rebasedUnresolved++
  const ln = keys.get(leaf) ?? 0
  leafCollisionHist.set(ln, (leafCollisionHist.get(ln) ?? 0) + 1)
  if (ln === 1) qualifiedThesis.leafResolved++
  else if (ln > 1) qualifiedThesis.leafAmbig++
  else qualifiedThesis.leafUnresolved++
}

const total = pending.length
const out = (s: string) => process.stdout.write(s + "\n")
out(`HASKELL RESIDUAL CAUSE PROBE — read-only, same population rule as the incoming gate`)
out(`population: ${parsed} parsed of ${files.length} sampled (MAX=${MAX}) · failed ${failed} · repos ${projects.size}`)
out(`edges ${total} · resolved ${outcomes.resolved} · collRes(amb decl>1) ${outcomes.amb} · unresolved ${outcomes.unresolved}`)
out(``)
out(`A. DO MODULE-QUALIFIED KEYS EXIST? keys of the form X.Y produced by a symbol: ${moduleKeys.size} distinct`)
out(`   (a rebase to a MODULE PATH can only resolve if the declaration is keyed that way)`)
out(`   sample: ${[...moduleKeys].slice(0, 12).map((k) => JSON.stringify(k)).join(" ")}`)
out(``)
out(`B. THE QUALIFIER THESIS, on isQualifiedCall edges (${qualifiedThesis.qualifiedCallEdges})`)
out(`   as-written target resolved: ${qualifiedThesis.asWrittenResolved}`)
out(`   qualifier is a file-local IMPORT ALIAS: ${qualifiedThesis.aliasBacked}`)
out(`   qualifier is already a full module path:  ${qualifiedThesis.alreadyFullPath}`)
out(`   -- if rebased alias -> module path:  resolved ${qualifiedThesis.rebasedResolved} · amb ${qualifiedThesis.rebasedAmbig} · unresolved ${qualifiedThesis.rebasedUnresolved}`)
out(`   -- if dropped to the bare LEAF:      resolved ${qualifiedThesis.leafResolved} · amb ${qualifiedThesis.leafAmbig} · unresolved ${qualifiedThesis.leafUnresolved}`)
out(`   LEAF declaration-count histogram (count -> edges): ${[...leafCollisionHist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(" ")}`)
out(`   (count>=2 is the forbidden class: unresolved would become a tie-break the indexer measures ~75% wrong)`)
out(``)
out(`C. UNRESOLVED BY NAMED CAUSE (shape, count)`)
for (const [shape, n] of [...unresByShape.entries()].sort((a, b) => b[1] - a[1])) out(`   ${String(n).padStart(6)}  ${shape}`)
out(`   ${String([...unresByShape.values()].reduce((a, b) => a + b, 0)).padStart(6)}  TOTAL (must equal unresolved ${outcomes.unresolved})`)
out(``)
out(`D. OUTCOME BY MARKER SIGNATURE (gate's TABLE 1 rows, reproduced)`)
for (const [sig, row] of [...bySig.entries()].sort((a, b) => b[1].unresolved - a[1].unresolved))
  out(`   ${String(row.unresolved).padStart(6)} unres ${String(row.resolved).padStart(6)} res ${String(row.amb).padStart(5)} amb  ${sig}`)
