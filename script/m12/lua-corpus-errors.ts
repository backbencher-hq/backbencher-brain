// M12.32: scan the pinned LuaRocks corpus for grammar errors and parser crashes.
import { parseFile } from "../../src/ast/pool-worker"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

// The default pointed at $HOME/fixtures/repositories/luarocks, which no
// longer exists — so running this with no argument failed on a path that had
// vanished, and the default silently encoded a corpus that cannot be reproduced.
const root = process.argv[2] || "$HOME/fixtures/repositories/luvit"
const relative = execFileSync("git", ["-C", root, "ls-files", "*.lua", "*.luau"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean)
const files = relative.map((file) => `${root}/${file}`)
let errorFiles = 0
let errorNodes = 0
let crashFiles = 0
let symbols = 0
let relationships = 0
const errorList: string[] = []
for (const file of files) {
  try {
    const parsed = await parseFile(file, process.cwd())
    symbols += parsed.symbols?.length ?? 0
    relationships += parsed.relationships?.length ?? 0
    const errors = parsed.errors?.length ?? 0
    if (errors > 0) {
      errorFiles++
      errorNodes += errors
      errorList.push(`${file.slice(root.length + 1)}: ${errors} errors`)
    }
  } catch (error: any) {
    crashFiles++
    errorList.push(`${file.slice(root.length + 1)}: CRASH ${String(error?.message || error).slice(0, 120)}`)
  }
}
// M60: this instrument WROTE NO ARTIFACT — it printed to stdout and set an exit
// code. But script/m12/verify-corpus-claims.ts reads the artifact side of every
// lane's corpus claim from `validation/m12/results/<lang>-corpus-errors.json`, so
// for lua that side was STRUCTURALLY null and the claims gate recorded
// `agreement: true` with `artifactSymbols: null`.
//
// That is a vacuous pass: the gate compares a manifest number against nothing and
// reports agreement, which is why the M60 `corpus` cell read `pass` for a lane
// whose corpus claim points at a directory that no longer exists. The committed
// lua-corpus-errors.json was an ORPHAN — nothing in script/ wrote it, and nothing
// in script/ read it.
//
// The file is now written, which is what makes the claim checkable: the gate can
// compare the manifest's numbers against a measurement instead of against null.
const document = {
  schemaVersion: 1,
  kind: "lua_corpus_errors",
  analyzer: "lua",
  corpus: root.split("/").filter(Boolean).pop() ?? root,
  corpusPath: root,
  corpusRepo: root.split("/").filter(Boolean).pop() ?? root,
  revision: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  currentCommit: execFileSync("git", ["-C", process.cwd(), "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  extensions: ["*.lua", "*.luau"],
  mode: "full-corpus",
  measuredFiles: files.length,
  symbols,
  relationships,
  errorFiles,
  errorNodes,
  crashFiles,
  errorFileList: errorList,
  passed: errorFiles === 0 && crashFiles === 0,
  policy: "Every file in scope is audited through the production parseFile pipeline. The known-invalid fixture is a corpus selector fact, not a defect: a repository may ship a deliberately malformed file, and reporting it as a parse failure would be measuring the selector. Named per repo in $HOME/fixtures/repositories/MANIFEST.json.",
  note: "Written by this instrument. It previously wrote nothing, which left the M60 `corpus` cell reading `pass` on a vacuous comparison against a null artifact side.",
}
writeFileSync("validation/m12/results/lua-corpus-errors.json", JSON.stringify(document, null, 2) + "\n")

console.log(`total=${files.length} errorFiles=${errorFiles} errorNodes=${errorNodes} crashFiles=${crashFiles} symbols=${symbols} relationships=${relationships}`)
for (const item of errorList.slice(0, 30)) console.log(`  ${item}`)
if (errorFiles || crashFiles) process.exitCode = 1
