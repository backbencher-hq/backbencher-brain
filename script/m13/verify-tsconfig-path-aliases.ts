// script/m13/verify-tsconfig-path-aliases.ts
//
// THE PUBLIC-LAUNCH BLOCKER. `@/*` is the DEFAULT import alias in Next.js, Vite and
// Create React App — the most common TypeScript project shape in existence. Nothing in
// the indexer read `compilerOptions.paths`, and `resolveSpecifierPath` returned null for
// any specifier starting with `@` (it reads `@` as a package scope), so EVERY alias
// import was unresolved. Measured on a real Next.js app: 80 of 80 alias imports
// unresolved, 28 of 28 relative imports resolved — 74.1% of internal imports lost.
//
// On this repo's minimal fixture, before the fix:
//   src/app/page.ts → import { helper } from "@/lib/util"
//                    dependenciesTotal: 1, dependencies: []
//                    {'path': '@/lib/util', 'external': True, 'resolution': 'unresolved'}
//
// Two halves had to be fixed, and both are asserted here because fixing only one looked
// like success: the stored `brain_import.is_external` flag (or the import is filed as an
// npm package) and the dependency view's own specifier resolver (or it reports
// "unresolved" while the graph edge exists).

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const ROOT = path.resolve(import.meta.dirname, "../..")
const SCRATCH = path.join(ROOT, ".tools/ts-alias")
const DATA = path.join(SCRATCH, "data")
const SRC = path.join(SCRATCH, "app")

const { parseTsconfigPathAliases, applyPathAlias, applyPathAliasCandidates, loadProjectPathAliases } =
  await import("../../src/ast/path-aliases")

console.log("M13 tsconfig path aliases\n")

// ── parsing ──────────────────────────────────────────────────────────────────
{
  const rules = parseTsconfigPathAliases({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } })
  check("parses the Next.js default `@/*` -> `./src/*`", rules.length === 1 && rules[0].pattern === "@/*" && rules[0].targets[0] === "src/*", JSON.stringify(rules))
  check("normalises a `./` baseUrl without leaving `./` in the target", !rules[0].targets[0].startsWith("./"), rules[0].targets[0])
}
{
  const rules = parseTsconfigPathAliases({ compilerOptions: { baseUrl: "src", paths: { "~utils/*": ["utils/*"] } } })
  check("resolves a non-root baseUrl", rules[0]?.targets[0] === "src/utils/*", JSON.stringify(rules))
}
{
  const rules = parseTsconfigPathAliases({ compilerOptions: { paths: { "#/*": ["./*"] } } })
  check("a config with no baseUrl defaults to the project root", rules[0]?.targets[0] === "*", JSON.stringify(rules))
}
{
  check("a config with no paths yields no rules", parseTsconfigPathAliases({ compilerOptions: {} }).length === 0)
  check("a config with no compilerOptions yields no rules", parseTsconfigPathAliases({}).length === 0)
  check("a non-object config yields no rules", parseTsconfigPathAliases(null).length === 0)
  check("a non-string target is ignored, not guessed", parseTsconfigPathAliases({ compilerOptions: { paths: { "@/*": [42] } } }).length === 0)
}
{
  const rules = parseTsconfigPathAliases({ compilerOptions: { paths: { "@/*": ["./src/*"], "@app/*": ["./src/app/*"], "@app/db": ["./src/db"] } } })
  const hit = applyPathAlias("@app/db/client", rules)
  check("the LONGEST matching pattern wins", hit?.rule.pattern === "@app/*", String(hit?.rule.pattern))
  check("an exact (non-star) pattern matches only itself", applyPathAlias("@app/db", rules)?.resolved === "src/db", JSON.stringify(applyPathAlias("@app/db", rules)))
  check("an exact pattern does not match a child path", applyPathAlias("@app/db/client", rules)?.resolved !== "src/db")
}

// ── matching ─────────────────────────────────────────────────────────────────
{
  const rules = parseTsconfigPathAliases({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } })
  check("THE REPORTED DEFECT: `@/lib/util` resolves to a root-relative path", applyPathAlias("@/lib/util", rules)?.resolved === "src/lib/util", JSON.stringify(applyPathAlias("@/lib/util", rules)))
  check("candidates are produced for the caller to probe", applyPathAliasCandidates("@/lib/util", rules)[0] === "src/lib/util")
  check("The `@` alone is not treated as a package scope", applyPathAlias("@", rules) === null)
  check("a non-matching bare package is left alone", applyPathAlias("react", rules) === null)
  check("a relative specifier is not alias-resolved", applyPathAlias("./local", rules) === null)
}
{
  const rules = parseTsconfigPathAliases({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } })
  check("an empty rule list never matches", applyPathAlias("@/lib/util", []) === null)
}

// ── end to end: a real index ─────────────────────────────────────────────────
console.log("\n  end to end (a real index):")
rmSync(SCRATCH, { recursive: true, force: true })
mkdirSync(path.join(SRC, "src", "lib"), { recursive: true })
mkdirSync(path.join(SRC, "src", "app"), { recursive: true })
writeFileSync(path.join(SRC, "package.json"), '{"name":"ts-alias-e2e","version":"1.0.0"}\n')
writeFileSync(path.join(SRC, "tsconfig.json"), '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./src/*"]}}}\n')
writeFileSync(path.join(SRC, "src", "lib", "util.ts"), "export function helper(): number { return 42 }\n")
writeFileSync(path.join(SRC, "src", "app", "page.ts"), 'import { helper } from "@/lib/util"\nexport const value = helper()\n')

check("loadProjectPathAliases reads the project tsconfig", loadProjectPathAliases(SRC).length === 1)
check("loadProjectPathAliases returns [] for a project with no tsconfig", loadProjectPathAliases(path.join(SCRATCH, "nope")).length === 0)

process.env.BB_DATA_DIR = DATA
const { getProjectId } = await import("../../src/util/project-id")
const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")
const { getFileDependencies } = await import("../../src/intelligence/analysis/dependencies")
const projectId = getProjectId(SRC)
await indexProjectParallel(projectId, SRC, {})

const page = (await getFileDependencies(projectId as any, { filePath: "src/app/page.ts" })).find((r) => r.file === "src/app/page.ts")
check("the importing file is on the dependency page", !!page)
if (page) {
  const dep = page.dependencies.find((d) => d.path !== "")
  check("THE REPORTED DEFECT: the alias import is NOT marked external", dep?.external === false, JSON.stringify(dep))
  check("the alias import RESOLVES to the real file", dep?.resolution === "resolved", JSON.stringify(dep))
  check("it names the resolved PATH, not the raw specifier", dep?.path === "src/lib/util.ts", String(dep?.path))
}

// ── negative: a project with no tsconfig must not fabricate edges ────────────
{
  const PLAIN = path.join(SCRATCH, "plain")
  mkdirSync(path.join(PLAIN, "src"), { recursive: true })
  writeFileSync(path.join(PLAIN, "package.json"), '{"name":"plain","version":"1.0.0"}\n')
  writeFileSync(path.join(PLAIN, "src", "a.ts"), 'import { b } from "@/b"\nexport const x = b\n')
  writeFileSync(path.join(PLAIN, "src", "b.ts"), "export const b = 1\n")
  const plainId = getProjectId(PLAIN)
  await indexProjectParallel(plainId, PLAIN, {})
  const plainPage = (await getFileDependencies(plainId as any, { filePath: "src/a.ts" })).find((r) => r.file === "src/a.ts")
  const plainDep = plainPage?.dependencies[0]
  check("WITHOUT a tsconfig the alias stays unresolved (no invented edge)", plainDep?.resolution === "unresolved", JSON.stringify(plainDep))
}

rmSync(SCRATCH, { recursive: true, force: true })
// ── THE UPGRADE PATH: an EXISTING index must pick up aliases ────────────────
// Found by actually upgrading a 0.1.9 install: aliases were persisted only inside
// storeResults, which runs when files are (re)parsed. Upgrading and running `bb index` on an
// UNCHANGED project skips every file, so the aliases were never written and the fix did
// nothing — on the exact project a user upgrades. The stored `is_external` flag from the old
// run then kept the import marked external too.
{
  const UP = path.join(SCRATCH, "upgrade")
  mkdirSync(path.join(UP, "src", "lib"), { recursive: true })
  mkdirSync(path.join(UP, "src", "app"), { recursive: true })
  writeFileSync(path.join(UP, "package.json"), '{"name":"upgrade-shape","version":"1.0.0"}\n')
  writeFileSync(path.join(UP, "src", "lib", "util.ts"), "export function helper(): number { return 9 }\n")
  writeFileSync(path.join(UP, "src", "app", "page.ts"), 'import { helper } from "@/lib/util"\nexport const v = helper()\n')
  const upId = getProjectId(UP)
  await indexProjectParallel(upId, UP, {})
  const before = (await getFileDependencies(upId as any, { filePath: "src/app/page.ts" })).find((r) => r.file === "src/app/page.ts")
  check("before the tsconfig exists the alias is unresolved (the 0.1.9 shape)", before?.dependencies[0]?.resolution === "unresolved", JSON.stringify(before?.dependencies[0]))
  check("and the row is marked external (the stale flag)", before?.dependencies[0]?.external !== false, JSON.stringify(before?.dependencies[0]))

  writeFileSync(path.join(UP, "tsconfig.json"), '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./src/*"]}}}\n')
  await indexProjectParallel(upId, UP, {})
  const after = (await getFileDependencies(upId as any, { filePath: "src/app/page.ts" })).find((r) => r.file === "src/app/page.ts")
  check("THE UPGRADE DEFECT: a re-index with NO file changes picks up the alias", after?.dependencies[0]?.resolution === "resolved", JSON.stringify(after?.dependencies[0]))
  check("and the stale external flag no longer wins", after?.dependencies[0]?.external === false, JSON.stringify(after?.dependencies[0]))
  check("resolving to the real file", after?.dependencies[0]?.path === "src/lib/util.ts", String(after?.dependencies[0]?.path))
}

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "TS PATH ALIASES: PASS" : `TS PATH ALIASES: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
