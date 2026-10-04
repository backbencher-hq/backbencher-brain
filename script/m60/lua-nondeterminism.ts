/**
 * M14 ONTOLOGY — LUA WAVE-2. WHICH files are nondeterministic?
 *
 * Wave-2 finding 1 says `parseFile` carries cumulative WASM state, so a figure
 * from one long-running process is a figure about that run. lua's own measurement
 * is SHARPER than that, and sharding is what exposed it: two runs over a
 * provably identical draw (`drawDigest c990daa339a9…`, 3,252 files, 8 fresh
 * processes) disagreed by 129 relationships and 71 symbols — and two of the eight
 * shards were byte-identical across both runs while six were not.
 *
 * A whole-corpus delta cannot be acted on. "300,971 vs 300,842" does not say
 * which file to distrust, and a file that fails to parse on one run and not the
 * next is a different problem from a file whose symbols are silently wrong on
 * both. So this records a PER-FILE digest and runs the same shard twice: the
 * files whose digest differs between the two passes are the nondeterministic set,
 * named.
 *
 * A file counts as differing when its symbol count, its relationship count, its
 * per-type counts, or its fallback flag differ. The counts are the observable;
 * this does not claim to know WHY they differ, and says so.
 *
 * USAGE:
 *   npx tsx script/m60/lua-nondeterminism.ts --pass a
 *   npx tsx script/m60/lua-nondeterminism.ts --pass b
 *   npx tsx script/m60/lua-nondeterminism.ts --diff
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUTDIR = "/tmp/opencode/lua-lane/nondet"
const PASS = process.argv.includes("--pass") ? process.argv[process.argv.indexOf("--pass") + 1] : null
const DIFF = process.argv.includes("--diff")
const SHARDS = 8
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const SHARD_I = Number(arg("--shard", "0"))

const files: { repo: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean).sort()
  } catch { continue }
  for (const rel of tracked) files.push({ repo: e, rel, abs: path.join(dir, rel) })
}
const drawHash = createHash("sha256")
for (const f of files) {
  let size = -1
  try { size = statSync(f.abs).size } catch { /* a missing file is part of the identity */ }
  drawHash.update(`${f.repo}\t${f.rel}\t${size}\n`)
}
const drawDigest = drawHash.digest("hex")

mkdirSync(OUTDIR, { recursive: true })

if (DIFF) {
  const a = JSON.parse(readFileSync(path.join(OUTDIR, "pass-a.json"), "utf8"))
  const b = JSON.parse(readFileSync(path.join(OUTDIR, "pass-b.json"), "utf8"))
  console.log(`draw digest a=${a.drawDigest.slice(0, 12)} b=${b.drawDigest.slice(0, 12)}  identical=${a.drawDigest === b.drawDigest}`)
  const keys = new Set([...Object.keys(a.files), ...Object.keys(b.files)])
  const differing: string[] = []
  for (const k of [...keys].sort()) {
    const x = a.files[k], y = b.files[k]
    if (!x || !y) { differing.push(k); continue }
    if (x.d !== y.d) differing.push(k)
  }
  const out = {
    schemaVersion: 1, kind: "lua-nondeterminism-diff",
    drawDigestA: a.drawDigest, drawDigestB: b.drawDigest,
    drawIdentical: a.drawDigest === b.drawDigest,
    files: keys.size, differingFiles: differing.length,
    differing: differing.map((k) => ({ file: k, a: a.files[k], b: b.files[k] })),
    totals: {
      a: Object.values(a.files).reduce((s: number, f: any) => s + (f?.s ?? 0), 0),
      b: Object.values(b.files).reduce((s: number, f: any) => s + (f?.s ?? 0), 0),
    },
  }
  writeFileSync(path.join(OUTDIR, "diff.json"), JSON.stringify(out, null, 2))
  console.log(`files ${out.files}  differing between passes: ${out.differingFiles}`)
  for (const d of out.differing.slice(0, 40)) {
    console.log(`  ${d.file}\n      a: ${JSON.stringify(d.a)}\n      b: ${JSON.stringify(d.b)}`)
  }
  if (out.differing.length > 40) console.log(`  ... ${out.differing.length - 40} more`)
  console.log(`-> ${path.join(OUTDIR, "diff.json")}`)
  process.exit(0)
}

if (!PASS) { console.error("usage: --pass <a|b> [--shard i] | --diff"); process.exit(2) }

const lo = Math.floor((files.length * SHARD_I) / SHARDS)
const hi = Math.floor((files.length * (SHARD_I + 1)) / SHARDS)
const mine = files.slice(lo, hi)
const out: { drawDigest: string; pass: string; shard: string; files: Record<string, any> } = {
  drawDigest, pass: PASS, shard: `${SHARD_I}/${SHARDS}`, files: {},
}
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= mine.length) return
    const f = mine[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    let threw = false
    try { r = await parseFile(f.abs, path.join(CR, f.repo)) } catch { threw = true }
    const syms = threw ? [] : (r?.symbols ?? [])
    const rels = threw ? [] : (r?.relationships ?? [])
    const byType: Record<string, number> = {}
    for (const x of rels) { const t = String(x?.type ?? "").toLowerCase(); byType[t] = (byType[t] ?? 0) + 1 }
    const digest = createHash("sha256")
    digest.update(`s=${syms.length} r=${rels.length} fb=${threw ? "throw" : r?.fallback === true ? "1" : "0"} err=${(r?.errors?.length ?? 0) - (threw ? 0 : 0)}`)
    for (const k of Object.keys(byType).sort()) digest.update(`|${k}=${byType[k]}`)
    out.files[label] = { s: syms.length, r: rels.length, fb: threw ? "throw" : r?.fallback === true ? 1 : 0, byType, d: digest.digest("hex").slice(0, 16) }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))
writeFileSync(path.join(OUTDIR, `part-${PASS}-${SHARD_I}.json`), JSON.stringify(out))
console.log(`pass ${PASS} shard ${SHARD_I}/${SHARDS}: ${mine.length} files, ${Object.keys(out.files).length} digested`)