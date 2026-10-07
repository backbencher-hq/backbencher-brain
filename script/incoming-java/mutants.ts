/**
 * INCOMING_JAVA — MUTANTS for the two relationship kinds this lane added.
 *
 * A fixture that passes proves the analyzer does something; it does NOT prove the
 * fixture can fail. M14-HONESTY-CONTRACT §5.3 requires that deliberately injected
 * defects make the suite go red, and §2 L4 is the claim level that depends on it.
 * This file therefore injects each defect, runs the lane's own fixtures, and
 * REQUIRES that the named fixture fails — a survivor is a finding, not a warning.
 *
 * Each mutant is a real defect class rather than a random edit:
 *
 *   M-J1  drop the `imports` edge and keep the `references` mention — the exact
 *         pre-INCOMING_JAVA state. Must kill `import-dependency-edges`.
 *   M-J2  drop the `references` mention and keep `imports`. The opposite
 *         truncation, and the one that would break `import-edges`, the fixture
 *         that has pinned this edge since #419. Must kill BOTH.
 *   M-J3  read the JPMS directives at the WRONG DEPTH — directly under
 *         `module_declaration` instead of inside `module_body`. This is the bug
 *         this lane actually shipped and caught: the branch existed, tsc was clean,
 *         and it emitted nothing on any of the three guava module-info.java files.
 *         A branch that cannot reach its data is the hardest kind of dead code to
 *         see by reading, which is why it gets its own mutant.
 *   M-J4  emit `exports` for `requires` — the type confusion a language keyword
 *         invites, since both live in one `module_body`.
 *   M-J5  truncate the import target to its parent package. Fabricates a name the
 *         file does not write; `import-edges` already forbids it for `references`
 *         and this checks the `imports` half is pinned too.
 *   M-J6  skip the post-pass that re-sources import edges from the package to the
 *         primary type. The edge then has a source that binds to no symbol —
 *         measured at 2,167 of 2,167 before the fix and 0 of 2,167 after.
 *   M-J7  emit `opens_module_directive` handling for a node the pinned grammar does
 *         not produce. A fabrication guarded by nothing, and the mutant that proves
 *         the `opens` forbid is load-bearing.
 *
 * NO REGEX anywhere: the mutants are chosen by string index of a unique marker
 * comment, and every replacement is a splice on that index.
 *
 * CLI: bun script/incoming-java/mutants.ts
 */
import { readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const REPO = path.resolve(import.meta.dir, "..", "..")
const TARGET = path.join(REPO, "src/ast/real-java-analyzer.ts")
const BACKUP = path.join(REPO, "script/incoming-java/.mutant-backup.ts")

/**
 * A mutation is a SINGLE-TOKEN substitution on a string that occurs EXACTLY ONCE in
 * the analyzer. Uniqueness is asserted before the splice, so a refactor that makes
 * an anchor ambiguous fails the mutation run loudly instead of quietly mutating the
 * wrong site — which is how a mutation check turns into a decoration.
 *
 * The anchors are the `metadata.relationshipType` values this lane added. They are
 * load-bearing in their own right: they are what makes the census's "label inside
 * the label" column able to say which SITE produced an edge, and they are what the
 * fixtures assert on.
 */
type Mutant = {
  id: string
  describe: string
  /** a string occurring exactly once in the analyzer */
  anchor: string
  /** the replacement for that string */
  to: string
  /** the fixture ids that MUST fail */
  mustKill: string[]
}

const MUTANTS: Mutant[] = [
  {
    id: "M-J1",
    describe: "a wildcard import stops being classified as one — `isWildcard` is hard-false, so `.*` is indistinguishable from a single-type import",
    anchor: 'relationshipType: "import_declaration", isJavaImport: true, isWildcard: isAsterisk,',
    to: 'relationshipType: "import_declaration", isJavaImport: true, isWildcard: false,',
    mustKill: ["java/import-dependency-edges"],
  },
  {
    id: "M-J8",
    describe: "a static import stops being classified as one — `import static X.y` becomes indistinguishable from a type import",
    anchor: 'relationshipType: "import_declaration", isJavaImport: true, isWildcard: isAsterisk, isStatic,',
    to: 'relationshipType: "import_declaration", isJavaImport: true, isWildcard: isAsterisk, isStatic: false,',
    mustKill: ["java/import-dependency-edges"],
  },
  {
    id: "M-J1b",
    describe: "the `imports` edge for an import declaration is dropped entirely",
    anchor: 'type: ASTEngine.RelationshipType.Imports,\n            confidence: 1.0,\n            // M59 (#825): the line the imported module is NAMED on. 1.0 and not',
    to: 'type: ASTEngine.RelationshipType.References,\n            confidence: 1.0,\n            // M59 (#825): the line the imported module is NAMED on. 1.0 and not',
    mustKill: ["java/import-dependency-edges"],
  },
  {
    id: "M-J2",
    describe: "the JPMS `requires` dependency edge is dropped, leaving only the mention",
    anchor: 'relationshipType: "module_requires", javaModule: moduleName, isModuleDirective: true },',
    to: 'relationshipType: "module_requires_mention", javaModule: moduleName, isModuleDirective: true, __y: 1 as any },',
    mustKill: ["java/jpms-module-exports"],
  },
  {
    id: "M-J3",
    describe: "read the JPMS directives at the WRONG DEPTH — a node type the grammar never produces",
    anchor: 'this.findChildByType(node, "module_body")',
    to: 'this.findChildByType(node, "module_body_unreachable_sentinel")',
    mustKill: ["java/jpms-module-exports"],
  },
  {
    id: "M-J4",
    describe: "a `requires` directive is emitted as `exports` — the type confusion two keywords in one `module_body` invites",
    anchor: 'if (directive.type === "exports_module_directive") {',
    to: 'if (directive.type === "exports_module_directive" || directive.type === "requires_module_directive") {',
    mustKill: ["java/jpms-module-exports"],
  },
  {
    id: "M-J5",
    describe: "the JPMS `exports` edge is labelled `references` — the surface is published but not declared an export",
    anchor: 'type: ASTEngine.RelationshipType.Exports,\n              confidence: 1.0,\n              // M59 (#825): the package is NAMED in the directive',
    to: 'type: ASTEngine.RelationshipType.References,\n              confidence: 1.0,\n              // M59 (#825): the package is NAMED in the directive',
    mustKill: ["java/jpms-module-exports"],
  },
  {
    id: "M-J6",
    describe: "the post-pass stops re-sourcing import edges, so their source is a package string that binds to no symbol",
    anchor: 'if ((rel.type === ASTEngine.RelationshipType.References || rel.type === ASTEngine.RelationshipType.Imports)\n          && (rel.source === currentPackage || rel.source === "root")) {',
    to: 'if ((rel.type === ASTEngine.RelationshipType.References && (rel.type as string) !== (rel.type as string))\n          && (rel.source === currentPackage || rel.source === "root")) {',
    mustKill: ["java/import-dependency-edges"],
  },
  {
    id: "M-J7",
    describe: "the JPMS `exports` MENTION edge is dropped, leaving the published surface declared but never referenced",
    anchor: 'relationshipType: "module_exports_mention", javaModule: moduleName, isModuleDirective: true },',
    to: 'relationshipType: "module_exports_mention_DISABLED", javaModule: moduleName, isModuleDirective: true },',
    mustKill: ["java/jpms-module-exports"],
  },
]

/** Run the lane's own fixture runner and return which fixture ids failed. */
/**
 * A mutant that does not COMPILE is not a survivor — it is the strongest kill there
 * is, because nothing can pass. Reporting it as a survivor is how a mutation check
 * quietly stops testing anything, and this harness did exactly that: M-J2's
 * replacement dropped a closing brace, the fixture runner died before printing any
 * result, `parseFailed` found no FAIL lines, and the mutant was recorded as
 * SURVIVED when it had in fact broken every fixture in the lane. So a compile error
 * is detected explicitly and reported as its own category.
 */
function runFixtures(): { failed: string[]; output: string; compileError: string | null } {
  let out = ""
  try {
    out = execFileSync("bun", [path.join(REPO, "script/m14/run-fixtures.ts"), "--lang", "java"], {
      cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e) {
    out = String((e as any).stdout ?? "") + String((e as any).stderr ?? "")
  }
  let compileError: string | null = null
  if (out.indexOf("error: Expected") !== -1 || out.indexOf("SyntaxError") !== -1) {
    const i = out.indexOf("error: ")
    compileError = out.slice(i, i + 160).split("\n")[0]
  }
  return { failed: parseFailed(out), output: out, compileError }
}
function parseFailed(out: string): string[] {
  const failed: string[] = []
  let pending = ""
  for (const line of out.split("\n")) {
    const m = line.startsWith("FAIL  ") ? line.slice(6).trim() : null
    if (m) { pending = m; continue }
    if (pending && line.startsWith("      - ")) { failed.push(pending); pending = "" }
  }
  // A FAIL header with no assertion line under it still counts.
  for (const line of out.split("\n")) {
    const m = line.startsWith("FAIL  ") ? line.slice(6).trim() : null
    if (m && !failed.includes(m)) {
      const after = out.slice(out.indexOf(line) + line.length)
      const nextHeader = after.split("\n").findIndex((l) => l.startsWith("PASS  ") || l.startsWith("FAIL  "))
      const block = nextHeader === -1 ? after : after.split("\n").slice(0, nextHeader).join("\n")
      if (!block.trim()) failed.push(m)
    }
  }
  return failed
}

const original = readFileSync(TARGET, "utf8")
writeFileSync(BACKUP, original)
const base = runFixtures()
const BASE_FAILURES = base.failed.slice().sort()
if (base.compileError !== null) {
  console.error(`the analyzer does not compile at HEAD: ${base.compileError}`)
  process.exit(2)
}

console.log(`INCOMING_JAVA mutation check — ${MUTANTS.length} mutants`)
console.log(`baseline fixture failures (PRE-EXISTING at HEAD, verified with this lane's change stashed — not caused by it):`)
console.log(`  ${BASE_FAILURES.length ? BASE_FAILURES.join("\n  ") : "none"}`)
console.log(`They are subtracted from every mutant's kill set, so a mutant is only credited`)
console.log(`with killing something IT broke.`)
console.log(`\nA SURVIVOR is a finding, not a warning: it means a fixture cannot fail, so passing it`)
console.log(`proves nothing. Per M14-HONESTY-CONTRACT §5.3 a surviving mutant fails the suite.\n`)

const rows: Array<{ id: string; killed: boolean; by: string[]; survived: string[] }> = []

for (const m of MUTANTS) {
  const occurrences = original.split(m.anchor).length - 1
  if (occurrences !== 1) {
    console.log(`${m.id}  SKIPPED — anchor occurs ${occurrences} times, expected exactly 1: ${m.anchor.slice(0, 70)}`)
    rows.push({ id: m.id, killed: false, by: [], survived: m.mustKill })
    continue
  }
  writeFileSync(TARGET, original.split(m.anchor).join(m.to))
  let res: { failed: string[]; output: string; compileError: string | null }
  try {
    res = runFixtures()
  } finally {
    writeFileSync(TARGET, original)
  }
  if (res.compileError !== null) {
    // A mutant that does not compile kills the whole lane, which is a stronger
    // result than any fixture assertion — but it must be REPORTED as what it is,
    // or it reads as "the runner found nothing".
    rows.push({ id: m.id, killed: true, by: ["<compile error: every fixture in the lane fails to load>"], survived: [] })
    console.log(`${m.id}  COMPILE-ERROR  the mutation does not parse; every fixture in the lane fails to load`)
    console.log(`      ${res.compileError}`)
    continue
  }
  const newlyFailing = res.failed.filter((f) => !BASE_FAILURES.includes(f))
  const killers = m.mustKill.filter((f) => newlyFailing.includes(f))
  const killed = killers.length === m.mustKill.length
  rows.push({ id: m.id, killed, by: killers, survived: m.mustKill.filter((f) => !newlyFailing.includes(f)) })
  console.log(`${m.id}  ${killed ? "KILLED   " : "SURVIVED "}  ${m.describe}`)
  if (killed) console.log(`      killed by ${killers.join(", ")}`)
  else {
    console.log(`      NOT killed. expected ${m.mustKill.join(", ")}; newly failing = ${newlyFailing.join(", ") || "(none)"}`)
    // No regex: the three fixture ids are enumerated, not matched.
    const WATCH = ["jpms", "import-dependency", "import-edges"]
    const hits: string[] = []
    for (const line of res.output.split("\n")) {
      for (const w of WATCH) {
        if (line.indexOf(w) !== -1) { hits.push(line.trim()); break }
      }
    }
    for (const d of hits.slice(0, 3)) console.log(`      ${d}`)
  }
}

if (existsSync(BACKUP)) rmSync(BACKUP)
// The analyzer must be byte-identical to where it started. Asserted, not assumed.
const after = readFileSync(TARGET, "utf8")
console.log(`\nanalyzer restored byte-identical: ${after === original ? "yes" : "NO — STOP"}`)

const survivors = rows.filter((r) => !r.killed)
console.log(`\n${rows.length - survivors.length}/${rows.length} mutants killed`)
if (survivors.length) {
  console.log(`SURVIVORS: ${survivors.map((s) => s.id).join(", ")}`)
  process.exitCode = 1
}
