/**
 * Author the make fixtures' expectation files from a MEASURED run, with the
 * rationale and the `forbid` sets written by hand.
 *
 * The split matters. `expectSymbols` / `expectRelationships` are transcribed
 * mechanically from `ASTEngine.parseFile` so a line number is exact rather than
 * remembered — but a transcription that is not also CHECKED is just a snapshot
 * of whatever the analyzer happened to do, which is the failure mode the hcl
 * lane hit when its first draft put a reference on a comment line. So every
 * `forbid` below is written as the specific WRONG ANSWER with the reason it is
 * wrong, independently of the run: if the analyzer regresses to any of them the
 * fixture fails, and if the analyzer is right the entry is a statement about why
 * the right answer is right.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { ASTEngine } from "/home/ishaq2321/backbencher-brain/src/ast/engine"

const DIR = "/home/ishaq2321/backbencher-brain/validation/m14/fixtures/make"

interface Spec {
  file: string
  rationale: string
  authoredNote: string
  /** Extra expect rows, merged over the measured ones. */
  addSymbols?: { name: string; kind: string }[]
  /** Drop measured rows matching (type, target[, from]). */
  drop?: { type: string; target: string; from?: string }[]
  forbidRelationships?: Record<string, unknown>[]
  forbidSymbols?: Record<string, unknown>[]
}

const SPECS: Spec[] = [
  {
    file: "operator-trimmed-name.mk",
    rationale:
      "An assignment's NAME, and the operator that must not become part of it. This is not cosmetic: the grammar's `word` node is inconsistent about the operator — for `CGO_ENABLED?=1` it spans `CGO_ENABLED?`, while for `CC:=1` it spans `CC` — so the two spellings of the same syntax produced different symbol names. Measured over the 99-file corpus that was 55 symbols named `CGO_ENABLED?` / `BUILD_TAGS+` and 112 edge ends that dangled BY CONSTRUCTION, because every reference names the clean identifier and so can never match a symbol that carries its operator. Each of the five operators below must yield the bare name, and each of the five references on line 21 and again on line 22 must resolve to it.",
    authoredNote:
      "line_number values transcribed from a measured run through ASTEngine.parseFile and checked line by line against the numbered source: declarations on 13-17, the `lint` rule on 21, its recipe on 22. Ten reference rows rather than five because the same five variables are read on BOTH lines — a target that reads one variable on two lines is two facts, and collapsing them to one would lose the address surface the product serves call-site positions from.",
    forbidSymbols: [
      { name: "CGO_ENABLED?", note: "the pre-fix shape: the `?` of `?=` captured as part of the name, so every `$(CGO_ENABLED)` reference dangles" },
      { name: "BUILD_TAGS+", note: "same, for `+=`" },
      { name: "RECURSE::", note: "`::=` is not a GNU Make operator, but if a spelling ever grew one it must still be trimmed the same way" },
    ],
    forbidRelationships: [
      { type: "uses", target: "CGO_ENABLED", note: "the inverse error: a variable THIS FILE DECLARES published as `uses` demotes a real declaration out of the reference graph" },
      { type: "uses", target: "BUILD_TAGS", note: "same" },
      { type: "uses", target: "STRICT", note: "same" },
      { type: "uses", target: "RECURSE", note: "same" },
      { type: "uses", target: "SHELL_CMD", note: "same" },
      { type: "references", target: "CGO_ENABLED?", note: "the reference side of the operator bug: an edge to the polluted spelling, which no reference in the file can produce" },
      { type: "references", target: "BUILD_TAGS+", note: "same" },
    ],
  },
  {
    file: "uses-vs-references.mk",
    rationale:
      "The BUILTIN / EXTERNAL / PROJECT split, which decides the relationship LABEL. A Make prerequisite is usually a FILE and a Make variable is often set by the command line, the environment, or another makefile, and GNU Make ships builtins no file can declare. Publishing any of those as a project-internal `references` asserts a declaration that does not exist: over the corpus, 231 unresolved edge ends were file paths, 187 external variables and 160 builtins. So `references` is emitted only when THIS file declares the target, and `uses` carries the rest — labelled, so the class is visible rather than pooled. Line 20 deliberately reads a declared variable and an undeclared one on the SAME recipe line, so the fixture fails if the two classes are ever collapsed back together.",
    authoredNote:
      "line_number values transcribed from a measured run and checked against the numbered source: declarations on 14-16, `build` on 19 with its recipe on 20, `info` on 23 with its recipe on 24, `foreach-binder` on 28 with its recipe on 29. The `$(DESTDIR)usr/bin/app` prerequisite is recorded under its own text AND its inner reference is recorded separately — the dependency is on the expansion, the reference is on the variable, and they are different facts.",
    forbidRelationships: [
      { type: "references", target: "DESTDIR", note: "the pre-split shape: a variable this file does not declare published as `references` claims a declaration named DESTDIR that no line here creates" },
      { type: "references", target: "CURDIR", note: "a GNU Make BUILTIN published as `references` — same category error, 160 corpus edge ends" },
      { type: "references", target: "MAKE", note: "same" },
      { type: "references", target: "MAKEFILE_LIST", note: "same" },
      { type: "uses", target: "CC", note: "the INVERSE error: a project declaration published as `uses` demotes it out of the reference graph" },
      { type: "uses", target: "OBJ", note: "same" },
      { type: "uses", target: "SRC", note: "same" },
      { type: "references", target: "mod", note: "`mod` is a `$(foreach mod,…)` binder — a LOCAL. It is published as `uses` labelled `local_binding`, never as a project `references`" },
      { type: "uses", target: "CC", from: "build-braces", note: "the `${CC}` form of a variable THIS FILE DECLARES. Added after the differential found the `${…}` normalisation gap: the row existed with the wrong label only because `${` was not handled at all" },
      { type: "uses", target: "OBJ", from: "build-braces", note: "same, for `${OBJ}`" },
      { type: "uses", target: "${CC}", note: "the raw wrapper as an edge target. 68 corpus occurrences across 14 files produced exactly this row, each of them a second spelling of a fact already published under the bare name" },
      { type: "uses", target: "${OBJ}", note: "same" },
    ],
    forbidSymbols: [
      { name: "DESTDIR", note: "DESTDIR is not declared in this fixture, so it must not become a symbol" },
      { name: "CURDIR", note: "a builtin must not become a symbol" },
      { name: "mod", note: "a foreach binder is a local, not a declaration" },
    ],
  },
  {
    file: "macro-call-and-bare-expression.mk",
    rationale:
      "`$(call NAME)` is a call, and a bare top-level expression is still a place references live. Two separate defects are pinned. (1) A macro must be a FUNCTION: a `$(call mk)` that resolves to a `constant` is a callee that cannot be called. (2) References used to be collected only beneath a `variable_assignment` and a `rule`, so a bare top-level expression — a `function_call` DIRECTLY under `makefile` — contributed nothing at all. That is not a corner case: `$(foreach t,… $(eval $(call mk,$(t))))` is the idiom nomad/GNUmakefile uses to reify its package targets, the corpus has one such site, and it produced ZERO edges before the fix. Positional parameters `$(1)`/`$(2)` are not declarations and must not become symbols.",
    authoredNote:
      "line_number values transcribed from a measured run and checked against the numbered source: `mk` defined on 15, `two_args` on 19, `pkg` on 24 calling on 25, the bare foreach/eval expression on 28, `combined` on 31 calling on 32. The call at line 28 is sourced from the MODULE, not from a rule, because there is no enclosing rule — that is the whole point of the fixture and the source is asserted explicitly rather than left as a wildcard.",
    forbidSymbols: [
      { name: "1", note: "`$(1)` is a positional parameter inside a macro body, not a declaration" },
      { name: "2", note: "same" },
      { name: "mk", kind: "constant", note: "a macro must be a FUNCTION: a `calls` edge that resolves to a constant is a callee that cannot be called" },
      { name: "two_args", kind: "constant", note: "same" },
    ],
    forbidRelationships: [
      { type: "calls", target: "foreach", note: "`foreach` is a GNU Make builtin function, not a macro — a call edge to it would dangle" },
      { type: "calls", target: "eval", note: "same" },
      { type: "calls", target: "shell", note: "same" },
      { type: "references", target: "mk", note: "a `$(call mk)` is a CALL, not a bare reference; the two are different facts and the label follows the call" },
      { type: "uses", target: "mk", note: "the inverse: a macro this file defines must not be demoted to a `uses` edge" },
    ],
  },
  {
    file: "includes-and-exports.mk",
    rationale:
      "Includes and exports, including the three shapes one directive can take. The include SOURCE must be this file's module and not a hardcoded name: with a constant source, every makefile that includes `hooks` produced the same edge and two files could not be told apart in the graph. A target IS an export — an including makefile invokes it by name — so the file's public surface is answerable. And `export NAME` with no `=` wraps a `list`, with no assignment node anywhere, so it is the ONLY place that name appears and without that branch the export is invisible entirely. A computed include names no file this parse can know, so the EXPRESSION is recorded and flagged rather than dropped: an unresolved import is a fact and a silently absent one is not.",
    authoredNote:
      "line_number values transcribed from a measured run and checked against the numbered source: `MODULE` on 12, the three includes on 15 / 18 / 23, the two exports on 26 / 27, `PUBLIC_TARGET` on 29. The `contains` row for `EXPORTED_BARE` was NOT in the first transcription — the measured run gave it `exports` and no `contains`, because the bare-export branch declared the symbol without recording that the module owns it. That is an inconsistency (a member of the public surface the module does not own) and it was fixed before this file was authored; the row is asserted so it cannot come back.",
    forbidRelationships: [
      { from: "makefile", note: "the pre-fix shape: every include edge was sourced at a literal `makefile`, so two makefiles including the same path produced the same edge" },
      { type: "exports", target: "hooks", note: "an included file is IMPORTED, not exported" },
      { type: "imports", target: "MODULE", note: "the inverse: a variable is contained, not imported" },
      { type: "uses", target: "export", note: "an edge to the `export` KEYWORD. Added with the symbol forbid above, for the same reason: the surviving mutant showed this battery did not check for it." },
    ],
    forbidSymbols: [
      { name: "hooks", note: "an include path is an import, not a declaration" },
      { name: "extra.mk", note: "same" },
      { name: "export", note: "a KEYWORD reaching the name-capture path. It happened in boundary/Makefile, where `export` became the target of six edges \u2014 an edge to a keyword is an edge to nothing, and it means the exported variable was never declared. Added after the mutant `make/accept-keywords-as-names` SURVIVED this battery: a mutant that survives is a hole in the fixtures, not a pass." },
    ],
  },
  {
    file: "directive-flags.mk",
    rationale:
      "The five constructs the analyzer MODELLED but that no fixture and no corpus file exercised: private_directive, override_directive, undefine_directive, unexport_directive and shell_assignment appeared in ZERO of 99 corpus files, and vpath_directive produced no observable output at all. Untested code is not coverage, and here it was not even correct — three of those paths were broken. Found by asking, of every declared named type, which ones the corpus never fires, and then which of THOSE the analyzer claims to handle. (1) `private VAR = v` and `override VAR := v` put the keyword and the assignment on ONE line, and the walker reads the directive before the assignment nested inside it, so the flag was applied to a symbol that did not exist yet and silently dropped — in exactly the spelling people write, while the rarer two-line form worked. (2) `undefine VAR` was a PHANTOM: its operand is a `variable` FIELD holding a bare word with no named children, and the branch searched for a nested variable_assignment, so it could never fire. Same failure mode as the dead endif_directive branch, which is why that one was caught and this one survived: nothing exercised either. (3) `unexport` cleared only the metadata flag and left the exports EDGE, so the graph said the file exports a variable the symbol table said it did not. The fixture pins all three as forbidden shapes, and pins vpath in BOTH directions — the `Make vpath` pattern positively, and no invented symbol negatively.",
    authoredNote:
      "line_number values transcribed from the numbered source and checked against a run: EXPORTED on 6, SECRET on 10, OVERRIDDEN on 11 and 12 (two contains edges, one symbol), GONE on 13, DYNAMIC on 15, target `all` on 18; prerequisite references to SECRET and OVERRIDDEN on 18, the recipe's references on 19, and line 16 asserted to produce nothing. Two expectation bugs in this file's first draft were the harness's, not the analyzer's: `expectSymbolCount` counts by NAME and so cannot express a file total, and a `forbidRelationships` entry without a `type` matches every edge between the pair — which flagged the legitimate `contains` edge. Both are recorded here because the shape of a pin is part of what it claims.",
    forbidSymbols: [
      { name: "src", note: "the `vpath %.c src` directory is not a declaration this file makes" },
      { name: "%.c", note: "neither is the vpath pattern" },
    ],
  },
  {
    file: "computed-target-prereqs.mk",
    rationale:
      "A rule whose target is an EXPRESSION still has prerequisites. `$(BIN): $(OBJS) | builddir` declares no literal target name, so the pre-fix code iterated an EMPTY list of literal targets and the entire rule published no prerequisite edges — neither group, order-only included. The owner falls back to the module: dropping the dependency loses real information, and attributing it to the file that declares the rule is not a claim the tree contradicts. The label is asserted separately because it is the OTHER half of the same fixture: OBJS and builddir are both declared in this file, so both edges are `references` and a `uses` edge would re-encode the conflation the lane removed. Found by script/m12/make-contract-probe.ts, which had existed for this lane and had never been run — the same lesson as the two surviving mutants.",
    authoredNote:
      "line_number values transcribed from a measured run and checked against the numbered source: BIN on 12, OBJS on 13, all on 16, the computed-target rule on 18, builddir declared on 20. The two prerequisite edges sit on 18, the rule's own line, because that is where the `|`-separated groups are written.",
    forbidSymbols: [
      { name: "$(BIN)", note: "a computed target declares NOTHING. A `function` symbol literally named `$(BIN)` is a buildable nobody can invoke — the pre-fix shape" },
    ],
    forbidRelationships: [
      { type: "uses", target: "OBJS", note: "OBJS is declared in this fixture, so the edge is `references`; `uses` would demote a real declaration out of the reference graph" },
      { type: "uses", target: "builddir", note: "same — builddir is a target three lines below" },
      { type: "references", target: "$(BIN)", note: "the raw wrapper as an edge target: the expansion names the VARIABLE, and `references … -> BIN` is the row that should exist instead" },
    ],
  },
  {
    file: "substitution-and-automatic.mk",
    rationale:
      "Two reference forms that are easy to miss because they are not `$(VAR)`. `$(VAR:.c=.o)` is a `substitution_reference` — a SIBLING of `variable_reference`, not a child — so an analyzer reading only the latter loses every substitution reference in the corpus (9 of them). `$@` / `$<` / `$^` are `automatic_variable`s: they name something no file can declare, which is exactly what the `uses` class exists for, so they are published rather than dropped and labelled `automatic` rather than `builtin`. `$$` is Make's ESCAPED dollar, so `$$?` is the SHELL's exit-status variable, not a Make automatic one; the edge is real information but calling it a builtin would be a category error, so it is labelled `shell_variable`.",
    authoredNote:
      "line_number values transcribed from a measured run and checked against the numbered source: `SRC` on 11, `OBJ` on 12 (whose substitution reference to SRC is on the SAME line), `all` on 15, its first recipe on 16, its second on 21. The OBJ->SRC row is the whole reason this fixture exists and it is asserted with the substitution form named in the note.",
    forbidRelationships: [
      { type: "uses", target: "SRC", note: "SRC is declared in this file, so the substitution reference to it is a `references` edge; `uses` would demote a real declaration" },
      { type: "references", target: "$@", note: "an automatic variable names nothing any file can declare, so it is `uses`; `references` would claim a declaration named `$@`" },
      { type: "references", target: "$<", note: "same" },
      { type: "references", target: "$^", note: "same" },
      { type: "calls", target: "$@", note: "an automatic variable is a READ, not a call" },
    ],
  },
]

const out: string[] = []
for (const spec of SPECS) {
  const abs = `${DIR}/${spec.file}`
  const r: any = await ASTEngine.parseFile(abs, readFileSync(abs, "utf8"))
  const base = spec.file.replace(/\.mk$/, "")

  let symbols = (r.symbols as any[]).map((s) => ({ name: s.name, kind: s.kind }))
  for (const d of spec.drop ?? []) void d
  const rels = (r.relationships as any[])
    .filter((x) => !(spec.drop ?? []).some((d) => d.type === x.type && d.target === x.target && (!d.from || d.from === x.source)))
    .map((x) => {
      const row: Record<string, unknown> = { type: x.type, from: x.source, target: x.target, line_number: x.line_number }
      const tier = (x.metadata as any)?.evidenceClass
      if (tier) row["meta.evidenceClass"] = tier
      return row
    })

  const payload = {
    fixtureId: `make/${base}`,
    language: "make",
    authoredBeforeAnalyzerRun: false,
    authoredNote: spec.authoredNote,
    rationale: spec.rationale,
    expectSymbols: symbols,
    expectRelationships: rels,
    forbidSymbols: spec.forbidSymbols ?? [],
    forbidRelationships: spec.forbidRelationships ?? [],
  }
  writeFileSync(`${DIR}/${base}.expectation.json`, JSON.stringify(payload, null, 2) + "\n")
  out.push(`  ${base}: ${symbols.length} symbols, ${rels.length} relationships, ${(spec.forbidRelationships ?? []).length} forbid-rel, ${(spec.forbidSymbols ?? []).length} forbid-sym`)
}
console.log(out.join("\n"))
