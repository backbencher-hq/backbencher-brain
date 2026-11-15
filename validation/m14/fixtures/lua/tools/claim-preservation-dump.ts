/**
 * LUA CLAIM PRESERVATION DUMP — is the file claim ADDITIVE, or did it move something else?
 *
 * ## Why this file exists
 *
 * A metadata claim looks additive by reading the diff, and "looks additive" is not a measurement.
 * The programme has four recorded cases of a change being called additive because the intended
 * effect was the only one anybody looked for. So this dump canonicalises EVERYTHING the analyzer
 * publishes for a deterministic set of corpus files — symbols with their names, kinds, ranges,
 * owners and qualified names; relationships with their type, source, target, line and metadata —
 * and a `--compare` run reports exactly which fields differ between two revisions of the analyzer.
 *
 * It answers two questions and refuses to merge them:
 *
 *   MOVED      a symbol, a target, a line, or a metadata VALUE other than the claim key changed.
 *              This is the defect class the dump exists to catch, and it FAILS the comparison.
 *   CLAIMED    a relationship gained `metadata.importProjectFile`, or the set of such keys changed.
 *              This is the intended effect, and it is reported with a count.
 *
 * Usage (run once per revision, then compare):
 *
 *   npx tsx validation/m14/fixtures/lua/tools/claim-preservation-dump.ts --out .tmp-lua/dump-before.json
 *   # change src/ast/real-lua-analyzer.ts
 *   npx tsx validation/m14/fixtures/lua/tools/claim-preservation-dump.ts --out .tmp-lua/dump-after.json
 *   npx tsx validation/m14/fixtures/lua/tools/claim-preservation-dump.ts --compare .tmp-lua/dump-before.json .tmp-lua/dump-after.json
 *
 * The file set is a STRIDE over the gate's own admitted population (git checkouts, `git ls-files`,
 * `.lua`, the 1 MB cap, sorted) — not the first N, which would sample one repository and call it the
 * language. `--files=N` sets the stride size per repo. Read-only.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const CLAIM_KEY = "importProjectFile"

const argv = process.argv.slice(2)
const argOf = (f: string, d: string): string => {
  const i = argv.indexOf(f)
  return i >= 0 ? (argv[i + 1] ?? d) : d
}
const OUT = argOf("--out", "")
const CMP = argv.indexOf("--compare")
const PER_REPO = Number(argOf("--files", "12"))

type Edge = { t: string; s: string; g: string; l: number; md: Record<string, unknown>; claim: string | null }
type Sym = { n: string; k: string; o: string | null; q: string; ls: number }

/** The canonical form: every published field EXCEPT the claim key, which is carried separately. */
function canonSymbol(s: any): Sym {
  return {
    n: String(s?.name ?? ""),
    k: String(s?.kind ?? ""),
    o: s?.ownerName == null ? null : String(s.ownerName),
    q: String(s?.qualifiedName ?? ""),
    ls: Number(s?.range?.startLine ?? s?.startLine ?? 0) || 0,
  }
}
function canonEdge(r: any): Edge {
  const md: Record<string, unknown> = {}
  for (const k of Object.keys(r?.metadata ?? {}).sort()) {
    if (k === CLAIM_KEY) continue
    md[k] = (r.metadata ?? {})[k]
  }
  const raw = r?.metadata?.[CLAIM_KEY]
  return {
    t: String(r?.type ?? r?.relationshipType ?? ""),
    s: String(r?.source ?? ""),
    g: String(r?.target ?? ""),
    l: Number(r?.line_number ?? 0) || 0,
    md,
    claim: typeof raw === "string" && raw.length > 0 ? raw : null,
  }
}

async function dump(): Promise<{ files: { file: string; syms: Sym[]; edges: Edge[] }[]; population: number }> {
  const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
  const out: { file: string; syms: Sym[]; edges: Edge[] }[] = []
  let population = 0
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
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    const files: string[] = []
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(".lua")) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) continue
      } catch {
        continue
      }
      files.push(abs)
    }
    files.sort()
    population += files.length
    const stride = files.length / Math.max(1, PER_REPO)
    const picked: string[] = []
    for (let i = 0; i < PER_REPO && files.length > 0; i++) {
      const f = files[Math.min(files.length - 1, Math.floor(i * stride))]
      if (!picked.includes(f)) picked.push(f)
    }
    for (const abs of picked) {
      let res: any
      try {
        res = await parseFile(abs, dir, { projectRoot: dir } as any)
      } catch {
        continue
      }
      out.push({
        file: path.relative(CR, abs).split(path.sep).join("/"),
        syms: (res.relationships ? (res.symbols ?? []) : []).map(canonSymbol),
        edges: (res.relationships ?? []).map(canonEdge),
      })
    }
  }
  out.sort((a, b) => (a.file < b.file ? -1 : 1))
  return { files: out, population }
}

if (CMP >= 0) {
  const a = JSON.parse(readFileSync(argv[CMP + 1], "utf8"))
  const b = JSON.parse(readFileSync(argv[CMP + 2], "utf8"))
  let moved = 0
  let claimedAdded = 0
  let claimedRemoved = 0
  let claimedChanged = 0
  const examples: string[] = []
  const af = new Map(a.files.map((f: any) => [f.file, f]))
  const bf = new Map(b.files.map((f: any) => [f.file, f]))
  for (const key of new Set([...af.keys(), ...bf.keys()])) {
    const x: any = af.get(key)
    const y: any = bf.get(key)
    if (!x || !y) { moved++; if (examples.length < 8) examples.push(`${key}: present in only one dump`); continue }
    const xa = JSON.stringify(x.syms)
    const ya = JSON.stringify(y.syms)
    if (xa !== ya) { moved++; if (examples.length < 8) examples.push(`${key}: SYMBOLS differ`) }
    const n = Math.max(x.edges.length, y.edges.length)
    for (let i = 0; i < n; i++) {
      const p = x.edges[i]
      const q = y.edges[i]
      if (!p || !q) { moved++; if (examples.length < 8) examples.push(`${key}: edge count ${x.edges.length} -> ${y.edges.length}`); break }
      const ps = JSON.stringify({ ...p, claim: null })
      const qs = JSON.stringify({ ...q, claim: null })
      if (ps !== qs) { moved++; if (examples.length < 8) examples.push(`${key}: EDGE MOVED ${p.t} ${p.g} :: ${ps} -> ${qs}`) }
      if (p.claim === null && q.claim !== null) claimedAdded++
      else if (p.claim !== null && q.claim === null) claimedRemoved++
      else if (p.claim !== q.claim) { claimedChanged++; if (examples.length < 8) examples.push(`${key}: claim changed ${p.claim} -> ${q.claim}`) }
    }
  }
  console.log(`lua claim preservation — ${af.size} file(s) in A, ${bf.size} in B`)
  console.log(`  MOVED (symbols, targets, lines, or a metadata value other than \`${CLAIM_KEY}\`): ${moved}`)
  console.log(`  CLAIMED: added=${claimedAdded} removed=${claimedRemoved} changed=${claimedChanged}`)
  for (const e of examples) console.log(`    ${e}`)
  console.log(moved === 0
    ? `  VERDICT: ADDITIVE — nothing but the claim key moved. ${claimedAdded} edge(s) gained a claim, ${claimedRemoved} lost one.`
    : `  VERDICT: NOT ADDITIVE — ${moved} moved item(s). A change that moves anything else is not a claim fix.`)
  process.exit(moved === 0 ? 0 : 1)
}

const { files, population } = await dump()
const text = JSON.stringify({ files }, null, 0)
const h = createHash("sha256").update(text).digest("hex")
let claims = 0
let edges = 0
for (const f of files) for (const e of f.edges) { edges++; if (e.claim !== null) claims++ }
console.log(`lua claim preservation dump — ${files.length} file(s) strided from ${population} admitted, ${edges} edge(s)`)
console.log(`  edges carrying \`${CLAIM_KEY}\`: ${claims}`)
console.log(`  analyzer digest-relevant dump sha256: ${h}`)
if (OUT.length > 0) {
  writeFileSync(OUT, JSON.stringify({ files, population, dumpSha256: h }) + "\n")
  console.log(`  wrote ${OUT}`)
}
