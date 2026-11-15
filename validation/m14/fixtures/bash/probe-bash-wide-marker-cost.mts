/**
 * WHAT WOULD A WIDE MARKER COST? — the refutation count, measured before the marker exists.
 *
 * `incoming-rule.ts` verifies an external claim against the key space, and a claim whose target
 * the project DOES declare is REFUTED — it counts against the lane exactly like an unresolved
 * edge. A single-file analyzer cannot know the project's key space, so a marker emitted by
 * SHAPE (`every call that is not a local function`) is refuted on exactly the edges whose target
 * the project declares. This file counts that set.
 *
 * It is the number that decides the marker's shape, and it is measured on the gate's own
 * population with the gate's own rule:
 *
 *   refutation cost = calls edges whose target is a BARE IDENTIFIER declared in the project key
 *                     space (those would flip from resolved/ambiguous to externalRefuted)
 *
 * Read-only. CLI: npx tsx validation/m14/fixtures/bash/probe-bash-wide-marker-cost.mts [--ext sh] [--nf 60]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const EXT = (flag("ext") ?? "sh").toLowerCase()
const NF = Number(flag("nf") ?? "60")
const SIZE_CAP = 1024 * 1024

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
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(`.${EXT}`)) continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size <= SIZE_CAP) found.push(abs)
    } catch {
      /* absent */
    }
  }
}
found.sort()
let files = found
if (NF > 0 && found.length > NF) {
  const stride = Math.max(1, Math.floor(found.length / NF))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < NF; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string): string => path.relative(CR, f).split(path.sep)[0]
const isIdentifier = (s: string): boolean => {
  if (s.length === 0) return false
  const c0 = s.charCodeAt(0)
  const ok0 = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95 || c0 === 36
  if (!ok0) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 36) continue
    return false
  }
  return true
}

const { parseFile } = await import(`${REPO_ROOT}/src/ast/pool-worker.ts`)
type KS = { decl: Map<string, number>; kinds: Map<string, Set<string>> }
const spaces = new Map<string, KS>()
const calls: { tgt: string; repo: string; isFunctionCall: boolean }[] = []
const sampleFiles = new Set(files)
// whole-population key space per repo (the project scope production has after a full index)
for (const f of found) {
  const repo = repoOf(f)
  let ks = spaces.get(repo)
  if (!ks) spaces.set(repo, (ks = { decl: new Map(), kinds: new Map() }))
  let r: any
  try {
    r = await parseFile(f, repo, { projectRoot: repo } as any)
  } catch {
    continue
  }
  if (!r) continue
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    ks.decl.set(name, (ks.decl.get(name) ?? 0) + 1)
    let ks2 = ks.kinds.get(name)
    if (!ks2) ks.kinds.set(name, (ks2 = new Set()))
    ks2.add(String(s?.kind ?? ""))
  }
  if (!sampleFiles.has(f)) continue
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const t = String(rel?.type ?? rel?.relationshipType ?? "")
    if (t !== "calls") continue
    calls.push({ tgt: String(rel?.target ?? ""), repo, isFunctionCall: rel?.metadata?.isFunctionCall === true })
  }
}

let refutable = 0
let verifiable = 0
let notIdentifier = 0
let localCalls = 0
const refutedNames = new Map<string, number>()
for (const c of calls) {
  if (c.isFunctionCall) {
    localCalls++
    continue
  }
  if (!isIdentifier(c.tgt)) {
    notIdentifier++
    continue
  }
  const declared = (spaces.get(c.repo)?.decl.get(c.tgt) ?? 0) > 0
  if (declared) {
    refutable++
    refutedNames.set(c.tgt, (refutedNames.get(c.tgt) ?? 0) + 1)
  } else verifiable++
}
console.log(`WIDE-MARKER COST — ${files.length} sampled of ${found.length} tracked .${EXT} files, project key space = the WHOLE admitted population`)
console.log(`  calls edges in the sample           : ${calls.length}`)
console.log(`  local function calls (never marked) : ${localCalls}`)
console.log(`  target is not an identifier (path)  : ${notIdentifier}`)
console.log(`  BARE IDENTIFIER, project declares it: ${refutable}  <-- a wide marker is REFUTED here`)
console.log(`  BARE IDENTIFIER, project declares not: ${verifiable}  <-- a wide marker would verify here`)
console.log("")
const top = [...refutedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log(`  the refutations, by name (top ${top.length}):`)
for (const [n, c] of top) console.log(`    ${String(c).padStart(4)}  ${n}`)
