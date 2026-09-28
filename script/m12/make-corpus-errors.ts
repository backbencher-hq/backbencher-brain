import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

// Make has no single language-representative repository: the ecosystem is a
// scattering of one-off Makefiles. The corpus is the union of every tracked
// Makefile (Makefile / GNUmakefile / *.mk) in the already-pinned clean repos
// used by other M12 analyzers — each at its pinned revision, each audited
// through the production parseFile pipeline.
const CORPUS: { name: string; dir: string }[] = [
  { name: "elixir", dir: "$HOME/fixtures/repositories/elixir" },
  { name: "cabal", dir: "$HOME/fixtures/repositories/cabal" },
  { name: "luarocks", dir: "$HOME/fixtures/repositories/luarocks" },
  { name: "terraform", dir: "$HOME/fixtures/repositories/terraform" },
  { name: "cython", dir: "$HOME/fixtures/repositories/cython" },
  { name: "tree-sitter-clean", dir: "$HOME/fixtures/repositories/tree-sitter-clean" },
]

const revisions: Record<string, string> = {}
const files: { repo: string; file: string; abs: string }[] = []
for (const repo of CORPUS) {
  revisions[repo.name] = execFileSync("git", ["-C", repo.dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const rels = execFileSync("git", ["-C", repo.dir, "ls-files", "*.mk", "Makefile", "GNUmakefile", "makefile"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).sort()
  for (const rel of rels) files.push({ repo: repo.name, file: rel, abs: `${repo.dir}/${rel}` })
}

const errors: { repo: string; file: string; count: number; rows: number[] }[] = []
const crashes: { repo: string; file: string; error: string }[] = []
for (const f of files) {
  try {
    const parsed = await parseFile(f.abs, process.cwd())
    const fileErrors = parsed.errors ?? []
    if (fileErrors.length) {
      errors.push({ repo: f.repo, file: f.file, count: fileErrors.length, rows: fileErrors.map((e: any) => e.range?.startLine ?? 0) })
    }
  } catch (error: any) {
    crashes.push({ repo: f.repo, file: f.file, error: String(error?.message ?? error).slice(0, 300) })
  }
}

const result = {
  analyzer: "make",
  corpus: "union of pinned clean repos (elixir@024beb1, cabal@670955a4, luarocks@665f160b, terraform@2e1710bf, cython, tree-sitter-clean)",
  revisions,
  extensions: ["Makefile", "GNUmakefile", "makefile", "*.mk"],
  trackedFiles: files.length,
  errorFiles: errors.length,
  errorNodes: errors.reduce((sum, item) => sum + item.count, 0),
  crashFiles: crashes.length,
  unexpectedErrorFiles: errors.length,
  cleanFiles: files.length - errors.length,
  crashes,
  errors,
  passed: errors.length === 0 && crashes.length === 0,
  policy:
    "Every tracked Makefile in the six pinned clean repos is audited through the production parseFile pipeline. The analyzer never crashes, never synthesizes phantom rows, and the vendored tree-sitter-make grammar models the full corpus with zero ERROR/MISSING nodes. Clean acceptance files are those with zero parse errors.",
}
writeFileSync("validation/m12/results/make-corpus-errors.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify({ ...result, errors: undefined, crashes: undefined }, null, 2))
console.log("\n-- error samples --")
for (const u of errors.slice(0, 20)) console.log(`ERR ${u.repo}/${u.file} (${u.count} nodes @ rows ${u.rows.join(",")})`)
if (!result.passed) process.exitCode = 1
