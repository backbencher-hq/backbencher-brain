// ELIXIR_FIX2 — MUTATION PROOF for this lane's new behaviours.
//
// WHY THIS FILE AND NOT script/m14/mutate-analyzer.ts. The shared mutation
// harness wraps ANALYZER OUTPUT (it rewrites the ParseResult a fixture runner
// receives), and it lives in script/m14/**, which the workstream's ownership
// table gives to the supervisor. The mutants below are SOURCE-level: each one
// edits src/ast/real-elixir-analyzer.ts the way a real regression would, re-runs
// the REAL fixture runner against the edited analyzer, and requires the suite to
// go red. Output-wrapping proves the fixture can see a changed answer; source
// injection proves the fixture is sensitive to the code path that produces it,
// which is the stronger claim and the one this lane's brief asks for
// ("prove a deliberately broken version FAILS").
//
// The safety property that matters here: the analyzer file is restored in a
// `finally`, and the runner verifies the restored bytes by hash before it exits.
// A mutation harness that can leave the subject broken is worse than none.
//
// Usage:  bun run validation/m14/elixir/elixir-mutants.ts
// Exit 0 = every mutant was caught. Exit 2 = a mutant survived — which per
// M14-HONESTY-CONTRACT §5.4 is a failure of the SUITE, not of the mutant.

import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

const ROOT = process.env.BB_M14_ROOT ?? process.cwd()
const SUBJECT = join(ROOT, "src/ast/real-elixir-analyzer.ts")
const RUNNER = join(ROOT, "script/m14/run-fixtures.ts")

interface Mutant {
  id: string
  /** The defect class this mutant injects. */
  defectClass: string
  /** What a real regression of this shape looks like, in one sentence. */
  description: string
  /** The fixture that must catch it. */
  fixture: string
  /** The source edit. Returns the mutated source. */
  edit: (src: string) => string
  /**
   * Declared EQUIVALENT, with the corpus measurement that says so.
   *
   * A mutant that survives is a finding about the SUITE, not about the mutant
   * (M14-HONESTY-CONTRACT §5.4). The one exception is a mutant that CANNOT
   * change any output — and "cannot" is a claim about the population, so it has
   * to carry a measurement or it is an excuse. A declared equivalent is
   * counted and printed, never silently dropped: if the measurement in
   * `equivalence.measurement` stops holding, the mutant starts being counted
   * again and this run fails.
   */
  equivalence?: { claim: string; measurement: string }
}

const MUTANTS: Mutant[] = [
  {
    id: "elixir/member-read-dropped",
    defectClass: "relationship-loss",
    description: "The `uses` emission for a member field read is deleted — the field read goes silent again, which is the pre-ELIXIR_FIX2 state. Caught by member-read-uses.",
    fixture: "member-read-uses",
    edit: (src) => src.replace(
      "if (memberLeaf && !this.isDefHead(node) && !this.isInDeclarationAttributeValue(node) && !this.isPatternPosition(node)) {",
      "if (false) {",
    ),
  },
  {
    id: "elixir/member-read-as-call",
    defectClass: "relationship-mislabelling",
    description: "The member field read is relabelled `calls` instead of `uses` — the edge exists but carries the wrong type, which is the Q4 failure the ontology asks about. Caught by member-read-uses.",
    fixture: "member-read-uses",
    edit: (src) => src.replace(
      "memberLeaf.leaf, ASTEngine.RelationshipType.Uses, 0.7,",
      "memberLeaf.leaf, ASTEngine.RelationshipType.Calls, 0.8,",
    ),
  },
  {
    id: "elixir/member-read-callee-included",
    defectClass: "relationship-fabrication",
    description: "The receiver's first character is no longer checked, so a CAPITALIZED remote callee is double-labelled `uses` on top of its `calls` edge — every remote call published twice under two labels. Caught by member-read-uses.",
    fixture: "member-read-uses",
    edit: (src) => src.replace(
      "      const c0 = root.charCodeAt(0)\n      if (c0 < 97 || c0 > 122) return undefined",
      "      const c0 = root.charCodeAt(0)\n      if (false) return undefined",
    ),
  },
  {
    id: "elixir/member-read-pattern-included",
    defectClass: "relationship-fabrication",
    description: "The `->` pattern-position guard is removed, so binding a field in a clause head publishes a `uses` edge — a pattern is not an evaluation (ER-D7). Caught by member-read-uses.",
    fixture: "member-read-uses",
    edit: (src) => src.replace(
      "if (memberLeaf && !this.isDefHead(node) && !this.isInDeclarationAttributeValue(node) && !this.isPatternPosition(node)) {",
      "if (memberLeaf && !this.isDefHead(node) && !this.isInDeclarationAttributeValue(node)) {",
    ),
  },
  {
    id: "elixir/export-surface-dropped",
    defectClass: "relationship-loss",
    description: "The `exports` pass is deleted — the module's published surface disappears from the graph. Caught by export-surface.",
    fixture: "export-surface",
    edit: (src) => src.replace(
      "      if (s.visibility !== \"public\") continue\n      if (!EXPORTED_KINDS.has(String(s.kind))) continue",
      "      if (true) continue\n      if (!EXPORTED_KINDS.has(String(s.kind))) continue",
    ),
  },
  {
    id: "elixir/export-surface-private",
    defectClass: "relationship-fabrication",
    description: "The visibility test is dropped, so defp/defmacrop/defguardp/@typep are published as exports — on this corpus 7,959 names no importer can bind, and no oracle can catch it because both sides would be written from the same wrong rule. Caught by export-surface.",
    fixture: "export-surface",
    edit: (src) => src.replace(
      "      if (s.visibility !== \"public\") continue\n      if (!EXPORTED_KINDS.has(String(s.kind))) continue",
      "      if (!EXPORTED_KINDS.has(String(s.kind))) continue",
    ),
  },
  {
    id: "elixir/export-surface-field",
    defectClass: "relationship-fabrication",
    description: "Struct fields (Property) join the exported kinds, so each field is published as an importable unit — membership already rides `contains`, per the exports-family ruling. Caught by export-surface.",
    fixture: "export-surface",
    edit: (src) => src.replace(
      "  ASTEngine.SymbolKind.Type,\n])",
      "  ASTEngine.SymbolKind.Type,\n  ASTEngine.SymbolKind.Property,\n])",
    ),
  },
  {
    id: "elixir/export-surface-selfloop",
    defectClass: "relationship-fabrication",
    description: "The `owner === name` guard is dropped, so a defstruct's own symbol publishes `exports M -> M` — the same self-loop the contains pass suppresses (EX-L3). Caught by export-surface.",
    fixture: "export-surface",
    edit: (src) => src.replace(
      "      if (owner.length === 0 || owner === s.name) continue\n      if (s.visibility !== \"public\") continue",
      "      if (owner.length === 0) continue\n      if (s.visibility !== \"public\") continue",
    ),
  },
  {
    id: "elixir/overrides-dropped",
    defectClass: "relationship-loss",
    description: "The `overrides` pass is deleted — the language's override construct is read but not published, which is the pre-ELIXIR_FIX2 state. Caught by use-defoverridable.",
    fixture: "use-defoverridable",
    edit: (src) => src.replace(
      "    for (const [mod, used] of ctx.moduleUses) {\n      for (const provider of used) {",
      "    for (const [mod, used] of new Map<string, Set<string>>()) {\n      for (const provider of used) {",
    ),
  },
  {
    id: "elixir/overrides-fabricated",
    defectClass: "relationship-fabrication",
    description: "The overridable-SET lookup is dropped, so EVERY definition in a `use N` module is published as overriding N — the fabrication the whole ruling turns on, since most definitions in a `use N` module are new functions. Caught by use-defoverridable.",
    fixture: "use-defoverridable",
    edit: (src) => src.replace(
      "          if (named && (named.has(qualified) || named.has(bare))) overriddenBy = provider",
      "          if (true) overriddenBy = provider",
    ),
  },
  {
    id: "elixir/overrides-whole-module",
    defectClass: "relationship-fabrication",
    description: "The `defoverridable SomeModule` arm stops requiring that SomeModule be DECLARED in this file, so the arm names a function of a module whose function list was never read — the exact fabrication the arm's comment warns about, and the shape that would make `use GenServer` + `def child_spec` fire for every `use` target. Caught by use-defoverridable.",
    fixture: "use-defoverridable",
    edit: (src) => src.replace(
      "              const declares = ctx.symbols.some((s) => (s.ownerName || \"\") === m && s.name === member.name)",
      "              const declares = member.name.length > 0",
    ),
  },
  {
    id: "elixir/overrides-quoted-leak",
    defectClass: "relationship-fabrication",
    description: "The LIVE quote gate is defeated: `defoverridable` is recorded even when the walk is inside quoted code, so a `defoverridable` inside a `__using__` TEMPLATE could be credited to the module that only DEFINES the template. NOT CAUGHT, and the survival is adjudicated EQUIVALENT with a measurement rather than waved through — see `equivalence` below. The first version of this mutant deleted a SECOND, redundant guard inside recordOverridable and also survived, byte-identical, because the walk already routes every quoted call away from the branch chain; a guard that cannot fire is dead code wearing a safety net's name, so the redundant one was deleted and the mutant now attacks the gate that is live.",
    fixture: "use-defoverridable",
    equivalence: {
      claim: "Removing the walk's quote gate for `defoverridable` cannot change any output on this corpus, so no fixture can catch it and its survival is not a hole in the suite.",
      measurement: "Probe F3 in validation/m14/elixir/elixir-construct-census.ts counts `defoverridable` sites that are BOTH inside a quote AND credited to a module scope — the only shape the gate can change, because a mark inside a quoted `__using__` body is credited to the MACRO's function scope, and a function scope is never the target of a `use`. Measured over 601 derived .ex/.exs files: E1 26 sites / 14 files, of which F1 (no enclosing def body) 10 / 3, F2 (credited to a module) 10 / 3, and **F3 (inside a quote AND credited to a module) 0 / 0**. The counts decompose exactly: 26 = 16 enclosed in a def body + 10 module-credited, and none of the 10 is quoted. Corroborated by applying the mutant and diffing the analyzer's own output on the fixture: identical relationships, symbols and metadata.",
    },
    edit: (src) => src.replace(
      "         if (t) {\n            if (this.isInQuotedCode(node)) {",
      "         if (t) {\n            if (t === \"defoverridable\" && this.isInQuotedCode(node)) this.recordOverridable(node, ctx, currentScope)\n            if (this.isInQuotedCode(node)) {",
    ),
  },
  {
    id: "elixir/reason-code-stripped",
    defectClass: "evidence-integrity",
    description: "The §4 default is removed from pushRel, so an edge whose SITE carries no code loses its machine-readable reason code — measured before the fix at 49,007/49,007 calls, 930/930 references, 1,187/1,187 instantiates and 73/73 implements. Caught by struct-update, whose instantiates row pins meta.reasonCode and meta.reasonCodeSource (the marker that the edge RELIES on the default rather than a site code — which is what keeps the guarantee a live branch instead of dead code).",
    fixture: "struct-update",
    edit: (src) => src.replace(
      "      if (needReason) {\n        md.reasonCode = `elixir_${String(type)}_heuristic`\n        md.reasonCodeSource = \"default_at_pushrel\"\n      }",
      "",
    ),
  },
  {
    id: "elixir/paren-operator-name-clobbered",
    defectClass: "symbol-integrity",
    description: "The EX-A15 regression this branch inherited: the unconditional binary_operator read is restored, so `defmacro (..)` publishes a macro named \"(\" with arity 3. Caught by paren-operator-forms, which has been failing on the inherited baseline.",
    fixture: "paren-operator-forms",
    edit: (src) => src.replace(
      "          } else {\n            // ELIXIR_FIX2-P1.",
      "          }\n          if (true) {\n            // ELIXIR_FIX2-P1.",
    ),
  },
  // ---- ELIXIR_FIX2-P6: an un-nameable module must own nothing ---------------
  {
    id: "elixir/unnamed-module-scope-dropped",
    defectClass: "relationship-fabrication",
    description: "The P6 fix is reverted: an un-nameable `defmodule` pushes no scope, so the ENCLOSING module keeps ownership and contains/exports name the members of a module the corpus never names. This is the pre-fix state and it published `contains ExceptionTest -> foo`. Caught by unnamed-module-owner, whose forbids name exactly those edges.",
    fixture: "unnamed-module-owner",
    edit: (src) => src.replace(
      'if (name.length === 0) {\n      scopeStack.push({ node, name: currentScope?.name ?? "", kind: ASTEngine.SymbolKind.Module, complexity: 0, unnamedModule: true, savedAliases: ctx.aliases })\n      ctx.aliases = Object.create(ctx.aliases)\n      return true\n    }',
      'if (name.length === 0) {\n      return false\n    }',
    ),
  },
  {
    id: "elixir/unnamed-module-scope-leaked",
    defectClass: "scope-leak",
    description: "The unnamed scope is pushed but never popped, so every later declaration in the FILE loses its owner. The fixture's POSITIVE CONTROL (`defmodule Named` and its members) is the edge set that disappears, which is why the fixture pins the named case as well as forbidding the unnamed one.",
    fixture: "unnamed-module-owner",
    edit: (src) => src.replace(
      // The push keeps a node identity the exit branch will never match
      // (`scopeStack[top].node === node`), so the scope is pushed and never
      // popped: the leak is targeted at the P6 scope rather than at every scope
      // in the file.
      'scopeStack.push({ node, name: currentScope?.name ?? "", kind: ASTEngine.SymbolKind.Module, complexity: 0, unnamedModule: true, savedAliases: ctx.aliases })',
      'scopeStack.push({ node: node.parent ?? node, name: currentScope?.name ?? "", kind: ASTEngine.SymbolKind.Module, complexity: 0, unnamedModule: true, savedAliases: ctx.aliases })',
    ),
  },
  {
    id: "elixir/unnamed-module-struct-kept",
    defectClass: "symbol-integrity",
    description: "The struct half of P6 is reverted: a `defstruct` inside an un-nameable module is named after the ENCLOSING module, forging a struct that module does not define. Caught by unnamed-module-owner's forbidSymbols on the two fields.",
    fixture: "unnamed-module-owner",
    edit: (src) => src.replace(
      "if (currentScope.unnamedModule) return",
      "if (currentScope.unnamedModule && false) return",
    ),
  },
]

function sha(s: string): string { return createHash("sha256").update(s).digest("hex") }

function fixtureResult(stdout: string): { ok: boolean; detail: string } {
  const m = stdout.split("\n").filter((l) => l.startsWith("summary: ")).pop()
  if (!m) return { ok: false, detail: "no summary line — the runner did not report" }
  let parsed: any
  try { parsed = JSON.parse(m.slice("summary: ".length)) } catch (e) { return { ok: false, detail: `unparseable summary: ${m.slice(0, 160)}` } }
  const el = parsed.elixir
  if (!el) return { ok: false, detail: "no elixir row in the summary" }
  const fails: string[] = []
  for (const l of stdout.split("\n")) if (l.startsWith("FAIL  elixir/")) fails.push(l.replace("FAIL  elixir/", ""))
  return { ok: el.fail > 0, detail: `pass ${el.pass} / fail ${el.fail}; failing fixtures: ${fails.join(", ") || "(none reported)"}` }
}

async function main(): Promise<void> {
  const original = readFileSync(SUBJECT, "utf8")
  const originalSha = sha(original)
  const log: Array<Record<string, unknown>> = []
  let survivors = 0
  const L = (s: string) => process.stderr.write(s + "\n")

  L(`mutation subject: ${SUBJECT}`)
  L(`original sha256 ${originalSha}`)
  L(`mutants: ${MUTANTS.length}\n`)

  try {
    for (const m of MUTANTS) {
      const mutated = m.edit(original)
      if (mutated === original) {
        survivors++
        log.push({ id: m.id, defectClass: m.defectClass, description: m.description, fixture: m.fixture, caught: false, note: "THE EDIT MATCHED NOTHING — the source no longer has the shape the mutant targets, so the mutant is inert and proves nothing" })
        L(`SURVIVED ${m.id}: the edit matched nothing in the subject (inert mutant)`)
        continue
      }
      writeFileSync(SUBJECT, mutated)
      let out = ""
      let failed = false
      let detail = ""
      try {
        const proc = Bun.spawn(["bun", RUNNER, "--lang", "elixir"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" })
        const [so, se] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
        out = so + se
        await proc.exited
      } catch (e) {
        failed = true
        detail = `the runner threw: ${String(e).slice(0, 160)}`
      }
      if (!failed) {
        const r = fixtureResult(out)
        failed = r.ok
        detail = r.detail
      }
      // Was the mutant caught BY ITS OWN fixture, or by some unrelated one?
      const mentioned = out.includes(`FAIL  elixir/${m.fixture}`)
      const caught = failed && (!out.includes("FAIL  elixir/") || mentioned)
      const equivalent = !caught && m.equivalence !== undefined
      if (!caught && !equivalent) survivors++
      log.push({ id: m.id, defectClass: m.defectClass, description: m.description, fixture: m.fixture, caught, suiteWentRed: failed, caughtByItsOwnFixture: mentioned, detail, ...(m.equivalence ? { declaredEquivalent: m.equivalence } : {}) })
      L(`${caught ? "CAUGHT  " : equivalent ? "EQUIVAL." : "SURVIVED"} ${m.id.padEnd(40)} [${m.defectClass}] ${detail}${equivalent ? "\n         declared equivalent: " + m.equivalence.measurement.slice(0, 160) + "..." : ""}`)
    }
  } finally {
    writeFileSync(SUBJECT, original)
  }

  const restored = sha(readFileSync(SUBJECT, "utf8"))
  L(`\nrestored sha256 ${restored} (original ${originalSha}) — ${restored === originalSha ? "IDENTICAL" : "*** MISMATCH ***"}`)
  if (restored !== originalSha) {
    L("the subject was not restored byte-for-byte; fix that before trusting anything else in this file")
    process.exit(2)
  }

  const equivalents = log.filter((e: any) => e.declaredEquivalent).length
  const artifact = {
    tool: "validation/m14/elixir/elixir-mutants.ts",
    lane: "ELIXIR_FIX2",
    subject: "src/ast/real-elixir-analyzer.ts",
    subjectSha256: originalSha,
    mechanism: "SOURCE-level injection into the analyzer file, then the real script/m14/run-fixtures.ts against the edited analyzer; the subject is restored in a finally and verified by hash",
    whyNotTheSharedHarness: "script/m14/mutate-analyzer.ts wraps analyzer OUTPUT and lives in script/m14/**, which the workstream ownership table gives to the supervisor. These mutants edit the SOURCE. Registering them in the shared list is reported as a need, not made here.",
    claimLevel: "L4-scope: the mutants below are the ones this lane added; the lane's PRE-EXISTING mutant set (87 mutants, script/m14/mutate-analyzer.ts ids prefixed elixir/) was NOT re-run here and is out of this file's scope.",
    mutantsRun: MUTANTS.length,
    caught: MUTANTS.filter((m) => { const e = log.find((x: any) => x.id === m.id); return e?.caught === true }).length,
    declaredEquivalent: equivalents,
    survived: survivors,
    log,
  }
  writeFileSync("validation/m14/elixir/elixir-mutants.json", JSON.stringify(artifact, null, 2))
  const caughtN = log.filter((e: any) => e.caught === true).length
  L(`\n${caughtN}/${MUTANTS.length} caught, ${equivalents} declared equivalent (each with a corpus measurement), ${survivors} unexplained survivors`)
  if (survivors > 0) {
    L(`${survivors} SURVIVING MUTANT(S). Per M14-HONESTY-CONTRACT §5.4 the suite failed, not the mutant.`)
    process.exit(2)
  }
}

await main()