/**
 * JVM RULINGS MUTANTS — prove that the kotlin and scala pins for the two
 * rulings the java/groovy folds settled CAN FAIL, in the lanes they were
 * written for.
 *
 * WHY THIS EXISTS, IN ONE SENTENCE. Four scala fixtures used to PIN THE LITERAL
 * `constructor` — `aux-ctor-is-not-a-symbol`, `enum-params`,
 * `m60-contains-owner-model` and `m60-val-pattern-is-a-name` — so the M60 scala
 * fold had to RE-PIN them, and a re-pin is only worth something if the new
 * spelling is the weaker claim and the fixture still goes red when the defect
 * comes back. "It failed before the fix" is evidence from one run in one
 * afternoon; this runner is the same evidence, re-runnable, and it is the half
 * the honesty contract calls a pin that can fail.
 *
 * WHY A LANE-LOCAL RUNNER. `script/m14/mutate-analyzer.ts` is MASTER-owned shared
 * machinery running RESULT-level transforms against the oracle comparison. These
 * four defects are SOURCE-level reverts (a name, and one deleted statement) whose
 * catch is the FIXTURE lane, not an oracle, so the question this answers is
 * narrower and different: given a mutation in `src/ast/real-<lang>-analyzer.ts`,
 * does that lane's fixture set go red? This runner does exactly that and nothing
 * else — it rewrites one exact string, runs the fixtures, records whether the
 * lane failed, and restores the file.
 *
 * WHAT COUNTS AS A DEATH, AND WHAT DOES NOT. A mutant is DEAD when the fixture
 * lane reports a FAIL the clean tree does not. ALIVE when the lane's failure set
 * is unchanged — a finding, not a note, because a fixture that cannot fail is
 * decoration. The baseline is CAPTURED IN THIS PROCESS before any mutation, so
 * "unchanged" means "unchanged against this tree's real baseline" rather than
 * against a number copied from a commit message.
 *
 * TRAP 13, FROM THIS FAMILY'S OWN HISTORY. A mutator that restores the wrong
 * file, or restores from git while the tree has uncommitted work, leaves a
 * mutated analyzer behind and prints a meaningless CLEAN. So: the analyzer path
 * is per-lane and explicit; the original bytes are held IN MEMORY and restored
 * from there (never from git); the content hash is printed before and after each
 * mutant; and a failed restore is reported as RESTORE-FAILED loudly instead of
 * being swallowed.
 *
 * NO REGEX. Mutation is an exact string replacement found by `indexOf`; the
 * summary line is read by character walk; file paths are literals.
 *
 * USAGE (from the repo root):
 *   bun script/m14/lanes/jvm-rulings-mutants.mts            # both lanes
 *   bun script/m14/lanes/jvm-rulings-mutants.mts scala      # one lane
 *   LANE_MUTANTS=S1,K1 bun script/m14/lanes/jvm-rulings-mutants.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

const ROOT = process.cwd()
const ONLY = (process.env.LANE_MUTANTS ?? "").split(",").map((s) => s.trim()).filter(Boolean)

type Edit = {
  /** Exact old text. Absent from the file means the mutation site moved — itself
   *  a finding, reported as SITE-MOVED rather than silently skipped. */
  find: string
  replace: string
}

type Mutant = {
  id: string
  /** The lane the catch must come from, and the file the mutation lands in. */
  lang: "kotlin" | "scala"
  /** The ruling this reverts. */
  ruling: "ctor-identity" | "name-anchoring" | "context-header" | "local-declaration" | "unit-identity" | "module-identity" | "clause-path" | "qmark" | "imports-source"
  what: string
  /** One or more exact-string edits, applied in order. A revert whose pre-fix
   *  state was TWO independent changes needs both, or it is not a faithful
   *  revert of anything — see S3/S4/S5 below, which is how that was found. */
  edits: Edit[]
  /** A mutant that no fixture (and no input) can distinguish from the folded
   *  code is recorded as EQUIVALENT, not counted as a kill and not reported as
   *  a survivor. Claiming a kill for it would be a lie in the lane's favour;
   *  calling it a survivor would claim the lane is unpinned when it is not.
   *  The equivalence claim itself has to be measured, and the reason goes here. */
  equivalent?: string
}

const MUTANTS: Mutant[] = [
  {
    id: "S1",
    lang: "scala",
    ruling: "ctor-identity",
    what: "scala class constructor back to the literal `constructor` (the retired spelling four fixtures used to ratify)",
    edits: [{
      find: `      const ctor = this.createSymbol(ownerName, ASTEngine.SymbolKind.Constructor, classParamsNode, idStub, {`,
      replace: `      const ctor = this.createSymbol("constructor", ASTEngine.SymbolKind.Constructor, classParamsNode, idStub, {`,
    }],
  },
  {
    id: "S2",
    lang: "scala",
    ruling: "ctor-identity",
    what: "scala ENUM constructor back to the literal `constructor` (the second emission site — handleEnum, not handleClass)",
    edits: [{
      find: `      const ctor = this.createSymbol(ownerName, ASTEngine.SymbolKind.Constructor, enumParamsNode, idStub, {`,
      replace: `      const ctor = this.createSymbol("constructor", ASTEngine.SymbolKind.Constructor, enumParamsNode, idStub, {`,
    }],
  },
  {
    id: "S3",
    lang: "scala",
    ruling: "name-anchoring",
    what: "scala: drop the NAME read, keep the modifier skip — HALF of the anchor fix, and the half that does nothing on its own",
    edits: [{
      find: `    const named = this.declarationNameNode(node)\n    if (named) return named\n`,
      replace: ``,
    }],
    equivalent:
      "HALF A of the fold, measured to be a no-op WITHOUT half B, so no fixture can or should distinguish it: the positional fallback also skips `opaque_modifier`/`inline_modifier` after the fold, and on the 18,965-file scala corpus every disagreement the name read fixes is one of those two node types. The corpus A/B attributes the 27 column moves to the pair, not to either half — and this mutant is the measurement that says so instead of an assumption.",
  },
  {
    id: "S4",
    lang: "scala",
    ruling: "name-anchoring",
    what: "scala: keep the NAME read, drop the modifier skip from the fallback — HALF B, likewise a no-op alone",
    edits: [{
      find: `      if (c.type === "opaque_modifier" || c.type === "inline_modifier") continue\n`,
      replace: ``,
    }],
    equivalent:
      "HALF B, the mirror of S3: with the name read in place the fallback is unreachable for every shape that HAS a name field, so removing the modifier skip changes nothing on any input the corpus or the fixtures contain.",
  },
  {
    id: "S5",
    lang: "scala",
    ruling: "name-anchoring",
    what: "scala: revert BOTH halves — the faithful pre-fold anchor (first non-trivia child, modifiers included), which is what scala/declaration-name-anchoring must catch",
    edits: [
      {
        find: `    const named = this.declarationNameNode(node)\n    if (named) return named\n`,
        replace: ``,
      },
      {
        find: `      if (c.type === "opaque_modifier" || c.type === "inline_modifier") continue\n`,
        replace: ``,
      },
    ],
  },
  {
    id: "K1",
    lang: "kotlin",
    ruling: "ctor-identity",
    what: "kotlin constructor back to the literal `constructor` (the K11 rule's half-implementation, measured at 60 edges over 405 files)",
    edits: [{
      find: `    const constructorName = parentClass as string`,
      replace: `    const constructorName = "constructor"`,
    }],
  },
  {
    id: "K2",
    lang: "kotlin",
    ruling: "name-anchoring",
    what: "kotlin declaration anchor back to the first non-trivia child, so a wrapped class header is anchored on its primary-constructor PARAMETER and a class-body property on its `val` keyword",
    edits: [{
      find: `    const name = this.findNameNode(node)\n    if (name) return name\n`,
      replace: ``,
    }],
  },
  {
    id: "K3",
    lang: "kotlin",
    ruling: "name-anchoring",
    what: "kotlin: drop the `variable_declaration` DESCENT that the fold added, so a class-body property is anchored on its `val`/`var` keyword again (the defect the fold fixed — 7,126 symbol rows over 1,200 corpus files carried a different column without it)",
    edits: [{
      find: `        if (c.type === "variable_declaration") {\n          const inner = this.findNameNode(c)\n          if (inner) return inner\n        }\n        continue`,
      replace: `        continue`,
    }],
  },
  {
    id: "C1",
    lang: "kotlin",
    ruling: "context-header",
    what: "the 2026-10-11 context-parameter refusal reverts to its absence: all three walk guards removed, so a `context(...)` header publishes `calls[Global -> context]` again and the recovery inside it publishes the fabricated call to the PARAMETER",
    edits: [
      { find: "        if (this.isKotlinContextParameterHeader(n)) return\n", replace: "" },
      { find: "      if (this.isKotlinContextParameterHeader(n)) continue\n", replace: "" },
    ],
  },
  {
    id: "L1",
    lang: "kotlin",
    ruling: "local-declaration",
    what: "the 2026-10-11 local-declaration refusal reverts to its absence: a `val` inside a property ACCESSOR body or a LAMBDA literal is published as a `property` symbol again, reaching the index and every name-keyed lookup as a declaration the file never declares",
    edits: [
      { find: "          if (this.isKotlinLocalDeclaration(n)) break\n", replace: "" },
    ],
  },
  {
    id: "U1",
    lang: "kotlin",
    ruling: "unit-identity",
    what: "the 2026-10-11 unit-identity ruling reverts to the pre-round shape with ONE package-sourced row: nothing is withheld when a file declares no top-level type, the exports source goes back to the PACKAGE, and the unit-identity row is dropped whole",
    edits: [
      { find: "    const unitType = this.primaryTopLevelType(symbols)\n    if (!unitType) return\n", replace: "" },
      { find: "        source: unitType.name,\n", replace: "        source: packageName,\n" },
      { find: "      // THE SAME NAME UNDER ITS PACKAGE IDENTITY, and the two rows are NOT a\n      // duplicate: `Pandora -> Published` says the UNIT publishes the name, while\n      // `com.acme.x -> Published` says the PACKAGE does, and the second is the one\n      // that joins against this lane's `imports` rows (whose source IS the\n      // package, because `source + \".\" + target` has to reconstruct the dotted\n      // path an import names — measured: 10,853 of 10,885 `import_header`s sit in\n      // a package-bearing file). Both spellings are pinned by this lane's own\n      // fixtures — kotlin/ontology-imports-exports and kotlin/context-parameters\n      // require the package row, kotlin/exports-published-surface and\n      // kotlin/imports-exports-ontology require the unit row — and the pair is\n      // written from ONE predicate so they cannot drift into disagreeing about\n      // which names are published.\n      relationships.push({\n        source: packageName,\n        target: s.name,\n        type: ASTEngine.RelationshipType.Exports,\n        confidence: 1.0,\n        ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),\n        metadata: {\n          isKotlinExport: true,\n          relationshipType: \"exported_declaration\",\n          moduleIdentity: \"package\",\n          kind: String(s.kind),\n          exportKind: String(s.kind),\n          visibility: s.visibility || \"public\",\n          dottedName: `${packageName}.${s.name}`,\n        },\n      })\n", replace: "" },
    ],
  },
  {
    id: "S6",
    lang: "scala",
    ruling: "module-identity",
    what: "scala: the FILE-sentinel twin of the module surface is dropped, so a packaged file publishes only its package-path rows and the unit spelling disappears",
    edits: [
      { find: "      if (moduleName !== RealScalaAnalyzer.FILE_MODULE) emitSurfaceRow(RealScalaAnalyzer.FILE_MODULE, name, e)\n", replace: "" },
    ],
  },
  {
    id: "S7",
    lang: "scala",
    ruling: "module-identity",
    what: "scala: a TOP-LEVEL export clause goes back to the `(script)` statement sentinel instead of the module identity (the pre-2026-10-11 spelling)",
    edits: [
      { find: "      return moduleName\n    }\n    const visit = (n: Node): void => {\n", replace: "      return \"(script)\"\n    }\n    const visit = (n: Node): void => {\n" },
    ],
  },
  {
    id: "S8",
    lang: "scala",
    ruling: "clause-path",
    what: "scala: a wildcard clause with a DOTTED qualifier publishes the qualifier as a target again (`export other.module.*` -> `other.module`), the exact row scala/exports-surface forbids",
    edits: [
      { find: "            if (qualifier.length === 0 || qualifier.includes(\".\")) continue\n", replace: "            if (qualifier.length === 0) continue\n" },
    ],
  },
  {
    id: "S9",
    lang: "scala",
    ruling: "qmark",
    what: "scala: the `?`/`_` refusal goes back to the literal ban, so a file that DECLARES `type `?`[A]` loses its real `?` type references",
    edits: [
      { find: "        if ((name === \"?\" || name === \"_\") && !declaredNames.has(name)) return\n", replace: "        if (name === \"?\" || name === \"_\") return\n" },
    ],
  },
  {
    id: "S10",
    lang: "scala",
    ruling: "imports-source",
    what: "scala: the `imports` edge sources at `root` again, conflating the imports label with the import-REFERENCES label",
    edits: [
      { find: "        relationships.push({\n          source: \"(file)\",\n          target: t,\n          type: ASTEngine.RelationshipType.Imports,", replace: "        relationships.push({\n          source: \"root\",\n          target: t,\n          type: ASTEngine.RelationshipType.Imports," },
    ],
  },
  {
    id: "S11",
    lang: "scala",
    ruling: "clause-path",
    what: "scala: an export clause's target goes back to the written QUALIFIER PATH glued onto the leaf (`Inner.cancel`), a dotted endpoint no symbol can resolve",
    edits: [
      { find: "              target,\n              type: ASTEngine.RelationshipType.Exports,\n              confidence: 1.0,", replace: "              target: qualifier.length > 0 ? qualifier + \".\" + target : target,\n              type: ASTEngine.RelationshipType.Exports,\n              confidence: 1.0," },
    ],
  },
]

const sha = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16)

/** Read `"<lang>":{"pass":N,"fail":M}` by CHARACTER WALK — no regex, and a
 *  visible -1 when the marker is absent rather than a silent 0. */
function readCount(text: string, lang: string, which: "pass" | "fail"): number {
  const marker = `"${lang}":{"pass":`
  const at = text.indexOf(marker)
  if (at < 0) return -1
  const wanted = which === "pass" ? marker : `"fail":`
  const start = which === "pass" ? at + marker.length : text.indexOf(wanted, at)
  if (start < 0) return -1
  let i = which === "pass" ? start : start + wanted.length
  let out = ""
  while (i < text.length && text[i] >= "0" && text[i] <= "9") out += text[i++]
  return out === "" ? -1 : Number(out)
}

function runLane(lang: string): { pass: number; fail: number; failed: string[]; status: number } {
  // A NON-ZERO EXIT IS THE EXPECTED RESULT OF A DEAD MUTANT, NOT AN ERROR.
  //
  // `run-fixtures.ts` exits 4 when the lane's baseline gate sees a REGRESSION —
  // which is precisely what a caught mutant produces — and `execFileSync` THROWS
  // on a non-zero exit, so reading its return value alone reported four killed
  // mutants as `DIED-LOUDLY` with no output at all. The status is kept (the
  // process did run; the run's own verdict is "the lane went red"), and the
  // pipes are read off the thrown error, which is where execFileSync puts them.
  let out = ""
  let status = 0
  try {
    out = execFileSync("bun", ["script/m14/run-fixtures.ts", "--lang", lang], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024,
    })
  } catch (e: any) {
    status = typeof e?.status === "number" ? e.status : -1
    out = typeof e?.stdout === "string" ? e.stdout : String(e?.stdout ?? "")
    if (out.trim() === "") {
      // No output at all means the lane never ran — a real error, not a kill.
      throw new Error(`run-fixtures produced no output (exit ${status}): ${String(e).split("\n")[0].slice(0, 120)}`)
    }
  }
  const failed: string[] = []
  for (const line of out.split("\n")) {
    if (!line.startsWith(`FAIL  ${lang}/`)) continue
    const name = line.slice(`FAIL  ${lang}/`.length).trim()
    if (!failed.includes(name)) failed.push(name)
  }
  return { pass: readCount(out, lang, "pass"), fail: readCount(out, lang, "fail"), failed, status }
}

const analyzers: Record<string, string> = {
  kotlin: join(ROOT, "src", "ast", "real-kotlin-analyzer.ts"),
  scala: join(ROOT, "src", "ast", "real-scala-analyzer.ts"),
}

const rows: Array<{ id: string; lang: string; verdict: string; detail: string; hash: string }> = []
const selected = MUTANTS.filter((m) => ONLY.length === 0 || ONLY.includes(m.id))
const baseline = new Map<string, { pass: number; fail: number; failed: string[]; status: number }>()

for (const lang of [...new Set(selected.map((m) => m.lang))]) {
  const b = runLane(lang)
  baseline.set(lang, b)
  console.log(`baseline ${lang}: ${b.pass} pass / ${b.fail} fail  exit ${b.status}  (pre-existing failures: ${b.failed.length > 0 ? b.failed.join(", ") : "none"})`)
}

for (const m of selected) {
  const path = analyzers[m.lang]
  const original = readFileSync(path, "utf8")
  const base = baseline.get(m.lang)!
  const missing = m.edits.find((e) => original.indexOf(e.find) < 0)
  if (missing) {
    rows.push({ id: m.id, lang: m.lang, verdict: "SITE-MOVED", hash: sha(original), detail: `the exact text to mutate is not in the file — the site changed and this mutant no longer tests what it claims: ${JSON.stringify(missing.find.slice(0, 60))}` })
    continue
  }
  let mutated = original
  for (const e of m.edits) mutated = mutated.split(e.find).join(e.replace)
  writeFileSync(path, mutated)
  let res: { pass: number; fail: number; failed: string[]; status: number } | null = null
  try {
    res = runLane(m.lang)
  } catch (e: any) {
    rows.push({ id: m.id, lang: m.lang, verdict: "DIED-LOUDLY", hash: sha(original), detail: `the lane did not run: ${String(e?.message ?? e).split("\n")[0].slice(0, 140)}` })
  }
  writeFileSync(path, original)
  const restored = readFileSync(path, "utf8")
  if (sha(restored) !== sha(original)) {
    rows.push({ id: m.id, lang: m.lang, verdict: "RESTORE-FAILED", hash: sha(restored), detail: `${path} does not match the in-memory original after restore — STOP and fix this before trusting any row above` })
    break
  }
  if (!res) continue
  const newlyFailing = res.failed.filter((f) => !base.failed.includes(f))
  const newlyPassing = base.failed.filter((f) => !res.failed.includes(f))
  if (newlyFailing.length > 0) {
    rows.push({ id: m.id, lang: m.lang, verdict: "DEAD", hash: sha(original), detail: `new FAIL (lane exit ${res.status}): ${newlyFailing.join(", ")}` })
  } else if (m.equivalent) {
    // Recorded as equivalent, not as a kill and not as a survivor: the two
    // implementations agree on every input the corpus contains, so no fixture
    // can see the difference, and one that claimed to would be lying.
    rows.push({ id: m.id, lang: m.lang, verdict: "EQUIVALENT", hash: sha(original), detail: m.equivalent })
  } else if (newlyPassing.length > 0) {
    rows.push({ id: m.id, lang: m.lang, verdict: "SURVIVED-BUT-LOUDLY-DIFFERENT", hash: sha(original), detail: `a previously failing fixture now passes: ${newlyPassing.join(", ")}` })
  } else {
    rows.push({ id: m.id, lang: m.lang, verdict: "SURVIVED", hash: sha(original), detail: `${res.pass} pass / ${res.fail} fail — identical to the clean baseline` })
  }
}

console.log(`\nid   rule             verdict                  analyzer-sha  what`)
console.log("-".repeat(168))
for (const r of rows) {
  const m = MUTANTS.find((x) => x.id === r.id)
  console.log(`${r.id.padEnd(5)} ${(m?.ruling ?? "").padEnd(16)} ${r.verdict.padEnd(24)} ${r.hash}   ${(m?.what ?? "").slice(0, 78)}`)
  console.log(`${" ".repeat(53)}-> ${r.detail}`)
}

const dead = rows.filter((r) => r.verdict === "DEAD").length
const loud = rows.filter((r) => r.verdict === "DIED-LOUDLY").length
const equiv = rows.filter((r) => r.verdict === "EQUIVALENT").length
const survived = rows.filter((r) => r.verdict === "SURVIVED" || r.verdict === "SURVIVED-BUT-LOUDLY-DIFFERENT").length
const moved = rows.filter((r) => r.verdict === "SITE-MOVED").length
const restoreFailed = rows.filter((r) => r.verdict === "RESTORE-FAILED").length
console.log(`\n${dead} dead · ${equiv} equivalent · ${survived} survived · ${moved} site-moved · ${loud} died-loudly · ${restoreFailed} restore-failed · ${rows.length} total`)
if (equiv > 0) console.log("EQUIVALENT mutants are recorded, not counted as kills. Their equivalence is measured, not assumed.")
if (survived > 0) console.log("SURVIVORS ARE FINDINGS: each one is a ruling the lane's fixtures do not pin.")
if (moved > 0) console.log("SITE-MOVED mutants no longer test what they claim. Re-point them or retire them.")
if (restoreFailed > 0) console.log("RESTORE-FAILED: an analyzer on disk is NOT the file this run started from.")
process.exitCode = survived > 0 || moved > 0 || loud > 0 || restoreFailed > 0 ? 1 : 0
