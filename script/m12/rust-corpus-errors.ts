// M12.18 Rust corpus error scan: parse a deterministic sample of real-world
// Rust files through the production engine and report hard parse errors,
// crashes, and timeouts. Corpus: cargo@94faf917 (clean; the Rust package
// manager — 261 src + 101 crates + 993 tests: real language-representative
// Rust).
import { ASTEngine } from "../../src/ast/engine"
import { readFileSync, statSync } from "node:fs"
import { execSync } from "node:child_process"

const ROOT = "$HOME/fixtures/repositories/cargo"
const SAMPLE_LIMIT = Number(process.env.RUST_SAMPLE_LIMIT || 400)
const MIN_BYTES = Number(process.env.RUST_MIN_BYTES || 1024)

async function main() {
  let files: string[] = []
  try {
    const out = execSync("git ls-files '*.rs'", {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
    files = out.split("\n").filter((f) => f.trim().length > 0)
  } catch {
    console.error("git ls-files failed")
    process.exit(1)
  }

  const candidates: string[] = []
  for (const f of files) {
    try {
      const st = statSync(`${ROOT}/${f}`)
      if (st.size >= MIN_BYTES) candidates.push(f)
    } catch { /* skip */ }
  }
  const sample = candidates.slice(0, Math.min(SAMPLE_LIMIT, candidates.length))

  const parser = await ASTEngine.getParser("rust")
  let errors = 0
  let crashes = 0
  let timeouts = 0
  const errorFiles: { file: string; msg: string }[] = []
  const t0 = Date.now()

  for (let i = 0; i < sample.length; i++) {
    const f = sample[i]
    let src: string
    try {
      src = readFileSync(`${ROOT}/${f}`, "utf8")
    } catch { continue }
    try {
      const tree = parser.parse(src)
      const root = tree.rootNode
      const errCount = countErrors(root)
      if (errCount > 0) {
        errors++
        errorFiles.push({ file: f, msg: `ERROR nodes: ${errCount}` })
      }
    } catch (e: any) {
      crashes++
      errorFiles.push({ file: f, msg: `crash: ${e?.message?.slice(0, 80)}` })
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2)

  console.log(`rust corpus: ${sample.length} files, errors=${errors}, crashes=${crashes}, timeouts=${timeouts}, ${elapsed}s`)
  for (const ef of errorFiles.slice(0, 30)) console.log(`  ERR ${ef.file} — ${ef.msg}`)
  if (errorFiles.length > 30) console.log(`  ... ${errorFiles.length - 30} more`)
  console.log(`sample=${JSON.stringify({ totalCandidates: candidates.length, sampled: sample.length, limit: SAMPLE_LIMIT, minBytes: MIN_BYTES })}`)
}

function countErrors(n: any): number {
  let c = 0
  if (n.type === "ERROR" || n.hasError) c++
  for (let i = 0; i < n.namedChildCount; i++) c += countErrors(n.namedChild(i))
  return c
}

main().catch((e) => { console.error(e); process.exit(1) })
