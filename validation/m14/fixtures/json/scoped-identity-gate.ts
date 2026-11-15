/**
 * DOCUMENT IDENTITY IS PROJECT-SCOPED — the json lane's half of the basename collision.
 *
 * ## The defect this pins
 *
 * `documentName()` named a document by its filesystem BASENAME. Every `package.json` in a project
 * therefore published a module symbol named `package`, and every qualified path beneath it
 * inherited the collision — so the `contains` edge asserting that `package` owns `dependencies`
 * could not be walked in either direction. Measured over a 601-file stride of the corpus
 * (`validation/m14/measurements/json-ambiguity-split-601-after.json`): 90 colliding target names
 * across 1,218 collision symbols, of which the `package.*` family is the bucket that file scoping
 * resolves on its own.
 *
 * ## Why this file exists at all, when 32 fixtures already pass
 *
 * Because 17 passing fixtures prove the change broke nothing, which is not the same claim. The
 * scoped path is reachable ONLY when a caller supplies `AnalyzeContext.projectRoot`, and
 * `script/m14/run-fixtures.ts` builds its `analyzeContext` from `overrideCompanion` /
 * `overrideCompanionVisibility` / `subIndex.typeMembers` — it NEVER sets `projectRoot`. So no
 * fixture on that runner can see this behaviour, and the whole scoped-identity rule would
 * otherwise be shipped with zero coverage. That is the same blind spot php hit, where every one of
 * its 26 fixtures stopped one layer above the projection rule they were supposed to police; the
 * answer there was a gate that imports the production `parseFile`, and this is that answer here.
 *
 * ## How this can FAIL, which a test that cannot is not a test
 *
 * Section A parses two same-named files in different directories WITH a root and requires the two
 * module symbols to be distinct. Section B parses the SAME two files with NO root and requires
 * them to COLLIDE. Neither section is meaningful alone: A alone would also pass if the analyzer
 * invented a unique name per call, and B alone would pass if the analyzer had simply stopped
 * publishing a basename. Together they pin the mechanism — the collision is real, the scope is
 * what removes it, and it is the CALLER'S PROJECT ROOT and nothing else that removes it.
 *
 * Run on the production path (`ASTEngine.parseFile`), not `analyzer.analyze()` directly, so the
 * context plumbing under test is the one the indexer uses.
 *
 * Usage: npx tsx validation/m14/fixtures/json/scoped-identity-gate.ts
 * Exit 0 = every assertion held. Exit 1 = one did not, with the offending section named.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"

const failures: string[] = []
const check = (ok: boolean, what: string, detail: string): void => {
  if (ok) console.log(`  ok    ${what}`)
  else {
    console.log(`  FAIL  ${what} — ${detail}`)
    failures.push(what)
  }
}

/** The module symbol a parse published for the document itself. */
function moduleNameOf(res: ASTEngine.ParseResult): string | undefined {
  return res.symbols.find((s: any) => s.kind === "module")?.name
}

/** The qualified path every member of the document hangs off. */
function containsTargetsFrom(res: ASTEngine.ParseResult): string[] {
  return res.relationships.filter((r: any) => r.type === "contains").map((r: any) => r.target)
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "json-scoped-identity-"))
// Two `package.json` files in DIFFERENT directories: the collision is only real across files, so a
// single-directory fixture would pass without the fix and prove nothing.
const left = path.join(tmp, "repo", "packages", "left", "package.json")
const right = path.join(tmp, "repo", "packages", "right", "package.json")
const CONTENT = JSON.stringify({ name: "left-pkg", version: "1.0.0", dependencies: { lodash: "^4.0.0" } }, null, 2)
for (const f of [left, right]) {
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, CONTENT, "utf8")
}
const ROOT = path.join(tmp, "repo")

try {
  console.log("A. WITH a project root — the scope must separate two same-named documents")
  const a = await ASTEngine.parseFile(left, CONTENT, { projectRoot: ROOT } as any)
  const b = await ASTEngine.parseFile(right, CONTENT, { projectRoot: ROOT } as any)
  const an = moduleNameOf(a)
  const bn = moduleNameOf(b)

  console.log(`     left  module = ${JSON.stringify(an)}`)
  console.log(`     right module = ${JSON.stringify(bn)}`)

  check(an !== undefined && bn !== undefined, "both documents publish a module symbol", `${an} / ${bn}`)
  check(an !== bn, "the two module symbols are DISTINCT under one root", `both are ${JSON.stringify(an)}`)

  // The collision that matters is not the module name alone: every `contains` target below it
  // inherits it. `…left.package.dependencies` and `…right.package.dependencies` must not both
  // answer to `package.dependencies`.
  const aTargets = containsTargetsFrom(a)
  const bTargets = containsTargetsFrom(b)
  const shared = aTargets.filter((t) => bTargets.includes(t))
  console.log(`     left  contains targets: ${JSON.stringify(aTargets)}`)
  console.log(`     right contains targets: ${JSON.stringify(bTargets)}`)
  check(shared.length === 0, "no `contains` target is shared by the two documents", `shared: ${JSON.stringify(shared)}`)

  // Basename LAST is a promise about the store's leaf matching, so assert the shape rather than
  // the uniqueness: the scope is a prefix and the stem is still the final segment.
  check(
    typeof an === "string" && an.endsWith("package") && an !== "package",
    "the basename is still the LAST segment, under a scope prefix",
    `module = ${JSON.stringify(an)}`,
  )
  check(
    typeof an === "string" && an.startsWith("packages.left."),
    "the scope is the project-relative directory chain",
    `module = ${JSON.stringify(an)}`,
  )

  console.log("\nB. WITHOUT a project root — the fallback must still be the bare basename")
  const c = await ASTEngine.parseFile(left, CONTENT)
  const d = await ASTEngine.parseFile(right, CONTENT)
  const cn = moduleNameOf(c)
  const dn = moduleNameOf(d)
  console.log(`     left  module = ${JSON.stringify(cn)}   right module = ${JSON.stringify(dn)}`)
  // This is the collision the whole change exists to remove, asserted so it cannot be "fixed" by
  // deleting the basename identity instead of scoping it.
  check(cn === "package" && dn === "package", "no root means both documents are `package`", `${cn} / ${dn}`)

  console.log("\nC. A file AT the project root has no directory to scope by")
  const topPath = path.join(ROOT, "package.json")
  writeFileSync(topPath, CONTENT, "utf8")
  const e = await ASTEngine.parseFile(topPath, CONTENT, { projectRoot: ROOT } as any)
  const en = moduleNameOf(e)
  console.log(`     top   module = ${JSON.stringify(en)}`)
  check(en === "package", "a root-level file keeps its bare stem, not a leading dot", `module = ${JSON.stringify(en)}`)

  console.log("\nD. A root the file does not sit under must NOT be guessed at")
  const f = await ASTEngine.parseFile(left, CONTENT, { projectRoot: "/somewhere/else" } as any)
  const fn = moduleNameOf(f)
  console.log(`     left  module = ${JSON.stringify(fn)}`)
  check(fn === "package", "an unrelated root falls back rather than inventing a scope", `module = ${JSON.stringify(fn)}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log("")
if (failures.length > 0) {
  console.log(`scoped-identity gate: FAIL — ${failures.length} assertion(s) did not hold`)
  process.exit(1)
}
console.log("scoped-identity gate: PASS")