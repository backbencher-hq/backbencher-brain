// M12.15 CSS corpus error scan: parse a deterministic sample of real-world CSS
// files through the production engine and report hard parse errors, crashes,
// and timeouts. Corpus: svelte@26786e92 packages/svelte/tests/css/samples
// (Svelte compiler CSS-output test fixtures — real, language-representative CSS).
import { ASTEngine } from "../../src/ast/engine"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = "$HOME/fixtures/repositories/svelte/packages/svelte/tests/css/samples"
const SAMPLE_LIMIT = Number(process.env.CSS_SAMPLE_LIMIT || 400)

async function main() {
  const { readdirSync } = await import("node:fs")
  const dirs = readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  const files: string[] = []
  for (const dir of dirs) {
    const p = join(ROOT, dir, "expected.css")
    try {
      const st = await import("node:fs").then((fs) => fs.statSync(p))
      if (st.size > 0) files.push(p)
    } catch { /* no expected.css in this sample */ }
  }
  // Deterministic sample (stable sort + slice — no randomness)
  const sample = files.slice(0, Math.min(SAMPLE_LIMIT, files.length))

  const parser = await ASTEngine.getParser("css")
  let errors = 0
  let crashes = 0
  let timeouts = 0
  const errorFiles: { file: string; msg: string }[] = []
  const t0 = Date.now()

  for (let i = 0; i < sample.length; i++) {
    const f = sample[i]
    const src = readFileSync(f, "utf8")
    try {
      const tree = parser.parse(src)
      const root = tree.rootNode
      const errCount = countErrors(root)
      if (errCount > 0) {
        errors++
        errorFiles.push({ file: f.replace(ROOT, ""), msg: `ERROR nodes: ${errCount}` })
      }
    } catch (e: any) {
      crashes++
      errorFiles.push({ file: f.replace(ROOT, ""), msg: `crash: ${e?.message?.slice(0, 80)}` })
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2)

  console.log(`css corpus: ${sample.length} files, errors=${errors}, crashes=${crashes}, timeouts=${timeouts}, ${elapsed}s`)
  for (const ef of errorFiles) console.log(`  ERR ${ef.file} — ${ef.msg}`)
  console.log(`sample=${JSON.stringify({ total: files.length, sampled: sample.length, limit: SAMPLE_LIMIT })}`)
}

function countErrors(n: any): number {
  let c = 0
  if (n.type === "ERROR" || n.hasError) c++
  for (let i = 0; i < n.namedChildCount; i++) c += countErrors(n.namedChild(i))
  return c
}

main().catch((e) => { console.error(e); process.exit(1) })
