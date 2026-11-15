// The c/cpp line shift, sized. src/ast/engine.ts parseRaw blanks
// `__attribute__((...))` / `__declspec(...)` with `" ".repeat(len)` — which
// preserves BYTE offsets but DESTROYS the newlines inside a multi-line match, so
// every line after it is stamped one (or more) too small. That is the mechanism
// behind the M59 Tier A residue (#825's c/cpp lane) and behind every wrong
// symbol range / relationship line in a file that has a multi-line attribute.
//
// This measures the loss with the engine's OWN regexes, over the four c/cpp
// corpus repos.
//
// Usage: bun script/m14/tmp/c912-attr-shift.ts
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const REPOS = "/home/ishaq2321/bb_tests/repositories"

/** EXACTLY the engine's replacement, then the newline count difference. */
function engineBlanked(content: string): string {
  return content
    .replace(/__attribute__\s*\(\([\s\S]*?\)\)/g, (m) => " ".repeat(m.length))
    .replace(/__declspec\s*\([\s\S]*?\)/g, (m) => " ".repeat(m.length))
    .replace(/__restrict__/g, "            ")
    .replace(/__restrict/g, "          ")
    .replace(/__volatile__/g, "            ")
    .replace(/__inline__/g, "          ")
    .replace(/__forceinline/g, "             ")
    .replace(/__cdecl/g, "       ")
    .replace(/__stdcall/g, "         ")
    .replace(/__fastcall/g, "          ")
    .replace(/__stored_key/g, "            ")
}

const counts = (s: string): number => (s.match(/\n/g) ?? []).length

const targets: Array<{ ext: string; exts: RegExp }> = [
  { ext: "c", exts: /\.(c|h)$/ },
  { ext: "cpp", exts: /\.(cpp|cc|cxx|hpp|hh|h)$/ },
]

const REPO_LIST = process.argv.length > 2 ? process.argv.slice(2) : ["sqlite", "jq", "fmt", "nlohmann-json"]
for (const repo of REPO_LIST) {
  const dir = path.join(REPOS, repo)
  let files: string[]
  try {
    files = execSync("git ls-files", { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => /\.(c|h|cpp|cc|cxx|hpp|hh)$/.test(f))
  } catch {
    console.log(`${repo}: not a git checkout — skipped`)
    continue
  }
  let affected = 0
  let maxShift = 0
  let totalShift = 0
  const worst: Array<[string, number]> = []
  for (const rel of files) {
    let text: string
    try {
      text = readFileSync(path.join(dir, rel), "utf8")
    } catch {
      continue
    }
    const before = counts(text)
    const after = counts(engineBlanked(text))
    const shift = before - after
    if (shift > 0) {
      affected++
      totalShift += shift
      if (shift > maxShift) maxShift = shift
      worst.push([rel, shift])
    }
  }
  worst.sort((a, b) => b[1] - a[1])
  console.log(`${repo}: ${files.length} files scanned, ${affected} carry a destroyed newline inside a blanked attribute (max line shift ${maxShift}, total ${totalShift})`)
  for (const [f, s] of worst.slice(0, 5)) console.log(`     ${String(s).padStart(4)} lines ${f}`)
}
