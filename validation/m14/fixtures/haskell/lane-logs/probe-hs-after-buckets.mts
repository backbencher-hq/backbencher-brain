/**
 * HASKELL LANE — probe v4: the AFTER state of the residual, bucketed by named cause with the
 * BINDING row the fix added, plus a STRATIFIED sample of the edges the fix moves, with the
 * source text of each (for the hand-read in HASKELL-FIX.md §5).
 *
 * READ-ONLY. Same discovery, same stride, same production entry as the incoming gate.
 *
 *   bun validation/m14/fixtures/haskell/lane-logs/probe-hs-after-buckets.mts [maxFiles]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX = Number(process.argv[2] ?? 400)
const SIZE_CAP = 1024 * 1024
const SAMPLES = Number(process.argv[3] ?? 10)
const { parseFile } = await import(path.join(process.cwd(), "src/ast/pool-worker"))
const repoOf = (f: string) => path.relative(CR, f).split(path.sep)[0]
const lines = new Map<string, string[]>()
const readLines = (f: string): string[] => {
  let l = lines.get(f)
  if (!l) {
    l = readFileSync(f, "utf8").split("\n")
    lines.set(f, l)
  }
  return l
}

function discover(): string[] {
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
  if (MAX > 0 && found.length > MAX) {
    const stride = Math.max(1, Math.floor(found.length / MAX))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
    return picked
  }
  return found
}

const files = discover()
const keysByRepo = new Map<string, Map<string, number>>()
type E = { label: string; tgt: string; md: Record<string, any>; src: string; repo: string; line: number | null }
const edges: E[] = []
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
  let keys = keysByRepo.get(repo)
  if (!keys) keysByRepo.set(repo, (keys = new Map()))
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
    edges.push({
      label: String(rel?.type ?? ""),
      tgt,
      md: (rel?.metadata ?? {}) as any,
      src: file,
      repo,
      line: Number(rel?.line_number ?? 0) || null,
    })
  }
}

const SP = "\u0000"
const out = { resolved: 0, amb: 0, unresolved: 0, binding: 0 }
const cause = new Map<string, number>()
const moved: E[] = []
for (const e of edges) {
  const keys = keysByRepo.get(e.repo)!
  const isBinding = e.md.localBinding === true && e.tgt.includes(SP) && !e.tgt.endsWith(SP)
  if (isBinding) {
    out.binding++
    moved.push(e)
    continue
  }
  const n = keys.get(e.tgt) ?? 0
  const o = n === 1 ? "resolved" : n > 1 ? "amb" : "unresolved"
  out[o as "resolved" | "amb" | "unresolved"]++
  if (o !== "unresolved") continue
  const m = e.md
  let shape: string
  if (m.isHaskellImport === true) shape = "imports: module path no project file declares"
  else if (m.isQualifiedCall === true) shape = "qualified CALL: qualifier no key can carry"
  else if (m.isQualifiedConstructorApplication === true) shape = "qualified CONSTRUCTOR application: ditto"
  else if (m.isConstructorApplication === true) shape = "bare constructor application: ctor declared nowhere in the project"
  else if (m.derived === true) shape = "derived instance: Prelude/base class declared nowhere in the project"
  else if (m.isInstance === true) shape = "instance declaration: class declared nowhere in the project"
  else if (m.isSuperclass === true) shape = "class superclass: base class declared nowhere in the project"
  else if (m.isReExport === true) shape = "re-export (`module M`): module declared nowhere in the project"
  else if (e.label === "uses") shape = "type usage: type declared nowhere in the project"
  else if (e.label === "exports") shape = "export list: name this file does not declare"
  else shape = `${e.label}: other`
  cause.set(shape, (cause.get(shape) ?? 0) + 1)
}

const o = (s: string) => process.stdout.write(s + "\n")
o(`HASKELL AFTER-BUCKETS PROBE (v4) — read-only, same population rule as the incoming gate`)
o(`population: ${parsed} parsed of ${files.length} sampled · edges ${edges.length}`)
o(`resolved ${out.resolved} · amb(decl>1) ${out.amb} · unresolved ${out.unresolved} · binding ${out.binding}`)
o(``)
o(`UNRESOLVED BY NAMED CAUSE`)
for (const [s, n] of [...cause.entries()].sort((a, b) => b[1] - a[1])) o(`  ${String(n).padStart(6)}  ${s}`)
o(`  ${String([...cause.values()].reduce((a, b) => a + b, 0)).padStart(6)}  TOTAL (must equal unresolved ${out.unresolved})`)
o(``)
o(`THE ${moved.length} EDGES THE FIX MOVES — every one of them a call whose callee is a where/let LOCAL.`)
o(`A STRATIFIED SAMPLE OF ${SAMPLES}, ONE PER FILE (stride), with the line the edge anchors on:${""}`)
const byFile = new Map<string, E>()
for (const e of moved) if (!byFile.has(e.src)) byFile.set(e.src, e)
const ordered = [...byFile.values()].sort((a, b) => a.src.localeCompare(b.src))
const stride = Math.max(1, Math.floor(ordered.length / SAMPLES))
for (let i = 0, k = 0; i < ordered.length && k < SAMPLES; i += stride, k++) {
  const e = ordered[i]
  const rel = path.relative(CR, e.src)
  const src = readLines(e.src)
  const srcLine = e.line ? (src[e.line - 1] ?? "").trim() : ""
  const identity = e.tgt.slice(e.tgt.indexOf(SP) + 1)
  const localName = identity.includes(".") ? identity.slice(identity.lastIndexOf(".") + 1) : identity
  // the local's own DECLARATION, found by its binder name (lowercase, at a binding position)
  const decls: string[] = []
  for (let n = 0; n < src.length; n++) {
    if (new RegExp(`^\\s*${localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(src[n])) {
      decls.push(`${n + 1}: ${src[n].trim()}`)
      if (decls.length >= 3) break
    }
  }
  o(``)
  o(`[${k + 1}] ${rel}:${e.line ?? "?"}`)
  o(`    emitted target : ${JSON.stringify(e.tgt)}`)
  o(`    the identity   : ${identity}   (the LOCAL, which by HSD6/HSD19 publishes no symbol)`)
  o(`    source line    : ${srcLine}`)
  o(`    local's decl   : ${decls.join("  |  ") || "(binder not found by name-at-line-start)"}`)
}
