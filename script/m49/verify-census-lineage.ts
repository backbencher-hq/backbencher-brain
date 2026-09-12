// M49.G6 — regex-census LINEAGE gate.
//
// Why this exists (found 2026-09-12, M49 W5).
//
// `verification/m12/results/regex-census.json` is a DERIVED artifact: a
// position index of every regex usage in `src/ast`. `script/m12/regex-census.ts`
// derives it from the WORKING TREE, so any run while an analyzer is
// uncommitted bakes that uncommitted position into the committed census. That
// had already happened: the census committed at HEAD recorded
// `real-cpp-analyzer.ts:727` and `real-rust-analyzer.ts:452/453` while the
// COMMITTED cpp/rust blobs carry those regexes at 382/405/406 — i.e. the
// committed index described a tree that no commit ever contained, and it had
// been that way for waves without anything noticing. The cost is not cosmetic:
// on a clean checkout every consumer of the census (R2's register comparison,
// the M12 census gate, the debt-total arithmetic) is reasoning about positions
// that do not exist in the code it is shipping.
//
// `script/m12/verify-regex-census.ts` cannot catch this: it re-scans the
// WORKING TREE and compares, so a tree that is dirty in the same way as the
// census colludes with it (both sides agree on a position that HEAD does not
// have). This gate closes that hole from the other side — it needs no parser
// and no re-scan, only the committed blobs:
//
//   1. every census entry must name a file that exists in HEAD;
//   2. its recorded `line` must exist in that HEAD blob;
//   3. that exact line must contain the entry's recorded regex `source`.
//
// Together with verify-regex-census (census <-> working tree) this pins the
// census to BOTH ends: complete for the tree it is built from, and anchored to
// the commit it ships with. It carries no regex of its own (string equality
// only), per the M12 no-regex policy.
//
// Run: bun script/m49/verify-census-lineage.ts [--census <path>]
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const argIdx = process.argv.indexOf("--census")
const CENSUS_PATH = argIdx >= 0 && process.argv[argIdx + 1]
  ? resolve(process.argv[argIdx + 1])
  : join(ROOT, "validation", "m12", "results", "regex-census.json")

interface CensusEntry { file: string; line: number; column?: number; source: string; classification?: string }

let passed = 0
let failed = 0
const failures: string[] = []
function check(label: string, condition: boolean): void {
  if (condition) passed++
  else { failed++; failures.push(label) }
}

function headBlobLines(file: string): string[] | null {
  for (const candidate of [`src/ast/${file}`, file]) {
    try {
      const out = execFileSync("git", ["show", `HEAD:${candidate}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      return out.split("\n")
    } catch { /* try the next candidate path shape */ }
  }
  return null
}

function main(): void {
  if (!existsSync(CENSUS_PATH)) throw new Error(`census not found: ${CENSUS_PATH}`)
  const census = JSON.parse(readFileSync(CENSUS_PATH, "utf8")) as { perFile?: { file: string; usages: CensusEntry[] }[] }
  const perFile = census.perFile ?? []
  const entries = perFile.flatMap((f) => f.usages ?? [])
  check("census has entries to anchor", entries.length > 0)

  const blobCache = new Map<string, string[] | null>()
  for (const entry of entries) {
    const where = `${entry.file}:${entry.line}`
    if (!blobCache.has(entry.file)) blobCache.set(entry.file, headBlobLines(entry.file))
    const lines = blobCache.get(entry.file)
    if (!lines) {
      check(`census entry ${where} names a file present in HEAD`, false)
      continue
    }
    check(`census entry ${where} is inside its HEAD blob (${lines.length} lines)`,
      Number.isInteger(entry.line) && entry.line >= 1 && entry.line <= lines.length)
    const text = lines[entry.line - 1] ?? ""
    check(`census entry ${where} line contains its recorded source ${entry.source}`,
      text.includes(entry.source))
  }

  console.log(failed === 0
    ? `M49.G6: ${passed} passed, 0 failed — every census entry is anchored to a committed blob (${entries.length} entries, ${blobCache.size} files)`
    : `M49.G6: ${passed} passed, ${failed} failed — the census is NOT anchored to HEAD (it was derived from a dirty tree); regenerate it at a stable tree or from committed blobs. First failures:\n  ${failures.slice(0, 6).join("\n  ")}`)
  if (failed > 0) process.exit(1)
}

main()
