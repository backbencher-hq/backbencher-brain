/**
 * JAVA LANE MUTANTS — prove the fixtures can fail.
 *
 * ## WHY A LANE-LOCAL RUNNER
 *
 * `script/m14/mutate-analyzer.ts` is MASTER-owned shared machinery and this lane
 * does not modify it. The lane's own concern is narrower than what the shared
 * runner does: given a mutation IN `src/ast/real-java-analyzer.ts`, does the
 * java fixture lane go red? So this runner does exactly that and nothing else —
 * it rewrites one line of the analyzer, runs the java fixtures, records whether
 * the lane failed, and restores the file.
 *
 * ## WHAT COUNTS AS A DEATH, AND WHAT DOES NOT
 *
 * A mutant is DEAD when `run-fixtures.ts --lang java` reports a FAIL that the
 * clean tree does not report. It is ALIVE when the lane's failure set is
 * unchanged — which is a finding, not a note, because a fixture that cannot fail
 * is decoration.
 *
 * A mutant that produces the same OUTPUT on every input is EQUIVALENT, and is
 * recorded as equivalent rather than counted as a kill. Claiming a kill for an
 * equivalent mutant is the dishonesty contract's lie-catcher #3 firing in the
 * direction that flatters the lane.
 *
 * ## THE BASELINE IS MEASURED, NOT ASSUMED
 *
 * The clean lane's failure set is captured in this process before any mutation,
 * so "unchanged" means "unchanged against this commit's real baseline" rather than
 * against a number copied from a commit message. At the commit this was written
 * the java lane is 48 pass / 5 fail, and those 5 failures are pre-existing.
 *
 * ## NO REGEX
 *
 * Mutation is an exact string replacement found by character scan; file walking
 * is `readdirSync` with an `endsWith` test. No regular expression appears here.
 *
 * ## USAGE (from the lane worktree root)
 *   bun script/m14/lanes/java-mutants.ts
 *   LANE_MUTANTS=I1,I2 bun script/m14/lanes/java-mutants.ts
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = process.cwd()
const ANALYZER = join(ROOT, "src", "ast", "real-java-analyzer.ts")
const FIXTURES = join(ROOT, "validation", "m14", "fixtures", "java")
const KEEP = process.env.LANE_KEEP_BASELINE === "1"

type Mutant = {
  id: string
  what: string
  /**
   * EQUIVALENT mutants are recorded as equivalent, not counted as kills.
   *
   * Two of this lane's mutants (I3, I8) restore a TEXT search for the import
   * flags in place of the node-type read, and no fixture can distinguish them:
   * measured over every one of java-lib's 38,923 `import_declaration` nodes
   * (script/m14/lanes/java-import-flag-equivalence.ts), the two implementations
   * DISAGREE on 0 of them, across both shapes the corpus contains
   * (27,951 plain, 10,972 static, 0 wildcard). `import_declaration` is a Java
   * grammar production with no room for a comment or a string literal, so a
   * search over the node's own text is bounded exactly as the tree is.
   *
   * Claiming a kill for either would be the honesty contract's lie-catcher #3
   * firing in the direction that flatters the lane. They are kept in the suite as
   * documentation of why the node-type read is preferred — it is what survives a
   * grammar change, and the equivalence is measured rather than assumed.
   */
  equivalent?: string
  /** Exact old text. Absent from the file means the mutation site moved — which is
   *  itself a finding, so it is reported rather than silently skipped. */
  find: string
  replace: string
}

const MUTANTS: Mutant[] = [
  // ---- the `imports` DEPENDENCY edge this lane just added
  {
    id: "I1",
    what: "delete the `imports` relationship emitted for an import_declaration (revert to `references` only)",
    find: `            type: ASTEngine.RelationshipType.Imports,
            confidence: 1.0,
            ...this.lineField(this.findChildByType(node, "scoped_identifier") || this.findChildByType(node, "identifier"), node),`,
    replace: `            type: ASTEngine.RelationshipType.References,
            confidence: 1.0,
            ...this.lineField(this.findChildByType(node, "scoped_identifier") || this.findChildByType(node, "identifier"), node),`,
  },
  {
    id: "I2",
    what: "drop metadata.fileLevel — the ONE flag that gives the row the storage shape bb_graph's dependencies query requires",
    find: `              isStatic,
              fileLevel: true,
            },
          })
        }
      }`,
    replace: `              isStatic,
            },
          })
        }
      }`,
  },
  {
    id: "I3",
    equivalent: "measured: 0 disagreements over 38,923 corpus import declarations (java-import-flag-equivalence.ts)",
    what: "read `isStatic` from the declaration's TEXT again instead of the `static` node type",
    find: `        let isStatic = false
        let isAsterisk = false
        for (let k = 0; k < node.childCount; k++) {
          const kid = node.child(k)
          if (!kid) continue
          if (kid.type === "static") isStatic = true
          else if (kid.type === "asterisk") isAsterisk = true
        }`,
    replace: `        const __importText = node.text
        const isStatic = __importText.indexOf("static ") !== -1
        const isAsterisk = __importText.indexOf(".*") !== -1`,
  },
  {
    id: "I4",
    what: "label a type-on-demand import as single_type — the two JLS forms become indistinguishable",
    find: `              relationshipType: isStatic ? "static_member_import" : isAsterisk ? "type_on_demand_import" : "single_type_import",`,
    replace: `              relationshipType: isStatic ? "static_member_import" : "single_type_import",`,
  },
  {
    id: "I5",
    what: "emit `imports` at 0.9 (the `references` tier) instead of 1.0 — a written declaration downgraded to a heuristic",
    find: `            type: ASTEngine.RelationshipType.Imports,
            confidence: 1.0,`,
    replace: `            type: ASTEngine.RelationshipType.Imports,
            confidence: 0.9,`,
  },
  {
    // RE-POINTED (M60 java fold). This mutant used to disable
    // `pushModuleDirective`'s `role === "requires_module"` arm. That arm is gone:
    // the JPMS dependency edge now comes from emitJavaModuleDeclaration, which is
    // the only place that can read the `requires_modifier` that decides
    // transitive-vs-static, so the old guard's site no longer exists and the
    // intent is re-expressed at the surviving one. (The old arm also produced a
    // SECOND `imports` row per `requires` directive, labeled
    // `module_requires_dependency`, disagreeing with the other one about the
    // modifier — see the analyzer's note where the arm was.)
    id: "I6",
    what: "drop the JPMS `requires` MODULE DEPENDENCY edge (`imports`), keeping only the `references` mention",
    find: `          type: ASTEngine.RelationshipType.Imports,
          // 0.9 for \`requires static\`: the module is OPTIONAL at compile time and`,
    replace: `          type: ASTEngine.RelationshipType.References,
          // 0.9 for \`requires static\`: the module is OPTIONAL at compile time and`,
  },
  {
    // This mutant's ancestor FOUND a dead branch. `pushModuleDirective`'s guard
    // was first written against a role name the directive table never produces
    // (`module_requires_module` instead of `requires_module`), so it matched
    // nothing and the JPMS dependency edge was never emitted — while the firing
    // check still counted the function as covered because the `references` branch
    // beside it fires on every module-info file. Re-pointing the guard at a role
    // the corpus DOES produce produced byte-identical output, which is the
    // signature of a predicate that cannot match.
    //
    // RE-POINTED (M60 java fold) at the same class of defect in the surviving
    // implementation: the `requires_modifier` is now read by its OWN TEXT
    // (`transitive` vs `static`), and a comparison that can never be true is again
    // the way this comes back — the two tokens arrive as the SAME node type, so
    // only the string distinguishes them and nothing else in the lane can notice
    // if the string is wrong.
    id: "I7",
    what: "compare the JPMS `requires_modifier` against a token the grammar never writes — the dead-branch shape, re-introduced on purpose",
    find: `            if (c.text.trim() === "transitive") transitive = true`,
    replace: `            if (c.text.trim() === "transitively") transitive = true`,
  },
  {
    id: "I8",
    equivalent: "measured: 0 disagreements over 38,923 corpus import declarations (java-import-flag-equivalence.ts)",
    what: "read isAsterisk/isStatic from child TEXT as well as node type, so a target whose name contains `static ` or `.*` sets a flag no import writes",
    find: `          if (kid.type === "static") isStatic = true
          else if (kid.type === "asterisk") isAsterisk = true`,
    replace: `          if (kid.type === "static" || kid.text.indexOf("static") === 0) isStatic = true
          else if (kid.type === "asterisk" || kid.text.indexOf(".*") !== -1) isAsterisk = true`,
  },
  // ---- the `exports` surface this lane closed earlier
  {
    id: "E1",
    what: "flatten the exports confidence tier to a flat 1.0 — package-private top-level types published as importable",
    find: `          confidence: isPublic ? 1.0 : 0.6,`,
    replace: `          confidence: 1.0,`,
  },
  {
    id: "E2",
    what: "drop the reasonCode the honesty contract requires of any sub-1.0 edge",
    find: `            ...(isPublic ? {} : { reasonCode: "package_private_top_level_type" }),`,
    replace: ``,
  },
  {
    id: "I9",
    what: "let `imports` fall through to the catch-all evidenceClass — the tier for a call inferred from a use site, applied to a written dependency",
    find: `      if (t === "imports") { md.evidenceClass = "import_based"; continue }`,
    replace: `      if (t === "imports") { md.evidenceClass = "usage_contextual"; continue }`,
  },
  {
    id: "E4",
    what: "the export-set guard tests the grammar node type but NOT `!ownerName` — every NESTED type is published (measured +185 edges at 300 corpus files)",
    find: `      if (!s.metadata?.isPhantom && !s.ownerName && isTopLevelTypeDecl) {`,
    replace: `      if (!s.metadata?.isPhantom && isTopLevelTypeDecl) {`,
  },
  {
    id: "E5",
    // SURVIVES, and the reason is recorded rather than papered over. This mutant
    // restores the defect that produced 14 fabricated `exports` edges on the
    // corpus — and no fixture can kill it, because triggering the underlying
    // cause needs a scope-stack imbalance this lane could not reduce to a
    // minimal input. Measured: 60 symbols corpus-wide (2 files of 3,275) carry
    // no ownerName while not being a top-level type declaration, every one a
    // `method_declaration`.
    //
    // What was tried to reduce it, so the next agent does not repeat it: a
    // 400-line prefix sweep (orphans appear at 200 lines, vanish at 400, return
    // at 1,400 — truncation-dependent, so not a shape); a volume sweep to 200
    // methods per class with and without javadoc and annotations (0 orphans at
    // every size); ten method-body shapes including nested braces, lambdas,
    // anonymous classes, casts, ternaries and qualified static calls (0 orphans
    // on all ten); and a 49-member window bisect, where emptying any window moved
    // the count in BOTH directions (59, 42, 0, 15 against a baseline of 30) and
    // no single member reproduced it. Bidirectional movement under deletion is
    // the signature of an unbalanced push/pop in the walk's scope stack rather
    // than one malformed node, and it is a pre-existing attribution defect that
    // also reaches `contains` and `overrides` — wider than this lane's mandate.
    //
    // The defect stays COUNTED instead: java-ontology-census.ts reports
    // owner-less non-type symbols on every run, so it cannot go quiet, and the
    // export surface is no longer derived from the attribute it corrupts.
    what: "the export-set guard tests `!ownerName` but NOT the node type — every MEMBER whose owner was lost is published (measured +14 fabricated exports edges over the corpus)",
    find: `      if (!s.metadata?.isPhantom && !s.ownerName && isTopLevelTypeDecl) {`,
    replace: `      if (!s.metadata?.isPhantom && !s.ownerName) {`,
  },
  {
    id: "E3",
    what: "publish the 0.6 package-private tier as `uses` instead of `exports` — a mislabelling the pins cannot see",
    find: `          type: ASTEngine.RelationshipType.Exports,
          confidence: isPublic ? 1.0 : 0.6,`,
    replace: `          type: ASTEngine.RelationshipType.Uses,
          confidence: isPublic ? 1.0 : 0.6,`,
  },
  // ---- the M60 java FOLD: ctor identity, declaration lines, the file-level
  // import source, and the JPMS surface. One mutant per ruling, each aimed at the
  // assertion that would go quiet if the ruling were reverted.
  {
    id: "J1",
    what: "name a constructor with the literal `constructor` again instead of its class name — three fixtures pin the class name (M37.21 C3)",
    find: `          const memberName = isConstructor ? (parentContext?.name ?? name) : name`,
    replace: `          const memberName = isConstructor ? "constructor" : name`,
  },
  {
    id: "J2",
    what: "anchor a symbol's range at the raw declaration NODE again — the annotation line, which is what java/declaration-lines-825 exists to kill",
    find: `    const decl = this.declarationLineNode(node)
    const base = this.nodeToRange(node)`,
    replace: `    const decl = node
    const base = this.nodeToRange(node)`,
  },
  {
    id: "J3",
    what: "let the primary-type rewrite re-source the FILE-LEVEL import dependency too — the row then binds to a symbol and stops answering bb_graph's per-file query",
    find: `        const isFileLevel = (rel.metadata ?? {}).fileLevel === true`,
    replace: `        const isFileLevel = false`,
  },
  {
    id: "J4",
    what: "label the JPMS exported-package mention with the pre-fold spelling (`module_exports_package`) — the vocabulary the fold retired",
    find: `              relationshipType: "module_exports_mention",`,
    replace: `              relationshipType: "module_exports_package",`,
  },
  {
    id: "J5",
    what: "publish `requires static` at 1.0 like a plain `requires` — an OPTIONAL compile-time dependency claimed as unconditional",
    find: `          confidence: isStatic ? 0.9 : 1.0,`,
    replace: `          confidence: 1.0,`,
  },
  {
    id: "J6",
    what: "exclude the module symbol from `exports[]` again — java/module-exports-jpms pins it there with `kind: module`",
    find: `        exportNodeType === "module_declaration"`,
    replace: `        false`,
  },
  {
    id: "J7",
    what: "flatten the JPMS `requires` importType — `requires transitive` becomes indistinguishable from a plain `requires` on the ImportInfo channel",
    find: `          importType: transitive ? "java-module-requires-transitive" : "java-module-requires",`,
    replace: `          importType: "java-module-requires",`,
  },
]

function readBaseline(): { pass: number; fail: number; failed: string[] } {
  const out = execFileSync("bun", ["script/m14/run-fixtures.ts", "--lang", "java"], {
    cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024,
  })
  const failed: string[] = []
  for (const line of out.split("\n")) {
    if (!line.startsWith("FAIL  java/")) continue
    failed.push(line.slice("FAIL  java/".length).trim())
  }
  return { pass: readCount(out, "pass"), fail: readCount(out, "fail"), failed }
}

/**
 * Read `summary: {"java":{"pass":N,"fail":M}}` by CHARACTER WALK.
 *
 * This was a regular expression — `/"java":\{"pass":(\d+),"fail":(\d+)\}/` — and
 * it is the only regex this lane has ever written into its own code, so it is
 * worth saying why it went: the pattern was convenient and nothing about it was
 * wrong, which is the worst reason to keep one. The workstream's rule is no regex
 * anywhere in a lane's instruments, and a scanner that can itself be defeated by
 * a reformat of the harness's output line is a scanner whose "no failures" answer
 * means less than it appears to.
 *
 * The replacement finds the literal marker, then walks forward collecting digits
 * until it hits a non-digit. If the marker is absent the answer is -1, which is a
 * visible "I did not find it" rather than a silent 0.
 */
function readCount(text: string, which: "pass" | "fail"): number {
  const marker = `"${which}":`
  const at = text.indexOf(marker)
  if (at < 0) return -1
  let i = at + marker.length
  let digits = ""
  while (i < text.length) {
    const c = text[i]
    const isDigit = c >= "0" && c <= "9"
    if (!isDigit) break
    digits += c
    i++
  }
  return digits.length ? Number(digits) : -1
}

function fixtureCount(): { total: number; expectations: number } {
  const ents = readdirSync(FIXTURES)
  return {
    total: ents.filter((n) => n.endsWith(".java")).length,
    expectations: ents.filter((n) => n.endsWith(".expectation.json")).length,
  }
}

const original = readFileSync(ANALYZER, "utf8")
const counts = fixtureCount()
console.log(`JAVA LANE MUTANTS (EXPORTS_JAVA2)`)
console.log(`analyzer: src/ast/real-java-analyzer.ts (${original.length} bytes)`)
console.log(`fixtures: ${counts.expectations} expectation files over ${counts.total} .java inputs (derived by readdir)\n`)

let base: { pass: number; fail: number; failed: string[] }
try {
  base = readBaseline()
} catch (e) {
  console.error(`could not run the clean baseline: ${String(e).slice(0, 200)}`)
  process.exit(2)
}
console.log(`BASELINE (clean tree): ${base.pass} pass / ${base.fail} fail`)
console.log(`  pre-existing failures: ${base.failed.join(", ") || "(none)"}\n`)

const wanted = process.env.LANE_MUTANTS
  ? process.env.LANE_MUTANTS.split(",").map((s) => s.trim()).filter(Boolean)
  : null
const run = wanted ? MUTANTS.filter((m) => wanted.includes(m.id)) : MUTANTS

const rows: Array<{ id: string; verdict: string; detail: string }> = []
for (const m of run) {
  if (!original.includes(m.find)) {
    rows.push({ id: m.id, verdict: "SITE-MOVED", detail: "the exact text to mutate is not in the file — the site changed and this mutant no longer tests what it claims" })
    continue
  }
  writeFileSync(ANALYZER, original.split(m.find).join(m.replace))
  let res: { pass: number; fail: number; failed: string[] }
  try {
    res = readBaseline()
  } catch (e) {
    rows.push({ id: m.id, verdict: "DIED-LOUDLY", detail: `the lane did not finish the run: ${String(e).split("\n")[0].slice(0, 120)}` })
    writeFileSync(ANALYZER, original)
    continue
  }
  writeFileSync(ANALYZER, original)
  const newlyFailing = res.failed.filter((f) => !base.failed.includes(f))
  const newlyPassing = base.failed.filter((f) => !res.failed.includes(f))
  if (newlyFailing.length > 0) {
    rows.push({ id: m.id, verdict: "DEAD", detail: `new FAIL: ${newlyFailing.join(", ")}` })
  } else if (m.equivalent) {
    // Recorded as equivalent, not as a kill, and not as an unpinned behaviour.
    // Both of those would be false: the corpus measurement says the two
    // implementations agree on every declaration the corpus contains.
    rows.push({ id: m.id, verdict: "EQUIVALENT", detail: `no fixture can distinguish it, and none should pretend to — ${m.equivalent}` })
  } else if (newlyPassing.length > 0) {
    rows.push({ id: m.id, verdict: "SURVIVED-BUT-LOUDLY-DIFFERENT", detail: `a previously failing fixture now passes: ${newlyPassing.join(", ")}` })
  } else {
    rows.push({ id: m.id, verdict: "SURVIVED", detail: `${res.pass} pass / ${res.fail} fail — identical to the clean baseline` })
  }
}

console.log(`id   verdict                          what`)
console.log("-".repeat(150))
for (const r of rows) {
  const m = MUTANTS.find((x) => x.id === r.id)
  console.log(`${r.id.padEnd(5)} ${r.verdict.padEnd(32)} ${(m?.what ?? "").slice(0, 80)}`)
  console.log(`${" ".repeat(5)} ${" ".repeat(32)} -> ${r.detail}`)
}

const dead = rows.filter((r) => r.verdict === "DEAD" || r.verdict === "DIED-LOUDLY").length
const equiv = rows.filter((r) => r.verdict === "EQUIVALENT").length
const survived = rows.filter((r) => r.verdict === "SURVIVED" || r.verdict === "SURVIVED-BUT-LOUDLY-DIFFERENT").length
const moved = rows.filter((r) => r.verdict === "SITE-MOVED").length
console.log(`\n${dead} dead · ${equiv} equivalent · ${survived} survived · ${moved} site-moved · ${rows.length} total`)
if (equiv > 0) console.log(`EQUIVALENT mutants are recorded, not counted as kills. Their equivalence is measured, not assumed.`)
if (survived > 0) console.log(`SURVIVORS ARE FINDINGS: each one is a behaviour the java fixtures do not pin.`)
if (moved > 0) console.log(`SITE-MOVED mutants no longer test what they claim. Re-point them or retire them.`)
writeFileSync(ANALYZER, original)
process.exit(survived > 0 || moved > 0 ? 1 : 0)
