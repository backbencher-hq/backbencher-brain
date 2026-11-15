/**
 * REPOINTED CALL EDGES — the edges `publishQualifiedCallTargets` re-spells, with the
 * declaration each new target names, so ten of them can be hand-read against the source.
 *
 * A `calls` target containing `::` is this fix's output and nothing else's: `target` is a
 * callee leaf everywhere in `handleCallExpression`, and no other branch writes a path there.
 *
 * Run: bun run validation/m14/fixtures/rust/repointed-call-edges.mts   (MAX_FILES, BB_CORPUS_ROOT)
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX_FILES = Number(process.env.MAX_FILES ?? 400)
const SIZE_CAP = 1024 * 1024
const SHOW = Number(process.env.SHOW ?? 24)

const found: string[] = []
for (const name of readdirSync(CR)) {
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
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".rs")) continue
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
const total = found.length
const stride = Math.max(1, Math.floor(total / MAX_FILES))
const files: string[] = []
for (let i = 0; i < found.length && files.length < MAX_FILES; i += stride) files.push(found[i])

const repoOf = (f: string) => f.slice(CR.length + 1).split("/")[0]
const rel = (f: string) => f.slice(CR.length + 1)

const declAt = new Map<string, string[]>()
const edges: Array<{ file: string; line: number; source: string; target: string; qualified: string; project: string; leaf: string }> = []
const nameCount = new Map<string, Map<string, number>>()
const namePos = new Map<string, Map<string, string[]>>()
const qualCount = new Map<string, Map<string, number>>()
for (const f of files) {
  let r: any
  try {
    r = await parseFile(f, repoOf(f), { projectRoot: path.join(CR, repoOf(f)) } as any)
  } catch {
    continue
  }
  const proj = repoOf(f)
  const nc = nameCount.get(proj) ?? new Map<string, number>()
  nameCount.set(proj, nc)
  const qc = qualCount.get(proj) ?? new Map<string, number>()
  qualCount.set(proj, qc)
  for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
    if (s?.name) nc.set(String(s.name), (nc.get(String(s.name)) ?? 0) + 1)
    if (s?.name) {
      const arr = namePos.get(proj) ?? new Map<string, string[]>()
      const at = arr.get(String(s.name)) ?? []
      at.push(`${rel(f)}:${s.startLine ?? "?"}`)
      arr.set(String(s.name), at)
      namePos.set(proj, arr)
    }
    const fqn = s?.qualifiedName
    if (typeof fqn === "string" && fqn && fqn.includes("::")) {
      qc.set(fqn, (qc.get(fqn) ?? 0) + 1)
      const arr = declAt.get(fqn) ?? []
      arr.push(`${rel(f)}:${s.startLine ?? s?.range?.startLine ?? "?"} (${s.kind})`)
      declAt.set(fqn, arr)
    }
  }
  for (const x of Array.isArray(r?.relationships) ? r.relationships : []) {
    if (String(x?.type) !== "calls") continue
    const t = String(x?.target ?? "")
    if (!t.includes("::")) continue
    edges.push({
      file: rel(f),
      line: Number(x?.line_number ?? 0) || 0,
      source: String(x?.source ?? ""),
      target: t,
      qualified: String(x?.metadata?.qualified ?? ""),
      project: proj,
      leaf: t.slice(t.lastIndexOf("::") + 2),
    })
  }
}

console.log(`repointed call edges — ${files.length} of ${total} corpus .rs files (MAX_FILES=${MAX_FILES})`)
console.log(`TOTAL repointed: ${edges.length}`)
let uniq = 0
const uniqKeys = new Set<string>()
for (const e of edges) uniqKeys.add(e.target)
uniq = uniqKeys.size
console.log(`distinct qualified targets: ${uniq}`)

// THE PER-EDGE OUTCOME SPLIT — before = the BARE LEAF (the pre-fix resolution key), after = the
// qualified target. Sample-scoped project key space, exactly the gate's model.
const outcome = (n: number) => (n === 1 ? "resolved" : n === 0 ? "unresolved" : "amb")
const split = new Map<string, number>()
let regressed = 0
for (const e of edges) {
  const before = outcome(nameCount.get(e.project)?.get(e.leaf) ?? 0)
  const after = outcome(qualCount.get(e.project)?.get(e.target) ?? 0)
  split.set(`${before} -> ${after}`, (split.get(`${before} -> ${after}`) ?? 0) + 1)
  if (before === "resolved" && after !== "resolved") regressed++
}
console.log(`\nPER-EDGE OUTCOME (before = bare leaf, after = qualified target)`)
for (const [k, v] of [...split.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(24)} ${v}`)
console.log(`resolved -> NOT resolved (a regression in the gate's columns): ${regressed}`)

// OF THE EDGES THAT WERE ALREADY `resolved`: did the bare leaf name the declaration the code
// means, or a same-named declaration in ANOTHER file? The gate cannot tell those apart — this is
// the "resolved but wrong" class, and the fix either preserves or corrects it.
let sameFileBefore = 0
let crossFileBefore = 0
for (const e of edges) {
  if (outcome(nameCount.get(e.project)?.get(e.leaf) ?? 0) !== "resolved") continue
  const bareAt = namePos.get(e.project)?.get(e.leaf) ?? []
  const qualAt = declAt.get(e.target) ?? []
  const bareFiles = new Set(bareAt.map((s) => s.split(":")[0]))
  const qualFiles = new Set(qualAt.map((s) => s.split(":")[0]))
  if ([...bareFiles].some((f) => qualFiles.has(f))) sameFileBefore++
  else crossFileBefore++
}
console.log(`  of those, the bare leaf's unique declaration was in the SAME file as the qualified one: ${sameFileBefore}`)
console.log(`  of those, the bare leaf bound a declaration in ANOTHER file (old binding crossed files):       ${crossFileBefore}`)

console.log(`\n${"file:line".padEnd(60)} ${"source".padEnd(22)} target -> declaration the key names`)
for (const e of edges.slice(0, SHOW)) {
  const where = `${e.file}:${e.line}`.padEnd(60)
  const decls = declAt.get(e.target) ?? []
  console.log(`${where} ${e.source.padEnd(22)} ${e.target}   [declared: ${decls.join(", ") || "NOT DECLARED IN SAMPLE"}]   (qualified=${e.qualified})`)
}
