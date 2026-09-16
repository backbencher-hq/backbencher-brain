// M59 / G7: a DETERMINISTIC before/after for the interpolation grammar change.
//
// The differential harness draws a different 60-file sample on every wave (its
// cold-pool rotation), and this repo has already filed that as a finding —
// counts from two rotations are not comparable. So the delta for a grammar
// change is measured here instead: a sorted, limited, reproducible file list,
// with per-file edge counts, so the two wasm builds are compared SET-WISE.
//
// Usage:
//   bun script/m59/compare-groovy-interpolation.ts --out /tmp/before.json \
//     [--repo grails-core] [--limit 400] [--interp-only] [--ext groovy,gradle]
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { ASTEngine } from "../../src/ast/engine"

// `--compare <before.json> <after.json>`: the set-wise diff that a headline count
// cannot give. A grammar change is only safe if NO file loses an edge — and the
// reverse: a LOSS is not automatically a regression. Pre-fix, a file whose
// interpolation did not parse emitted a `calls` edge whose TARGET was the raw
// recovered text, so the fix removes an edge that was itself the defect. The
// comparison prints losses in full (file, kind, count, and the before/after
// values) so each one is adjudicated rather than summarised away.
function compare(beforePath: string, afterPath: string): void {
  const before = JSON.parse(readFileSync(beforePath, "utf8"))
  const after = JSON.parse(readFileSync(afterPath, "utf8"))
  if (before.wasmSha === after.wasmSha) {
    console.error(`refusing to compare: both files were produced by the same wasm (${before.wasmSha.slice(0, 12)}) — a same-build diff proves nothing`)
    process.exit(1)
  }
  const kinds = ["calls", "uses", "other", "symbols", "interpSites"] as const
  const files = Object.keys(before.files)
  const missing = files.filter((f) => !(f in after.files))
  if (missing.length) console.error(`WARNING: ${missing.length} file(s) present before and absent after — the file lists are not comparable`)
  const gain: Record<string, number> = {}
  const loss: Record<string, number> = {}
  const lossDetail: string[] = []
  const touched = new Set<string>()
  for (const f of files) {
    if (!(f in after.files)) continue
    for (const k of kinds) {
      const d = (after.files[f][k] ?? 0) - (before.files[f][k] ?? 0)
      if (d > 0) { gain[k] = (gain[k] ?? 0) + d; touched.add(f) }
      if (d < 0) {
        loss[k] = (loss[k] ?? 0) + d
        touched.add(f)
        lossDetail.push(`LOSS ${f} ${k} ${before.files[f][k]} -> ${after.files[f][k]}`)
      }
    }
  }
  const sum = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`).join(" ") || "(none)"
  console.log(`files compared      : ${files.length}`)
  console.log(`before wasm         : ${before.wasmSha.slice(0, 12)}  after wasm: ${after.wasmSha.slice(0, 12)}`)
  console.log(`files touched       : ${touched.size}`)
  console.log(`gains               : ${sum(gain)}`)
  console.log(`losses              : ${sum(loss)}`)
  for (const l of lossDetail) console.log(`  ${l}`)
  if (lossDetail.length === 0) console.log("  (no file loses any edge, symbol or site)")
}

const cmpIdx = process.argv.indexOf("--compare")
if (cmpIdx > 0) {
  compare(process.argv[cmpIdx + 1], process.argv[cmpIdx + 2])
  process.exit(0)
}

const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const REPO_NAME = arg("--repo", "grails-core")!
const REPO = `$HOME/fixtures/repositories/${REPO_NAME}`
const OUT = arg("--out", "/tmp/groovy-interp.json")!
const LIMIT = parseInt(arg("--limit", "400")!)
const EXTS = arg("--ext", "groovy,gradle")!.split(",")
const INTERP_ONLY = process.argv.includes("--interp-only")
const INTERP = /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/g

async function main(): Promise<void> {
  const revision = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const wasmSha = createHash("sha256").update(readFileSync("$HOME/mcp/backbencher-brain/wasm/tree-sitter-groovy.wasm")).digest("hex")
  let files = execFileSync("git", ["-C", REPO, "ls-files", ...EXTS.map((e) => `*.${e}`)], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort()
  if (INTERP_ONLY) files = files.filter((f) => { try { return INTERP.test(readFileSync(`${REPO}/${f}`, "utf8")) } catch { return false } })
  files = files.slice(0, LIMIT)

  const per: Record<string, { calls: number; uses: number; other: number; interpSites: number; symbols: number }> = {}
  for (const file of files) {
    let src: string
    try {
      src = readFileSync(`${REPO}/${file}`, "utf8")
    } catch {
      continue
    }
    const sites = (src.match(INTERP) ?? []).length
    let calls = 0
    let uses = 0
    let other = 0
    let symbols = 0
    try {
      const res: any = await ASTEngine.parseFile(`${REPO}/${file}`, src)
      symbols = (res.symbols ?? []).length
      for (const r of res.relationships ?? []) {
        const t = String(r.type ?? r.relationshipType)
        if (t === "calls") calls++
        else if (t === "uses") uses++
        else other++
      }
    } catch {
      /* recorded as zeros */
    }
    per[file] = { calls, uses, other, interpSites: sites, symbols }
  }
  writeFileSync(OUT, JSON.stringify({ repo: REPO_NAME, revision, wasmSha, exts: EXTS, interpOnly: INTERP_ONLY, limit: LIMIT, files: per }, null, 2))
  const sum = (k: keyof (typeof per)[string]) => Object.values(per).reduce((a, v) => a + v[k], 0)
  console.log(
    `${Object.keys(per).length} files · calls ${sum("calls")} · uses ${sum("uses")} · other ${sum("other")} · symbols ${sum("symbols")} · interpSites ${sum("interpSites")} · wasm ${wasmSha.slice(0, 12)} -> ${OUT}`,
  )
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
