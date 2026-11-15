/**
 * LUA `require` FILE-CLAIM CONTROL — does the analyzer state the claim, and does the ARBITER confirm it?
 *
 * ## Why this file exists
 *
 * The `imports` fix adds `metadata.importProjectFile` to a `require` edge — a statement about the
 * project that the incoming gate CHECKS (`verifyFileClaim`, `script/m14/incoming-rule.ts`). Two
 * things can therefore go wrong in opposite directions and neither is visible in the analyzer's own
 * output:
 *
 *   a claim that is WRITTEN where no admitted file exists  -> the gate REFUTES it and `extFAIL` > 0;
 *   a claim that is NOT written where one does exist        -> the residual simply stays, and the
 *                                                              number is smaller for no stated reason
 *                                                              (the silent direction `file-claim.ts`
 *                                                              documents for `magicConstants`).
 *
 * So this control ARMS BOTH DIRECTIONS, and it does not stop at "the metadata key is present": every
 * positive arm is fed to the arbiter's own `verifyFileClaim` with `ProjectFacts` built the way the
 * gate builds them (the admitted list, repo-relative, POSIX), so the arm asserts the claim VERIFIES
 * and not merely that it was emitted.
 *
 * ## The arms, and what each would catch
 *
 *   1 plain      `require("mod.sub")` with `mod/sub.lua` present        -> claim "mod/sub.lua"
 *   2 init       `require("pkg")` with `pkg/init.lua` present           -> claim "pkg/init.lua"
 *   3 luaRoot    `require("foo.bar")` from `plug/lua/foo/baz.lua`, with
 *                `plug/lua/foo/bar.lua` present — Neovim's runtimepath -> claim under `plug/lua/`
 *   4 fileDir    `require("helpers")` from `spec/x_spec.lua`, with
 *                `spec/helpers.lua` present — busted's spec dir       -> claim "spec/helpers.lua"
 *   5 absent     `require("nowhere.module")` — nothing on disk          -> NO claim (must not refute)
 *   6 no root    the same file analyzed with NO `projectRoot`           -> NO claim
 *   7 escape     `require("../../etc/passwd")`                          -> NO claim
 *   8 dir        `require("tree")` where `tree/` is a DIRECTORY with files but `tree.lua` does not
 *                exist                                                -> NO claim, and it is NOT a
 *                                                                          defect: a bare
 *                                                                          directory is not a module
 *                                                                          file under any base
 *                                                                          measured here
 *
 * Exit 0 when every arm behaves; exit 1 otherwise, naming the arm.
 *
 *   npx tsx validation/m14/fixtures/lua/tools/require-file-claim-control.ts
 */
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { RealLuaAnalyzer } from "../../../../../src/ast/real-lua-analyzer"
import { verifyFileClaim } from "../../../../../script/m14/incoming-rule"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const TMP = mkdtempSync(path.join(os.tmpdir(), "lua-claim-control-"))
const write = (rel: string, text: string): string => {
  const abs = path.join(TMP, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, text)
  return abs
}

/** The parser the analyzer is written against, loaded the way the gate loads it. */
async function parseWith(text: string) {
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default
  await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new WSP()
  parser.setLanguage(await WSL.load(path.join(ROOT, "wasm", "tree-sitter-lua.wasm")))
  return parser.parse(text)
}

/** Every `imports` edge of one analysis, as [target, importProjectFile|undefined]. */
function importClaims(result: any): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>()
  for (const r of result.relationships ?? []) {
    const t = String(r?.type ?? "")
    if (t !== "imports") continue
    const md = r?.metadata ?? {}
    out.set(String(r?.target ?? ""), typeof md.importProjectFile === "string" ? md.importProjectFile : undefined)
  }
  return out
}

async function analyzeClaim(srcRel: string, text: string, rooted: boolean): Promise<Map<string, string | undefined>> {
  const tree = await parseWith(text)
  const analyzer = new RealLuaAnalyzer()
  const abs = write(srcRel, text)
  const ctx = rooted ? ({ projectRoot: TMP } as any) : undefined
  const result = (analyzer as any).analyze(tree.rootNode, text, abs, ctx)
  return importClaims(result)
}

// THE PROJECT. A plain module, a package directory, an nvim-style `lua/` module root, a busted-style
// spec dir, and a bare directory that is NOT a module file.
write("mod/sub.lua", "return {}\n")
write("pkg/init.lua", "return {}\n")
write("plug/lua/foo/bar.lua", "return {}\n")
write("spec/helpers.lua", "return {}\n")
write("tree/leaf.lua", "return {}\n")

let fail = 0
const check = (arm: string, ok: boolean, detail: string): void => {
  if (!ok) fail++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${arm.padEnd(26)} ${detail}`)
}

console.log(`lua require file-claim control — temp project ${TMP}`)
console.log(`  (the arbiter's facts are built from this project's admitted .lua list, exactly as the gate builds them)\n`)

const FACTS = (() => {
  const files = new Set<string>()
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (e.isFile() && e.name.endsWith(".lua")) files.add(path.relative(TMP, abs).split(path.sep).join("/"))
    }
  }
  walk(TMP)
  return { packages: new Set<string>(), files, sdkLib: false }
})()

const armVerify = (arm: string, target: string, claim: string | undefined, expect: string | null): void => {
  if (expect === null) {
    check(arm, claim === undefined, `no claim written for \`${target}\` (got ${claim ?? "none"})`)
    return
  }
  if (claim !== expect) {
    check(arm, false, `expected claim \`${expect}\` for \`${target}\`, got ${claim ?? "none"}`)
    return
  }
  // THE ARBITER'S OWN ARM: the claim must VERIFY against the project's admitted list. A claim that
  // is written but refuted is a false statement the graph would make, and `extFAIL` must stay 0.
  const verdict = verifyFileClaim(FACTS as any, [claim])
  check(arm, verdict === "externalVerified", `claim \`${claim}\` for \`${target}\` -> arbiter ${verdict}`)
}

// 1 plain
{
  const c = await analyzeClaim("a.lua", 'local m = require("mod.sub")\n', true)
  armVerify("1 plain module", "mod.sub", c.get("mod.sub"), "mod/sub.lua")
}
// 2 init
{
  const c = await analyzeClaim("a.lua", 'local p = require("pkg")\n', true)
  armVerify("2 package init", "pkg", c.get("pkg"), "pkg/init.lua")
}
// 3 luaRoot (Neovim runtimepath)
{
  const c = await analyzeClaim("plug/lua/foo/baz.lua", 'local b = require("foo.bar")\n', true)
  armVerify("3 lua/ module root", "foo.bar", c.get("foo.bar"), "plug/lua/foo/bar.lua")
}
// 4 fileDir (busted spec dir)
{
  const c = await analyzeClaim("spec/x_spec.lua", 'local h = require("helpers")\n', true)
  armVerify("4 spec dir", "helpers", c.get("helpers"), "spec/helpers.lua")
}
// 5 absent
{
  const c = await analyzeClaim("a.lua", 'local n = require("nowhere.module")\n', true)
  armVerify("5 absent module", "nowhere.module", c.get("nowhere.module"), null)
}
// 6 no root
{
  const c = await analyzeClaim("a.lua", 'local m = require("mod.sub")\n', false)
  armVerify("6 no projectRoot", "mod.sub", c.get("mod.sub"), null)
}
// 7 escape
{
  const c = await analyzeClaim("a.lua", 'local e = require("../../etc/passwd")\n', true)
  armVerify("7 escaping target", "../../etc/passwd", c.get("../../etc/passwd"), null)
}
// 8 a directory with files is not a module FILE
{
  const c = await analyzeClaim("a.lua", 'local t = require("tree")\n', true)
  armVerify("8 directory, no file", "tree", c.get("tree"), null)
}
// 9 the claim is ADDITIVE: the target is unchanged and the edge still exists
{
  const c = await analyzeClaim("a.lua", 'local m = require("mod.sub")\n', true)
  check("9 target unchanged", c.has("mod.sub"), `edge target still \`mod.sub\` (keys: ${[...c.keys()].join(", ")})`)
}
// 10 pcall(require, ...) takes the same path (the analyzer's second require site)
{
  const c = await analyzeClaim("a.lua", 'local ok, m = pcall(require, "mod.sub")\n', true)
  armVerify("10 pcall(require,..)", "mod.sub", c.get("mod.sub"), "mod/sub.lua")
}

console.log(`\n${fail === 0 ? "ALL ARMS PASS" : `${fail} ARM(S) FAILED`} — 10 arms, temp project ${TMP}`)
process.exit(fail === 0 ? 0 : 1)
