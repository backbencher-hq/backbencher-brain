// M12.19 Objective-C: scan the pinned corpus (Clyde@8fec41dd — 7 .m/.h
// files, the M11.10 corpus target) for grammar errors through the real
// pipeline. Mirrors the C/C++/Rust corpus-errors precedent.
import { readFileSync, statSync } from "node:fs"
import { execSync } from "node:child_process"

const ROOT = "$HOME/fixtures/repositories/Clyde"
const MIN_BYTES = 256

async function main() {
  const out = execSync("git ls-files '*.m' '*.h'", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const files = out.split("\n").filter((f) => f.trim().length > 0)
  const candidates: string[] = []
  for (const f of files) {
    try {
      const st = statSync(`${ROOT}/${f}`)
      if (st.size >= MIN_BYTES) candidates.push(f)
    } catch {}
  }

  const { parseFile } = await import("../../src/ast/pool-worker")
  let errFiles = 0, okFiles = 0, crashFiles = 0, timeoutFiles = 0
  const errors: string[] = []
  for (const f of candidates) {
    const abs = `${ROOT}/${f}`
    try {
      const p = await parseFile(abs, ROOT)
      const parseErrs = (p.errors ?? []).filter((e: any) => e?.severity !== "info")
      if (parseErrs.length > 0) {
        errFiles++
        errors.push(`${f} | ${parseErrs.length} | ${(parseErrs[0]?.message || "").slice(0, 90)}`)
      } else {
        okFiles++
      }
    } catch (e: any) {
      crashFiles++
      errors.push(`${f} | CRASH | ${(e?.message || "").slice(0, 90)}`)
    }
  }
  console.log(`candidates=${candidates.length} ok=${okFiles} errors=${errFiles} crashes=${crashFiles} timeouts=${timeoutFiles}`)
  for (const e of errors.slice(0, 40)) console.log(`  ${e}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
