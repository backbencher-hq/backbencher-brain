/**
 * PROVE `SQL_RULED` against the real arbiter, without editing the arbiter.
 *
 * WHY THIS EXISTS. `script/m14/ontology-coverage-gate.ts` is supervisor-owned
 * (§8 of the lane brief) and its `RULED_BY_LANG` is a literal with no extension
 * point, so it exits 2 for `sql`:
 *
 *   ontology coverage gate — no RULING TABLE for sql.
 *   Refusing to report: a gate with an empty table would call every un-emitted type
 *   RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
 *
 * The table therefore lives lane-side in `script/m14/sql-ruled.ts` and the
 * supervisor's permanent change is two lines. This script APPLIES those two lines to
 * a COPY of the arbiter, in a temporary file outside the repository, and runs the
 * copy. The arbiter on disk is never modified and the patched copy is never
 * committed — so what is demonstrated is the arbiter's own verdict logic over the
 * lane's own table, not a second implementation of it.
 *
 * THE TWO LINES, mechanically:
 *   1. `import { SQL_RULED } from "./sql-ruled"`
 *   2. `sql: SQL_RULED` inside `RULED_BY_LANG`
 * and the copy's relative imports are rewritten to absolute paths because it no
 * longer sits beside `differential.ts`.
 *
 * USAGE:
 *   npx tsx validation/m14/fixtures/sql/run-ruling-table.mts [--corpus-root DIR]
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }

const gatePath = path.join(ROOT, "script/m14/ontology-coverage-gate.ts")
let src = readFileSync(gatePath, "utf8")
let patch = gatePath

const alreadyWired = /RULED_BY_LANG: Record<string, Ruled\[\]> = \{[^}]*\bsql:/.test(src)
if (alreadyWired) {
  console.log("the arbiter already has a `sql` entry — nothing to demonstrate; run it directly:")
  console.log("  npx tsx script/m14/ontology-coverage-gate.ts sql")
} else {
  // The copy must live INSIDE the repo's node_modules subtree, or Node cannot resolve
  // the arbiter's own `import … from "web-tree-sitter"` — a temp directory under /tmp
  // has no node_modules above it and the run dies before printing a verdict, which
  // would be reported as the lane's table failing when nothing of the sort happened.
  const dir = mkdtempSync(path.join(ROOT, "node_modules", ".bb-sql-gate-"))
  patch = path.join(dir, "ontology-coverage-gate-with-sql.mts")
  // The copy lives outside the repo, so every relative import becomes absolute.
  //
  // ANCHORED ON THE DECLARATION, NOT THE LITERAL. Pass 2 anchored on the whole object literal:
  //
  //   'const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED }'
  //
  // and two other lanes then added their own entries (`lua: LUA_RULED, toml: TOML_RULED`), so the
  // anchor stopped matching and this script exited 2 with "the arbiter's RULED_BY_LANG literal is
  // not the shape this script expects" — a STALE ANCHOR reading as a lane failure. Six agents edit
  // this file's neighbours concurrently, so the anchor has to be the part that does not change:
  // the declaration's own prefix, with the entry spliced in immediately after the brace. That
  // tolerates any number of other lanes' entries and any order they arrive in.
  src = src
    .replace(/from "\.\.\/\.\.\/src\/ast\//g, `from "${ROOT}/src/ast/`)
    // EVERY sibling import, not just `./differential`. Two lanes have since added `./lua-ruled`
    // and `./toml-ruled` to the arbiter, and the copy died with ERR_MODULE_NOT_FOUND on the first
    // one — the same stale-hardcoding failure as the anchor above, one level down. The rewritten
    // set is discovered from the source rather than listed, so the next lane's entry does not break
    // this script either.
    .replace(/from "\.\/([A-Za-z0-9_-]+)"/g, (_m, name) => `from "${ROOT}/script/m14/${name}"`)
    .replace(
      "const RULED_BY_LANG: Record<string, Ruled[]> = {",
      'import { SQL_RULED } from "' + ROOT + '/script/m14/sql-ruled"\nconst RULED_BY_LANG: Record<string, Ruled[]> = { sql: SQL_RULED,',
    )
  if (!/\bsql: SQL_RULED/.test(src)) {
    console.error("the patch did not apply: the arbiter's RULED_BY_LANG literal is not the shape this script expects.")
    console.error("That is a report-to-supervisor item, not something to work around silently.")
    process.exit(2)
  }
  writeFileSync(patch, src)
  console.log(`patched copy: ${patch} (the arbiter on disk is untouched)\n`)
}

const corpus = argOf("--corpus-root")
const cmd = `npx tsx ${alreadyWired ? gatePath : patch} sql`
console.log(`$ BB_CORPUS_ROOT=${corpus ?? "(default)"} ${cmd}\n`)
try {
  const out = execFileSync("npx", ["tsx", alreadyWired ? gatePath : patch, "sql"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...(corpus ? { BB_CORPUS_ROOT: corpus } : {}) },
    stdio: ["ignore", "pipe", "inherit"],
  })
  console.log(out)
} catch (e: any) {
  console.log(e.stdout ?? "")
  console.log(`exit ${e.status}`)
}
