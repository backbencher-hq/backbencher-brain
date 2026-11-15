/**
 * BASH LANE MUTANTS — source mutations, run through the SHARED fixture runner.
 *
 * ## Why this file exists and why it is lane-owned
 *
 * `script/m14/mutate-analyzer.ts` holds the project's mutant registry, and it is
 * supervisor-owned, so this lane does not edit it. Its transforms mutate the
 * analyzer's RESULT OBJECT after `analyze()` returns. That is the right mechanism
 * for a defect the analyzer emits — inject a phantom edge, drop a real one — and it
 * cannot express a defect that works by REFUSING to emit: the reserved-word
 * fabrication is an edge the analyzer does not publish, so there is nothing in the
 * result to inject and a result-level mutant would have to re-derive the defect from
 * the parse tree itself. That is the M14 #290 markdown failure mode restated: the
 * instrument cannot see the class of defect it is meant to test.
 *
 * So these are SOURCE mutations: the analyzer file is edited on disk into a sibling
 * module, that module is imported, and the resulting instance is handed to the
 * shared runner's own `runLang("bash", instance)`. The expectation matcher, the
 * fixture directory, the parser and the pass/fail accounting are the shared
 * runner's, not a re-implementation — so a mutant cannot be declared caught by a
 * looser local check than the one the suite uses.
 *
 * ## The rule this file enforces
 *
 * A mutant that leaves the fixture battery green has SURVIVED, and a survivor fails
 * this file — the mutant is the failure, not the suite (honesty contract §2, L4).
 * The unmutated analyzer is run first as a CONTROL: if the control is not green,
 * the battery is broken and no mutant verdict from this file means anything.
 *
 * ## One mutant was DELETED rather than left red, and the reason is a measurement
 *
 * `bash/implicit-binding-printf-v-accepts-a-computed-name` removed the
 * `target.type === "word"` test from the `printf -v` handler, on the theory that
 * without it a computed name would be declared. It cannot be caught, because that
 * test is SUBSUMED: every node type the pinned grammar can put after `-v` other
 * than `word` carries a `$`, `{`, `[` or a quote in its own text, so
 * `isShellIdentifierName` — which every declaration already passes — refuses all of
 * them. Measured in `probe-bash-binding-shapes.mts`:
 *
 *   printf -v "$2" '%s' hi   -> string            text has $  -> refused by the identifier test
 *   printf -v $2 '%s' hi     -> simple_expansion  text has $  -> refused
 *   printf -v pre${n}fix     -> concatenation     text has $  -> refused
 *   printf -v arr[0] '%s' hi -> concatenation     text has [  -> refused
 *
 * So the mutant is a no-op on observable output. Leaving it in a file whose stated
 * rule is "a survivor fails this file" would mean a permanently red gate or a
 * fiction; deleting it and writing down why is the third option. The residual is
 * reported rather than hidden: `target.type === "word"` is a condition that cannot
 * change any result, so it is a candidate DEAD BRANCH for
 * `script/m14/audit-analyzer-grammar.ts`, which is shared machinery and not this
 * lane's to run.
 *
 * ## A SECOND mutant was DELETED, and limitation 24's own number was wrong
 *
 * `bash/arithmetic-command-closing-paren-test-dropped` removed `endsWithDoubleParen`
 * from `isArithmeticCompoundText`, so an unterminated `(( …` would be read as
 * arithmetic and publish reads for a construct bash never evaluates as arithmetic.
 * It was written because limitation 24 declared that condition's population EMPTY
 * — "0 of the 792 `compound_statements` the predicate excludes open `((`" — on the
 * reasoning that a mutant needs an input that changes the answer.
 *
 * **The premise was wrong and the conclusion was right, for a different reason.**
 * Re-measured over the WHOLE corpus (4,133 admitted, not a 400-file sample) the
 * population is **5, not 0**: 7,495 `compound_statements` are excluded and 5 open
 * `((` without closing `))`. So the mutant was writable. It was written, run, and
 * **SURVIVED** — the battery stayed green, which by this file's rule is a failure.
 *
 * The population was then read on the tree rather than argued about.
 * `probe-bash-arithmetic-operands.mts` now tallies, per excluded node, whether an
 * operand node exists and whether the node is damaged:
 *
 *   5 of 5 contain an ERROR or MISSING node, and the `(( … ))` operand text sits
 *       inside that ERROR. The shapes are `(( $+commands[brew] )) && dir=$(brew
 *       --prefix …)` (nodenv, pyenv, rbenv), `(( $+commands[brew] )); then`
 *       (cask) and `(( ! ${+ZSH_AUTOSUGGEST_ORIGINAL_WIDGET_PREFIX} )) &&`
 *       (zsh-autosuggestions). `$+commands[…]` and `${+VAR}` are ZSH forms the
 *       pinned BASH grammar cannot read, so the operand arrives as a bare `word`
 *       inside an ERROR and the closing `))` is a synthesized `[MISSING]` node.
 *   3 of the 5 contain NO operand node at all.
 *   The 2 that do contain a `variable_name` get it from the `&&`/`;` TAIL, not
 *       the arithmetic prefix — `comp_files` at cask.plugin.zsh:20 and
 *       `typeset` / `ZSH_AUTOSUGGEST_COMPLETIONS_PTY_NAME` at config.zsh:95, both
 *       of which the main walk already reads as the declaration or command they
 *       are.
 *
 * So **0 of the 5 offers an arithmetic operand for a correct analyzer to publish**,
 * and dropping the closing test would read a damaged TAIL as arithmetic. That is
 * the `printf -v` situation exactly: the mutation is a no-op on observable output
 * because there is no correct output for it to change, and a fixture cannot pin a
 * read of a node the grammar never produced. The condition is KEPT — it refuses
 * precisely the damaged shapes — and limitation 24 now carries the whole-corpus
 * numbers instead of a wrong zero.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/mutants-bash-lane.mts
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { runLang } from "../../../../script/m14/run-fixtures"

const ROOT = process.cwd()
const SOURCE = path.join(ROOT, "src/ast/real-bash-analyzer.ts")
const MUTANT_PATH = path.join(ROOT, "src/ast/__mutant_bash_analyzer.mts")

type Mutant = {
  id: string
  description: string
  /** Returns the mutated source, or null when the anchor text is absent. */
  apply: (src: string) => string | null
}

const MUTANTS: Mutant[] = [
  {
    id: "bash/unbound-read-field-dropped",
    description:
      "Round 21 regression: `declareAbsenceOfVariableBinding` is deleted from the `uses` emitter's metadata, so an edge that binds nothing in this file is once again indistinguishable from one that binds ambiguously. This is the state the 602 measured unresolved `uses` edges were in. Caught by unbound-read-published, whose four expectRelationships all pin `meta.variableDeclaredInFile`.",
    apply: (src) => {
      const anchor = "          ...this.declareAbsenceOfVariableBinding(declSites, name),\n"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "")
    },
  },
  {
    id: "bash/unbound-read-field-always-true",
    description:
      "Round 21 regression with the OPPOSITE failure: the field is hard-coded `true`, so every read claims a binding in this file whether or not one exists. This is the shape a later round reaches for when the column is unreadable — assert the common case and let the residue look like noise. Caught by unbound-read-published, which pins `false` for BOUNDARY_FIXTURE_UNDECLARED (never assigned) and for BOUNDARY_FIXTURE_ONLY_A_FUNCTION (declared only as a function, which a `$name` read cannot denote).",
    apply: (src) => {
      const anchor = "    const cands = declSites.get(name)\n    return { variableDeclaredInFile: cands !== undefined && cands.length > 0 }"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "    return { variableDeclaredInFile: true }")
    },
  },
  {
    id: "bash/implicit-binding-for-statement-removed",
    description:
      "Round 4 regression: the `for_statement` branch in the main walk is deleted, so `for NAME in words` publishes no symbol again — the exact defect round 4 closed. Caught by implicit-binding-sites, whose expectSymbols name loop_var and bare_var.",
    apply: (src) => {
      const anchor = `      } else if (node.type === "for_statement") {
        // \`for NAME in …\` binds NAME with no assignment node. See
        // \`extractImplicitBinding\` for the measurement this closes.
        this.extractImplicitBinding(node, symbols, enclosingFunction() || scriptName, declaredSymbols, scopeOwners, declSites)
`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, `      } else if (node.type === "__never__") {\n`)
    },
  },
  {
    id: "bash/implicit-binding-identifier-guard-removed",
    description:
      "Round 4 regression with the OPPOSITE failure: the shell-identifier guard inside extractImplicitBinding is deleted, so `read *.txt` declares a variable named `*.txt`. A line-removal mutant cannot produce this one — the guard is a positive test, and removing the whole for_statement branch only ever loses declarations. It is the mutant that catches the collector becoming too eager, which is how a fabrication gets in. Caught by implicit-binding-sites, whose forbidSymbols name `*.txt`.",
    apply: (src) => {
      const anchor = "      if (!isShellIdentifierName(name)) return\n      const key = `${owner}\\u0000${name}`\n      if (declaredSymbols.has(key)) return // already declared; first declaration wins\n      declaredSymbols.add(key)\n      this.noteDeclaration(declSites, name, owner, at.startPosition.row + 1, \"variable\")\n      symbols.push({\n        name,\n        kind: ASTEngine.SymbolKind.Variable,\n        range: this.nodeToRange(at),"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, anchor.replace("      if (!isShellIdentifierName(name)) return\n", ""))
    },
  },
  {
    id: "bash/implicit-binding-value-option-table-emptied",
    description:
      "Round 4 regression that a line-removal cannot produce: READ_VALUE_OPT_LETTERS is emptied, so a flag that takes a value no longer consumes its value and `read -p \"Name: \" reply` loses `reply` — the prompt `string` node is skipped as a non-word, and the skip lands on the target instead. The table is hand-maintained, so a table that decayed to empty is the realistic shape of this bug, and it is invisible in a source read. Caught by implicit-binding-sites, whose expectSymbols name prompted and split_args (`read -ra split_args`, where -a is a flag whose value is the array name).",
    apply: (src) => {
      const start = src.indexOf("const READ_VALUE_OPT_LETTERS = new Set([")
      if (start < 0) return null
      const end = src.indexOf("])", start)
      if (end < 0) return null
      return src.slice(0, start) + "const READ_VALUE_OPT_LETTERS = new Set([\n])" + src.slice(end + 2)
    },
  },
  {
    id: "bash/implicit-binding-bundle-value-rule-reverted",
    description:
      "Round 4 regression, and the one a surviving mutant found rather than a source read: the bundle rule goes back to asking only whether the bundle CONTAINS a value-taking letter, so `read -u3 name` consumes `name` and drops a binding bash actually makes. This is the inverse of the READ_VALUE_OPT_LETTERS mutant — one loses the binding, the other keeps it — and a fixture holding only one of the two shapes cannot tell them apart. Caught by implicit-binding-sites, whose expectSymbols name fd_target and prompt_reply.",
    apply: (src) => {
      const anchor = `            if (READ_VALUE_OPT_LETTERS.has(letter)) {\n              consumesNext = j === lastIndex\n              // The FIRST value-taking letter owns the value; a letter after it is\n              // not a separate option.\n              break\n            }\n`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, `            if (READ_VALUE_OPT_LETTERS.has(letter)) consumesNext = true\n`)
    },
  },
    {
    id: "bash/ambiguity-scope-chain-removed",
    description:
      "Round 5 regression, and the one that reverts the bug this lane's own fixture was written to catch: the resolution rule loses its lexical-scope chain and falls back to 'nearest declaration of this name anywhere in the file'. So `echo \"$SHARED\"` inside read_early at line 45, whose own assignment to SHARED is at line 46, resolves to line 37 — a declaration inside read_other, a function that has nothing to do with that read. Measured as the FIRST version of the rule's behaviour, not predicted: this is what ambiguous-target-resolution.sh asserted against and what made the scope chain necessary. Caught by that fixture's forbidRelationships on read_early targetLine 37.",
    apply: (src) => {
      const anchor = "    const scopes: string[] = useOwner === fileOwner ? [fileOwner] : [useOwner, fileOwner]"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "    const scopes: string[] = [fileOwner, useOwner]")
    },
  },
  {
    id: "bash/ambiguity-outward-walk-inverted",
    description:
      "Round 5 regression with the OPPOSITE failure, and the pair is the point: the chain is walked from the file inward, so a use inside a function resolves to the file-scope declaration even when the function declares the name itself. read_scope and read_other both answer 27 instead of 30 and 37. A fixture holding only ambiguous-target-resolution.sh's read_early row could not tell this apart from the correct rule, and one holding only the two innermostScope rows could not tell it apart from the no-chain rule; the file holds all three because the difference between them IS the finding. Caught by that fixture's expectRelationships on read_scope and read_other.",
    apply: (src) => {
      const anchor = "    const scopes: string[] = useOwner === fileOwner ? [fileOwner] : [useOwner, fileOwner]"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "    const scopes: string[] = useOwner === fileOwner ? [fileOwner] : [fileOwner, useOwner]")
    },
  },
  {
    id: "bash/ambiguity-publishes-a-line-when-it-cannot-pick",
    description:
      "Round 5 regression in the opposite direction to the two above: the 'declined to pick' branch stops declining and takes the nearest candidate anyway. This is the invented-attribution defect the whole mechanism exists to prevent — an edge naming one of several declarations and publishing its line as if it were the one, which is how a name collision becomes wrong refactoring advice. It is also the regression that a mutation of the HAPPY path cannot produce, since both other mutants lose resolution rather than fabricate it. Caught by ambiguous-target-resolution.sh's forbidRelationships, which assert targetLine 37 and 46 on read_early — neither of which the correct rule can produce.",
    apply: (src) => {
      const anchor = `    // The name IS declared in this file and none of it is in effect where this edge points.
    return "ambiguous"`
      if (!src.includes(anchor)) return null
      return src.replace(
        anchor,
        `    // ROUND-5 MUTANT: the outward walk is ended by a FALL BACK TO THE NEAREST CANDIDATE
    // ANYWHERE, which is the pre-scope-chain rule verbatim — the edge names one of several
    // declarations and carries its line as if it were the one in effect.
    const every = (cands ?? []).filter((c) => c.line <= useLine)
    if (every.length > 0) {
      const nearest = Math.max(...every.map((c) => c.line))
      const winner = every.find((c) => c.line === nearest)
      if (winner) return { line: winner.line, kind: winner.kind, owner: winner.owner, innermost: false }
    }
    return "ambiguous"`,
      )
    },
  },
  {
    id: "bash/order-dependent-attribution-second-pass-removed",
    description:
      "Round 6 regression, and the one class the 39 pre-existing mutants could not reach: every previous mutant removes, inverts or over-reaches a RULE, and this defect was a rule that was never ASKED the question. `resolveDeclaration` runs from inside the walk that emits the edges (the `uses` handler reads `declSites`, and `noteDeclaration` fills it later in the same traversal), so 'is this name declared more than once in this file?' was answered against a half-built index and a read early in a file was judged unambiguous. Measured on all 4,130 admitted files: 4,220 `uses` edges in 400 files named a target with 2+ declarations in their own file and published no `targetResolution`. Removing the post-walk pass restores exactly that. It is an OMISSION rather than a fabrication \u2014 nothing wrong is asserted, which is why no differential and no oracle could see it: the oracle never published target metadata at all. Caught by order-independent-attribution.sh, whose two expectRelationships are both bare before the fix and both attributed after it.",
    apply: (src) => {
      const anchor = "      if (meta.targetResolution !== undefined) continue // already decided in the walk"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "      if (meta.targetResolution !== undefined) continue\n      if (meta.targetResolution === undefined) continue")
    },
  },
  {
    id: "bash/order-dependent-attribution-second-pass-blanket-refusal",
    description:
      "Round 6 regression in the tempting direction: the second pass exists, so the corpus reads better, but it answers `ambiguousInFile` for every edge it revisits instead of re-running the scope rule. That passes the declined row of order-independent-attribution.sh and fails the resolved one, which is why that fixture asserts both directions \u2014 the cost of this mutant is that it converts every resolvable early read in the corpus into a refusal, and a refusal is indistinguishable from ignorance to a consumer walking the graph backwards. Caught by the `declares_in_own_scope_first` row asserting targetLine 44 and targetResolution innermostScope.",
    apply: (src) => {
      const anchor = `      const resolved = this.resolveDeclaration(
        declSites,
        String(rel.target ?? ""),
        String(rel.source ?? ""),
        rel.line_number,
        scriptName,
      )
      if (resolved) Object.assign(meta, resolved)`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "      Object.assign(meta, { targetResolution: \"ambiguousInFile\" })")
    },
  },
  {
    id: "bash/order-dependent-attribution-second-pass-drops-the-line",
    description:
      "Round 6 regression that keeps the pass and the refusal semantics but publishes the rule without the line, on the theory that the resolution RULE is the useful part and the line is recoverable by joining on name. It is not: the join is ambiguous by construction \u2014 that is the whole finding this lane measured 1,879 edges of \u2014 so an edge carrying `innermostScope` and no line names a scope and not a declaration. Caught by the `declares_in_own_scope_first` row asserting meta.targetLine 44.",
    apply: (src) => {
      const anchor = "      if (resolved) Object.assign(meta, resolved)"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "      if (resolved) { const { targetLine, targetKind, ...rest } = resolved; Object.assign(meta, rest) }")
    },
  },
  {
    id: "bash/trap-handler-call-classification-inverted",
    description:
      "Round 7 regression, and the shape a reader should expect from a two-site rule: the trap site sets `isFunctionCall: !isLocal`. Every trap-handler call then claims the OPPOSITE of the truth about itself — a handler calling a function this file declares is published as an external command, and `rm` is published as a local call. Nothing about the EDGE changes: same source, same target, same line, same 0.7 confidence. That is what makes it worth a mutant rather than a code read: the edge set is byte-identical, so no differential and no oracle can see it, and only the metadata assertion can. Caught by trap-handler-call-classification.sh, whose `cleanup`/`sync_now` rows assert isFunctionCall true and whose `rm` row asserts isFunctionCall false.",
    apply: (src) => {
      const anchor = `      const isLocal = ctx.localFunctions.has(firstToken)
      ctx.addRel(ctx.relSource(), firstToken, ASTEngine.RelationshipType.Calls, 0.7, nameLine, {
        isTrapHandler: true,
        viaTrap: true,
        isFunctionCall: isLocal,`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, anchor.replace("isFunctionCall: isLocal,", "isFunctionCall: !isLocal,"))
    },
  },
  {
    id: "bash/trap-handler-call-classification-hardcoded-local",
    description:
      "Round 7 regression in the direction that reads as an improvement: the trap site stops consulting the pre-pass and asserts every handler call is local, because a handler body usually calls the file's own cleanup. It is usually, not always — `trap 'rm -f \"$1\"' ERR` is a handler and `rm` is not declared anywhere, so this publishes an external command as resolving inside the file, which is the exact fabrication the flag exists to prevent and the one a consumer walking the graph forwards would act on. Caught by trap-handler-call-classification.sh's `rm` row, which asserts isExternalCommand true and resolvedWithinFile false.",
    apply: (src) => {
      const anchor = "      const isLocal = ctx.localFunctions.has(firstToken)"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "      const isLocal = true")
    },
  },
  {
    id: "bash/trap-handler-call-classification-removed",
    description:
      "Round 7 regression that restores the measured defect exactly: the three classification keys are dropped from the trap site, returning 223 corpus edges to the state `probe-bash-unresolved-targets.mts` measured — 123 of them naming a function their own file declares and arriving with no way to tell. This is the mutant that proves the new fixture pins the DEFECT rather than the fix: it is byte-identical to the pre-fix analyzer on these edges, so if the fixture passes against it the fixture is asserting nothing. Caught by all six expectRelationships of trap-handler-call-classification.sh.",
    apply: (src) => {
      const anchor = `        isTrapHandler: true,
        viaTrap: true,
        isFunctionCall: isLocal,
        isExternalCommand: !isLocal,
        resolvedWithinFile: isLocal,`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "        isTrapHandler: true,\n        viaTrap: true,")
    },
  },
  {
    id: "bash/ambiguity-published-on-every-edge",
    description:
      "Round 5 regression with no wrong output at all, which is why it is the payload mutant: the `cands.length < 2` guard is dropped, so targetLine and targetResolution are attached to every `uses` edge including the ones whose target is unique in the file. Every other assertion in ambiguous-target-resolution.sh still passes — the values are the same where they are emitted. What changes is cost: 80,851 `uses` edges on the whole corpus each grow up to three keys to state what the edge's target already stated, and the key's PRESENCE stops being the signal that the target was ambiguous. Caught by that fixture's two forbidRelationships on UNIQUE_ONLY_DECLARATION, which is declared exactly once and must carry no target metadata at all. The task's payload budget is why the absence rows exist rather than a count of them.",
    apply: (src) => {
      const anchor = "    if (!cands || cands.length < 2) return undefined // not ambiguous: nothing to add"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "    if (!cands || cands.length < 1) return undefined")
    },
  },
  {
    id: "bash/reserved-word-guard-removed",
    description:
      "M60 regression: `isCommandNameText` stops refusing a reserved word, so `if`/`then`/`fi`/`esac`/`case` read back out of a damaged region become call targets again — 30 fabrications in 2,945 `calls` edges on a 200-file hash-ordered sample (guard-ab-bash-calls.ts). Caught by reserved-word-not-a-call, whose forbidRelationships name each reserved word the corpus produced.",
    apply: (src) => {
      const anchor = `  if (SHELL_RESERVED_WORDS.has(text)) return false\n`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "")
    },
  },
  {
    id: "bash/reserved-word-table-emptied",
    description:
      "M60 regression with a different mechanism: the guard survives but SHELL_RESERVED_WORDS is emptied, so the check is live and answers no. This is the mutant a line-removal cannot produce, and it is the one that catches a table that drifted to empty — which is the shape a hand-maintained word list decays into. Caught by the same fixture.",
    apply: (src) => {
      const start = src.indexOf("const SHELL_RESERVED_WORDS = new Set([")
      if (start < 0) return null
      const end = src.indexOf("])", start)
      if (end < 0) return null
      return src.slice(0, start) + "const SHELL_RESERVED_WORDS = new Set([\n])" + src.slice(end + 2)
    },
  },
  {
    id: "bash/reserved-word-guard-over-refuses-builtins",
    description:
      "M60 over-reach: the guard is widened from reserved words to EVERY name in SHELL_BUILTINS, so a real call to a builtin is dropped. It exists to prove the fixture pins both directions — the guard must remove fabrications WITHOUT removing real calls, and this is the mutant that fails if the fixture only ever asserted the forbids. Caught by reserved-word-not-a-call's expectRelationships on `/usr/bin/true`, and by every other lane fixture that expects a builtin-adjacent edge.",
    apply: (src) => {
      const anchor = `  if (SHELL_RESERVED_WORDS.has(text)) return false\n`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, `  if (SHELL_RESERVED_WORDS.has(text) || SHELL_BUILTINS.has(text)) return false\n`)
    },
  },
  {
    id: "bash/arithmetic-guard-removed",
    description:
      "Pass-2 regression: `isArithmeticOperandCommand` stops refusing an arithmetic operand, so the two grammar misparse shapes publish `calls` edges to variables again — kubernetes/cluster/validate-cluster.sh:138 and kubernetes/third_party/gimme/gimme:551 on the 400-file census sample, both at confidence 1.0 with evidenceClass structural. Caught by arithmetic-operand-not-a-call, whose forbidRelationships name `attempt` and `force_known_update`, the two variables the corpus produced.",
    apply: (src) => {
      const anchor = `    if (this.isArithmeticOperandCommand(node)) {\n      return\n    }\n`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "")
    },
  },
  {
    id: "bash/arithmetic-guard-over-refuses-cmd-substitution",
    description:
      "Pass-2 over-reach, and the mutant that earns the guard's scoping: the guard is widened from 'a command_substitution that opens `$((`' to 'ANY enclosing command_substitution', so a real command substitution nested inside an arithmetic expansion loses its edge. `v=$(( $(wc -l < f) + 1 ))` really does execute wc. Caught by arithmetic-operand-not-a-call's expectRelationships on `calls: -> wc` at line 40 — the expectation that a fixture which only asserted the forbids would not have contained.",
    apply: (src) => {
      const anchor = `      if (cur.type === "command_substitution") return opensWithArithmeticExpansion(cur.text)\n`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, `      if (cur.type === "command_substitution") return true\n`)
    },
  },
  {
    id: "bash/case-arm-guard-removed",
    description:
      "Round-3 regression: `isCaseArmPatternCommand` stops refusing a command whose name is immediately followed by the `)` the grammar could not place, so the gimme case arm patterns come back — `calls` edges naming binary/git/auto, and, the half pass 2 never looked at, `imports` and `references` edges to `_try_existing`, a shell function defined at kubernetes/third_party/gimme/gimme:414. 5 fabrications in 1 file on both the 400- and the 1,200-file hash-ordered sample. Caught by case-arm-pattern-not-a-call, whose forbidRelationships name the four arm patterns and the function the dependency edges pointed at.",
    apply: (src) => {
      const anchor = `    if (this.isCaseArmPatternCommand(node)) {\n      patterns.add("Recovered Parse Region")\n      return\n    }\n`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "")
    },
  },
  {
    id: "bash/case-arm-guard-widened-to-any-damage",
    description:
      "Round-3 over-reach, and the mutant that earns the guard's POSITIONAL key: the check is widened from 'the child immediately after command_name is a damaged `)`' to 'the command has ANY direct ERROR/missing child', which is the guard E pass 1 measured and rejected for deleting 15 real `kube::log::status` calls in kubernetes/test/e2e_node/gubernator.sh. It exists to prove the fixture pins BOTH directions — the guard must remove fabrications without removing real calls — and it is the mutant that fails if the fixture only ever asserted the forbids. Caught by case-arm-pattern-not-a-call's expectations on `awk` (line 67, where `)` is an ordinary word argument and is a direct child of the command) and on `::log::status` (line 72, the V=2 assignment shape).",
    apply: (src) => {
      const anchor = `    if (after.type !== "ERROR" && !after.isMissing) return false\n    return after.text.charCodeAt(0) === 41 /* ) */\n`
      if (!src.includes(anchor)) return null
      return src.replace(
        anchor,
        `    for (let i = 0; i < node.childCount; i++) {\n      const c = node.child(i)\n      if (c && (c.type === "ERROR" || c.isMissing)) return true\n    }\n    return false\n`,
      )
    },
  },
  {
    id: "bash/case-arm-guard-keyed-on-command-name",
    description:
      "Round-3 over-reach with a different mechanism, and the one a position-based guard invites: the check stops keying on the damaged `)` and starts keying on the command's own NAME being `source` or `.`, which is the shape the defect presents but not the shape that causes it. A real `source ./lib.sh` — the most ordinary statement in the language — loses both its `imports` and its `references` edge. This is the mutant that catches a future 'simplification' of the guard into a name test, which the corpus A/B would not: on the census sample the only `source`-named damaged command IS the defect, so removing the guard by name loses nothing measurable and silently deletes every real `source` edge in the other 47 repositories. Caught by case-arm-pattern-not-a-call's expectations on `imports -> ./lib.sh` and `references -> ./other.sh`.",
    apply: (src) => {
      const anchor = `    const after = name.nextSibling\n    if (!after) return false\n    if (after.type !== "ERROR" && !after.isMissing) return false\n    return after.text.charCodeAt(0) === 41 /* ) */\n`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, `    const n = name.text\n    return n === "source" || n === "."\n`)
    },
  },
  {
    id: "bash/arithmetic-command-branch-removed",
    description:
      "Round 8 regression, and the exact defect round 8 closed: the arithmetic `compound_statement` clause is deleted from the dispatch, so `((count < limit))` names two variables and the graph mentions neither again. Measured cost of this mutation on the 400-file hash-order corpus sample: `uses` 7,856 -> 7,786, i.e. all 70 edges the round-8 prediction probe derived from the tree before the change. Caught by arithmetic-command-operands (lines 44, 46, 47, 48 and 53, and the `limit`/`arr` count rows) and by arithmetic-reads-gap-closure's count row, which was 2 before round 8 and is 3 after.",
    apply: (src) => {
      // The clause is preceded by its own comment block, so the anchor is located
      // and the `||` that joins it is found by walking BACK from it. Deleting the
      // clause alone leaves `… ||\n  )` , which is a syntax error rather than a
      // mutant — and a module that fails to load reports ERROR, not CAUGHT.
      const clause = `        (node.type === "compound_statement" && isArithmeticCompoundText(node.text))\n`
      const at = src.indexOf(clause)
      if (at < 0) return null
      const head = `        node.type === "c_style_for_statement" ||\n`
      const headAt = src.lastIndexOf(head, at)
      if (headAt < 0) return null
      return src.slice(0, headAt) + `        node.type === "c_style_for_statement"\n` + src.slice(at + clause.length)
    },
  },
  {
    id: "bash/arithmetic-command-predicate-inverted",
    description:
      "Round 8 regression in the OPPOSITE direction, and the pair is the point: the clause stays but its test inverts, so BLOCKS are read as arithmetic and real arithmetic commands are not. Every `while`/`for`/`if` CONDITION loses its operands — `(( count < limit ))` goes back to naming nothing — while every `{ … }` body, `do … done` body and `( … )` group is walked for reads it never contained. Caught by arithmetic-command-operands' line-44/48/53 rows (absent under the mutant) and by its `uses -> count` count row of 8.",
    apply: (src) => {
      const anchor = `        (node.type === "compound_statement" && isArithmeticCompoundText(node.text))\n`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, `        (node.type === "compound_statement" && !isArithmeticCompoundText(node.text))\n`)
    },
  },
  {
    id: "bash/arithmetic-operand-line-off-by-one",
    description:
      "Round 8 regression that no count can see: the clause survives and the predicate survives, but the operand is published one line off. Every assertion that counts edges still passes and the type is still right, so this is the class of defect that a census delta reports as healthy — the edge exists, points at the right name, and sits at a line where no `(( … ))` was written. `collectReadNames` reads the line off each `variable_name` node, so the mutation is made there. Caught by arithmetic-command-operands, whose rows pin `line_number` on all five arithmetic shapes (44, 45, 46, 47, 48) and on the two-line block case at 53/54.",
    apply: (src) => {
      const anchor = `        if (text.length > 0) out.push({ rawName: text, line: n.startPosition.row + 1 })\n`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, `        if (text.length > 0) out.push({ rawName: text, line: n.startPosition.row + 2 })\n`)
    },
  },
{
    id: "bash/calls-target-keeps-the-first-definition",
    description:
      "Round 11 regression, and the one the `overrides` edge made easy to write: the rule keeps the EARLIEST declaration at or before the call instead of the latest. `overrides` points BACKWARD — from a redefinition to the one it replaces — so \"the prior line\" is the right answer there, and copying that reflex into `calls` is wrong in the opposite direction. bash runs the most recent definition before the call, so a call after a redefinition reaches the SECOND one; this answers the first. Measured as the failure mode rather than predicted: 6 of 6 corpus `calls` edges that no published field could resolve were calls to a redefined name (kubernetes/third_party/gimme/gimme `_version_sort` at 125 and 127, called at 535/565/581). Caught by call-target-resolution's `run_after_both` row, which pins targetLine 28 and not 27.",
    apply: (src) => {
      const anchor = `    if (atOrBefore.length === 0) return { targetResolution: "declaredAfterUse" }
    const nearest = Math.max(...atOrBefore.map((c) => c.line))`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, `    if (atOrBefore.length === 0) return { targetResolution: "declaredAfterUse" }
    const nearest = Math.min(...atOrBefore.map((c) => c.line))`)
    },
  },
  {
    id: "bash/calls-target-decline-publishes-a-line",
    description:
      "Round 11 regression in the OPPOSITE direction to the one above, and the pair is the point: the `declaredAfterUse` branch stops declining and publishes the nearest declaration anyway. This is the invented attribution — an edge naming one of several declarations and publishing its line as if it were the one in effect — and it is the failure the two `uses` ambiguity mutants cannot produce, because theirs lose resolution rather than fabricate it. The corpus has no case of its own: the decline was unreachable until this round made it reachable, which is the same \"the instrument cannot see the class it was built for\" shape that cost this lane a surviving mutant in round 5, and it is why the fixture had to be given a name declared TWICE with both declarations below the call. Caught by call-target-resolution's forbidden row on `caller_before_any_definition` targetLine 112, plus its `declaredAfterUse` expect row.",
    apply: (src) => {
      const anchor = `    if (atOrBefore.length === 0) return { targetResolution: "declaredAfterUse" }`
      if (!src.includes(anchor)) return null
      return src.replace(
        anchor,
        `    if (atOrBefore.length === 0) {
      const nearest = Math.min(...cands.map((c) => c.line))
      const winner = cands.find((c) => c.line === nearest)
      return winner ? { targetLine: nearest, targetKind: winner.kind, targetResolution: "declaredAfterUse" } : { targetResolution: "declaredAfterUse" }
    }`,
      )
    },
  },
  {
    id: "bash/calls-attribution-dropped-for-unambiguous-names",
    description:
      "Round 11 regression that no count of edges can see and no count of files can see either: the ambiguity guard is dropped, so every `calls` edge whose target is a local function gains targetLine, targetKind and targetResolution. Edge counts are identical, evidenceClass is identical, the type is identical — the only change is three keys on 5,097 `calls` edges on this sample and 55,222 on the corpus, to say what the edge's target already said. This is the payload half of the incoming-edge work and the reason the fixture asserts an ABSENCE as a first-class row: `caller_of_unique` -> `only_declared_once` is declared once, so nothing may be published, and a consumer that filters on `targetResolution` would otherwise see a rule that fired everywhere.",
    apply: (src) => {
      const anchor = "    if (cands.length < 2) {\n      if (!collidesWithOtherKind) return undefined // unique name: nothing to add"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "    if (cands.length < 1) {\n      if (!collidesWithOtherKind) return undefined // unique name: nothing to add")
    },
  },
  {
    id: "bash/read-that-is-also-a-function-pass-removed",
    description:
      "Round 11 regression, and an OMISSION rather than a mis-rule: the pass that resolves a `$name` read when the file also declares `name` as a function is neutered, so those edges publish nothing again. `declSites` keys variables, aliases and locals and never functions, so a name declared as both looks unique to it while the published symbol table holds two declarations — and nothing wrong is asserted, the edge just names one of two by naming one. That is why no differential and no oracle could see it: neither publishes target metadata at all. Measured: 4 edges on the 400-file sample, all of the same shape (dart-sdk/pkg/vm/tool/shared_functions.sh:58 `host_arch` against function@7 and variable@56; consul/build-support/functions/10-util.sh:613 `ui_version` against function@597 and variable@612; ohmyzsh/plugins/rvm/rvm.plugin.zsh:34 `rubies` against function@9 and variable@16). Caught by call-target-resolution's `read_the_variable` row, whose targetResolution `readCannotBeAFunction` and targetLine 85 both disappear.",
    apply: (src) => {
      const anchor = "      if (!functionDeclLines.has(name)) continue // no function symbol, so no second candidate"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "      continue // no function symbol, so no second candidate")
    },
  },
  {
    id: "bash/calls-and-read-resolution-swapped",
    description:
      "Round 11 regression with a SIGN ERROR, and the only mutant here that can produce a published answer pointing at the wrong KIND of declaration. The `calls` pass is made to walk `uses` edges, so the function-resolution rule runs over a parameter expansion: `$shared_name` in a file that declares `shared_name` as both a function at 84 and a variable at 85 resolves to the FUNCTION at 84. The edge looks completely well-formed — right name, right line, real published symbol, a targetResolution value from this lane's own vocabulary — and it is wrong, because `$name` is a parameter expansion and a function is not reachable through it. This is why the fixture asserts the pair rather than one row: `read_the_variable` must reach the variable at 85 AND `call_the_function` must reach no line at all, and a single rule applied to both types passes whichever half it happens to get right.",
    apply: (src) => {
      const anchor = `    // ------------------------------------------- attribution, \`calls\` second pass`
      const start = src.indexOf(anchor)
      if (start < 0) return null
      const gate = src.indexOf("      if (rel.type !== ASTEngine.RelationshipType.Calls) continue", start)
      if (gate < 0) return null
      return (
        src.slice(0, gate) +
        "      if (rel.type !== ASTEngine.RelationshipType.Uses) continue" +
        src.slice(gate + "      if (rel.type !== ASTEngine.RelationshipType.Calls) continue".length)
      )
    },
  },
{
    id: "bash/exports-attribution-pass-removed",
    description:
      "Round 11 regression against a NINE-ROUND-OLD CLAIM, and the reason it is worth a mutant when the pass it removes only fires 29 times in 55,241 `calls` edges' worth of corpus. `exports` was recorded in rounds 5 and 9 as already disambiguated because the edge carries the declaration's line. It carries the `export` STATEMENT's line, which is the declaration's line only when the two are the same statement \u2014 and applying it to the published symbol table leaves 29 of 96 ambiguous `exports` edges with zero candidates corpus-wide. Removing the pass restores exactly that, and nothing else in the battery notices: the edge count, the type, the evidenceClass and the payload are all unchanged, and 67 of the 96 keep resolving by coincidence. Caught by call-target-resolution's `exports -> EXPORTED_NAME` row (targetLine 150, not the export statement's 159) and its forbidden row on 159.",
    apply: (src) => {
      const anchor = "      if (functionDeclLines.has(name)) continue // a function export: resolveFunctionTarget's question"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "      continue // a function export: resolveFunctionTarget's question")
    },
  },
  {
    id: "bash/exports-resolution-inverted",
    description:
      "Round 11 regression in the OPPOSITE direction on the same type, and the pair with the one above is the point: the scope walk on an `exports` edge is run from the file inward, so an `export` inside a function that declares the name itself resolves to the file-scope declaration instead of its own. The fixture holds both rows \u2014 the module-scope export at 159 resolving to 150, and the in-function export at 165 \u2014 and a walk that ignored scope entirely would answer 150 for both, so holding only the first row would let this through. Caught by call-target-resolution's expectRelationships.",
    apply: (src) => {
      const anchor = `      const resolved = this.resolveDeclaration(
        declSites,
        name,
        String(rel.source ?? ""),
        rel.line_number,
        scriptName,
      )`
      if (!src.includes(anchor)) return null
      return src.replace(
        anchor,
        `      const resolved = this.resolveDeclaration(
        declSites,
        name,
        scriptName,
        rel.line_number,
        String(rel.source ?? ""),
      )`,
      )
    },
  },
  {
    id: "bash/calls-name-collision-narrowing-removed",
    description:
      "Round 11 regression that only a WHOLE-CORPUS run can price: the `cands.length < 2` guard comes back without the name-collision case, so a `calls` edge whose target is declared as a function ONCE and also as a variable publishes nothing. Among function declarations the name is unique and the redefinition rule is right to decline \u2014 but the published symbol table still holds two declarations of the name, and a consumer matching reverse edges by target has two candidates. 105 whole-corpus edges have this shape (swift-nio/scripts/nio-diagnose:398 `nio_pids` against variable@136 and function@151; mvdan-sh/syntax/typedjson/testdata/roundtrip/file.sh `foo` against function@19 and variable@20) and the 400-file sample saw NONE of them, which is exactly why this file states the population from the --all run. Caught by call-target-resolution's `caller_of_both` and `call_the_function` rows, whose `commandNameIsAFunction` both disappear.",
    apply: (src) => {
      const anchor = `    if (cands.length < 2) {
      if (!collidesWithOtherKind) return undefined // unique name: nothing to add
      const only = cands[0]!
      return { targetLine: only.line, targetKind: only.kind, targetResolution: "commandNameIsAFunction" }
    }`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "    if (cands.length < 2) return undefined\n")
    },
  },
  {
    id: "bash/calls-narrowing-by-kind-dropped",
    description:
      "Round 11 regression in the OPPOSITE direction on the collision case, and it is the one that produces a published answer rather than a missing one: `collidesWithOtherKind` is computed and then ignored, so the collision rows fall back into the redefinition branch and a name with a single function declaration is resolved as if it had several. The observable damage is that `commandNameIsAFunction` \u2014 which says KIND decided the row \u2014 can never be published, so every consumer that filters candidates on kind silently has nothing to filter on for these edges and the two-candidate case returns. Caught by the same two rows as calls-name-collision-narrowing-removed, in the other direction: this one keeps a line and loses the value.",
    apply: (src) => {
      const anchor = "    const collidesWithOtherKind = namesWithNonFunctionDecl.has(name)"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "    const collidesWithOtherKind = false")
    },
  },
  {
    id: "bash/array-element-binding-branch-removed",
    description:
      "Round 12 regression, and the exact defect this round closed: the `subscript` arm of `extractAssignment`'s LHS read is deleted, so `arr[i]=v` publishes no declaration again. The grammar holds that LHS one level deeper than the bare case, as `subscript > variable_name`, and the arm is the only thing that reaches it. Caught by array-element-binding, whose expectSymbols name the element-bound arrays and whose `contains` rows name their lines.",
    apply: (src) => {
      const anchor = `      } else if (child && child.type === "subscript") {
        const base = child.namedChild(0)
        if (base && base.type === "variable_name") {
          nameNode = base
          elementAssignment = true
        }
      }`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, `      } else if (child && child.type === "__never__") {
      }`)
    },
  },
  {
    id: "bash/array-element-binding-deduped-by-name-alone",
    description:
      "Round 12 regression in the direction that ADDS edges, and the one that had already been written once by mistake — in this lane's own probe, which adjudicated element bindings on the bare NAME and so predicted 3 new symbols where the analyzer publishes 5. `declaredSymbols` keys on `${owner}\\u0000${name}`; dropping the owner from the lookup makes every element assignment after the first one in a file a fresh declaration, so `COMPREPLY=(a b)` at module scope followed by `COMPREPLY[i]=…` inside a function publishes the function-local array TWICE. Caught by array-element-binding's function-scoped COMPREPLY row and by its forbidSymbols `scoped`-in-`rewrite_completion`.",
    apply: (src) => {
      const anchor = "        const key = `${owner}\\u0000${nameNode.text}`"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "        const key = `${nameNode.text}`")
    },
  },
  {
    id: "bash/array-element-binding-is-array-false",
    description:
      "Round 12 regression that emits nothing wrong and asserts something wrong: the element-assignment arm is kept but `isArray` stops being set from it, so a name declared ONLY by `arr[i]=v` is published as a scalar. Nothing in the graph breaks — the symbol, its `contains` edge and every read of it are all still correct — and the flag is the only casualty, which is why this mutant exists at all: a metadata claim that nothing checks is a claim nothing can falsify. Caught by array-element-binding's isArray-bearing expectation for `NEVER_DECLARED`, declared only at line 20 by an element assignment.",
    apply: (src) => {
      const anchor = "        const isArray = elementAssignment || this.valueIsArray(node)"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "        const isArray = this.valueIsArray(node)")
    },
  },
  {
    id: "bash/bd11-flag-evaluated-during-the-walk-again",
    description:
      "Round 12 regression that restores the original defect in the shape it had: the post-walk pass is deleted and the predicate goes back into the emitter, where it can only see the declarations the walk has already passed. Every edge count is unchanged and every other metadata key is unchanged — the damage is one boolean that flips on 243 of 7,856 reads, and it flips in a direction a reader cannot detect. Caught by assigned-flag-is-file-level's three read-before-binding rows (`LATE`@30, `IMPLICIT_TARGET`@46, `SHADOWED`@55), which are exactly the rows that fail against the pre-fix analyzer and no others.",
    apply: (src) => {
      const anchor = `    const assignedNamesInFile = new Set<string>()
    for (const k of declaredSymbols) {
      const i = k.indexOf("\\u0000")
      if (i >= 0) assignedNamesInFile.add(k.slice(i + 1))
    }
    for (const rel of relationships) {
      if (rel.type !== ASTEngine.RelationshipType.Uses) continue
      const meta = rel.metadata as Record<string, unknown>
      if (meta.isAssignedInFile !== undefined) continue
      if (assignedNamesInFile.has(String(rel.target ?? ""))) meta.isAssignedInFile = true
    }`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "    // mutant: BD11's flag removed entirely")
    },
  },
  {
    id: "bash/bd11-flag-owner-stripping-dropped",
    description:
      "Round 12 regression in the pass's own logic, and the one whose symptom looks like a missing cross-scope case rather than a wrong flag. `declaredSymbols` keys are `${owner}\\u0000${name}`; stripping the owner is what lets a read inside a function reach a MODULE-level assignment, which is the case the contract's 'under any owner' clause exists for. Without the strip the lookup asks for `\\u0000NAME`, which no key can equal, so the flag is simply never set. Caught by assigned-flag-is-file-level's `LATE`@39 row (read inside `reads_module_late`, assigned at module scope) and by the `IMPLICIT_TARGET`@46 row, whose binding site is published at module scope too.",
    apply: (src) => {
      const anchor = '      if (i >= 0) assignedNamesInFile.add(k.slice(i + 1))'
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "      assignedNamesInFile.add(k)")
    },
  },
  {
    id: "bash/bd11-flag-emitted-unconditionally",
    description:
      "Round 12 regression in the OPPOSITE direction, and the one a fixture that only ever asserted the PRESENT case could not see. The pass sets the key on every `uses` edge instead of only where the file assigns the name, so `$FROM_THE_ENVIRONMENT` claims to be a project variable — the exact confusion BD11 was introduced to remove ('a consumer therefore had to guess whether $TMPDIR was a project variable it could not see or an environment-supplied one it never will'). It is the only mutant here that makes a published edge assert something FALSE rather than merely omit something. Caught by the two `meta.isAssignedInFile: null` rows in assigned-flag-is-file-level and by the ABSENT row in bash/assigned-in-file.",
    apply: (src) => {
      const anchor = `      if (assignedNamesInFile.has(String(rel.target ?? ""))) meta.isAssignedInFile = true`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "      meta.isAssignedInFile = true")
    },
  },
  {
    id: "bash/function-name-refused-in-damaged-file",
    description:
      "Round 13 regression, and the only mutant here that exists to REFUSE rather than to emit. Limitation 33 of docs/analyzers/bash.md asserted 'a damaged region publishes no declaration', and `functionName` reads the grammar's `name:` field with no condition on where that field resolves — so the property invites a guard that drops a function whose name is anywhere near a damaged region. Measured whole corpus (probe-bash-error-name-field.mts, 4,133 files): 427 of 6,773 function declarations (6.3%) have their name node inside a tree-sitter ERROR span, production parseFile publishes 427 of them, and ALL 427 are real declarations — the smallest plain-BASH instance is hledger/docker/run.sh:4, where `function usage()` is called from a case arm written `*)usage; exit 1 ;;`. So this mutant deletes 427 correct symbols corpus-wide while looking like care. THE FIRST VERSION OF THIS MUTANT WAS WRONG AND WAS CAUGHT BEING WRONG: it only added the ERROR-ancestor test to the FIELD read, and functionName's positional fallback then recovered the same name, so the mutation was a no-op and the battery stayed green. A guard that survives its own fallback is not the guard; this one refuses outright. Caught by function-declared-in-damaged-span, whose four functions all sit inside ONE ERROR node spanning rows 76-129 and whose expectSymbols require every one of them.",
    apply: (src) => {
      const a = `    const named = node.childForFieldName?.("name")
    if (named && named.text) return named.text`
      if (!src.includes(a)) return null
      // The helper is INJECTED rather than referenced, because the point of the
      // mutant is that the guard does not exist: a mutant calling a function the
      // analyzer has never had would not compile, and a mutation that does not
      // compile tests nothing.
      //
      // It returns "" rather than skipping the field. Skipping the field is NOT
      // the guard — `functionName` then falls through to its positional scan,
      // which reads the same name off the preceding `word` sibling and returns
      // it, so nothing is lost. A guard that its own fallback defeats is not a
      // guard, and writing it would have produced a mutant that passed for the
      // wrong reason.
      const helper = `
/** ROUND-13 MUTANT: the guard limitation 33's property invites. */
function __r13_hasErrorAncestor(n: any): boolean {
  let c = n?.parent
  while (c) {
    if (c.type === "ERROR") return true
    c = c.parent
  }
  return false
}
`
      return src
        .replace(
          a,
          `    const named = node.childForFieldName?.("name")
    if (named && named.text) return __r13_hasErrorAncestor(named) ? "" : named.text`,
        )
        .replace("export class RealBashAnalyzer", `${helper}\nexport class RealBashAnalyzer`)
    },
  },
  {
    id: "bash/external-collision-label-removed",
    description:
      "Round 15 regression in the direction of the PREVIOUS code, and the one that reproduces the defect verbatim: the collision branch is emptied, so the `calls` attribution pass goes back to skipping every edge whose `isFunctionCall` is not true \u2014 the original \"an external binary names nothing local\". The two edges it loses are ohmyzsh/plugins/pip/pip.plugin.zsh:107 and :115, both `-[calls]-> xargs` against `variable@106` and `variable@114`, which is the whole measurement the change was made for: at whole corpus the bare-ambiguous `calls` cell goes from 3 back to 5. Caught by external-command-name-collision's `xargs` and `ripgrep` rows, whose targetResolution and collidesWithLocalDeclaration both disappear.",
    apply: (src) => {
      const anchor = `        if (meta.commandInErrorRecovery === true) {
          if ((declSites.get(String(rel.target ?? ""))?.length ?? 0) >= 2) meta.targetResolution = "ambiguousInFile"
          continue
        }
        const name = String(rel.target ?? "")
        if (!namesWithNonFunctionDecl.has(name)) continue // truly external: nothing local to confuse
        meta.targetResolution = "commandNameIsExternal"
        meta.collidesWithLocalDeclaration = true
        continue`
      if (!src.includes(anchor)) return null
      return src.replace(
        anchor,
        `        if (meta.commandInErrorRecovery === true) {
          if ((declSites.get(String(rel.target ?? ""))?.length ?? 0) >= 2) meta.targetResolution = "ambiguousInFile"
          continue
        }
        continue`,
      )
    },
  },
  {
    id: "bash/external-collision-label-on-every-external-command",
    description:
      "Round 15 regression in the OPPOSITE direction, and the one that turns a correctness fix into a payload regression. The `namesWithNonFunctionDecl` test is dropped, so the label is published on EVERY external command: whole corpus that is 56,217 `calls` edges each carrying two keys, to say on the overwhelming majority of them what the edge's target already said. bb_graph's un-narrowed default is measured at 2.5-4.8x a kind-filtered answer, so this is the failure mode the incoming-edge requirement turns into a slow reverse walk. Caught by external-command-name-collision's ABSENT row on `curl` \u2014 an ordinary external command with no local declaration of that name \u2014 which a fixture asserting only the PRESENT case cannot catch.",
    apply: (src) => {
      const anchor = "        if (!namesWithNonFunctionDecl.has(name)) continue // truly external: nothing local to confuse"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "        if (name.length === 0) continue")
    },
  },
  {
    id: "bash/external-collision-label-ignores-is-function-call",
    description:
      "Round 15 regression on the mutual exclusion, and the one that publishes a WELL-FORMED WRONG row rather than omitting anything. The `isFunctionCall !== true` guard is widened so the collision branch also runs for calls to functions declared in the file, so a name declared as BOTH a variable and a function gets `commandNameIsExternal` on the call edge as well as its function resolution. In command position the function wins \u2014 bash resolves the name as a function, never as a variable \u2014 so the two labels answer opposite questions and both cannot be true of one edge. Caught by external-command-name-collision's FORBID row on `greet`, which declares the shape a blanket 'publish the collision wherever a local name exists' rule gets wrong while passing every other row in the file.",
    apply: (src) => {
      const anchor = "      if (meta.isFunctionCall !== true) {"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "      if (true) {")
    },
  },
  {
    id: "bash/external-collision-label-ignores-error-recovery",
    description:
      "Round 15 regression on the boundary, and the only one here that dresses WRECKAGE up as a decision. The `commandInErrorRecovery` check is dropped while the collision test stays, so an edge whose command node sits inside a tree-sitter ERROR subtree is published as reaching an external binary. Whole corpus that is 3 edges \u2014 `calls -> key` (Paket/completion/paket-completion.zsh:1486) and `calls -> name` twice (kubernetes/cluster/gce/util.sh:3829/:4057) \u2014 where a word from the middle of an unclosed statement became the command name. The flag is NOT a guard on the edge: suppressing on it would delete 2,891 + 19 whole-corpus `calls` edges carrying real `setopt`/`print`/`echoti`/`autoload`/`emulate`/`title`/`terminal-notifier`/`notify-send` work to remove those 3, which is why the flag is published instead. Caught by external-command-name-collision's `key` row, which asserts the FLAG is present, and its FORBID row on the same edge, which asserts the label is NOT.",
    apply: (src) => {
      const anchor = `        if (meta.commandInErrorRecovery === true) {
          if ((declSites.get(String(rel.target ?? ""))?.length ?? 0) >= 2) meta.targetResolution = "ambiguousInFile"
          continue
        }`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "        // ROUND-15 MUTANT: the position flag is no longer consulted.")
    },
  },
  {
    id: "bash/error-recovery-flag-inverted",
    description:
      "Round 15 regression on the flag itself, and it is the only mutant here that tests a NEW predicate rather than a new branch. `isInsideErrorNode` returns the INVERSE, so edges inside a damaged span are published unlabelled and all 53,271 clean `calls` edges at whole corpus are labelled `commandNameIsExternal`. The distinction the fixture depends on is a POSITION fact and inverting it is invisible to any assertion about a clean edge \u2014 so this dies on the `xargs` rows, which are clean nodes and must carry the label.",
    apply: (src) => {
      const anchor = `  private isInsideErrorNode(node: Node): boolean {
    for (let cur: Node | null = node.parent; cur; cur = cur.parent) {
      if (cur.type === "ERROR") return true
    }
    return false
  }`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, anchor.replace("if (cur.type === \"ERROR\") return true", "if (cur.type !== \"ERROR\") return true"))
    },
  },
  {
    id: "bash/overrides-line-is-first-declaration",
    description:
      "Round 17 regression, reproducing the pre-fix behaviour EXACTLY rather than paraphrasing it: the trailing unconditional write is moved onto the branch that emits no edge, which is byte-for-byte what the old code did — record the first declaration, never advance. `overridesLine` then names the FIRST declaration of a name instead of the one in effect. This is the defect a two-declaration fixture cannot catch, because for two declarations the first and the immediately-prior are the same row. Measured on the 600-file sample it left 21 of 30 ambiguous `overrides` edges naming an earlier declaration, every one of them naming a line that IS a real declaration of the name, so nothing about the edge looked malformed. Caught by overrides-prior-line's forbid rows pinning the wrong answer 23 on the third and fourth `f`, and NOT by redefinition-overrides.sh, whose two rows pass under both readings — which is the reason this fixture exists.",
    apply: (src) => {
      const tail = `          }
          // Set UNCONDITIONALLY, after the edge: the next declaration of this name
          // must find the one in effect, which is this one. Writing it only on the
          // branch that emitted no edge would freeze the map at the first
          // declaration forever, which is the defect this line replaced.
          functionPriorDeclaration.set(name, node.startPosition.row + 1)`
      if (!src.includes(tail)) return null
      return src.replace(
        tail,
        `          } else {
            // ROUND-17 MUTANT: the pre-fix shape — the map is written only when no
            // edge was emitted, so it holds the FIRST declaration forever.
            functionPriorDeclaration.set(name, node.startPosition.row + 1)
          }`,
      )
    },
  },
  {
    id: "bash/overrides-line-is-the-declaration-itself",
    description:
      "Round 17 regression in the OPPOSITE direction, and the one that makes the chain-only fixture insufficient on its own: the map is advanced BEFORE the edge is emitted, so `overridesLine` names the declaration the edge itself is published at. Every `overrides` edge then claims to override itself. Measured over the whole corpus that is every ambiguous `overrides` edge, and unlike the defect above it is wrong even for a name declared TWICE — so `redefinition-overrides.sh` catches this one and overrides-prior-line's `g` control is redundant here by design. Caught by redefinition-overrides and by overrides-prior-line's two self-reference forbid rows.",
    apply: (src) => {
      const anchor = "          const prior = functionPriorDeclaration.get(name)"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "          functionPriorDeclaration.set(name, node.startPosition.row + 1)\n" + anchor)
    },
  },
  {
    id: "bash/overrides-line-never-recorded",
    description:
      "Round 17 regression that removes the binding outright rather than misplacing it: the map is never written, so `overridesLine` is absent and the edge's two endpoints are both the bare name with nothing to tell them apart. This is the shape a consumer faces when it cannot re-derive the binding — `greet -> greet` at two lines with no disambiguator. It passes the OLD redefinition-overrides fixture's positive rows, since `expectRelationships` treats unspecified fields as wildcards, which is why it is in this file rather than inferred absent from the pre-fix run. Caught by overrides-prior-line's `meta.overridesLine` rows, all five of which pin a value.",
    apply: (src) => {
      const anchor = "          functionPriorDeclaration.set(name, node.startPosition.row + 1)"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "          // ROUND-17 MUTANT: the prior declaration is never recorded.")
    },
  },
]



const original = readFileSync(SOURCE, "utf8")

// ---------------------------------------------------------------- control
process.stdout.write("control — unmutated analyzer through the shared runner\n")
const control = await runLang("bash")
process.stdout.write(`  pass ${control.pass} fail ${control.fail}\n`)
if (control.fail > 0) {
  for (const d of control.details.filter((d: any) => !d.ok)) process.stdout.write(`  FAILING FIXTURE: ${JSON.stringify(d)}\n`)
  process.stdout.write("\n>>> The control is red, so every mutant verdict below would be meaningless. Stopping.\n")
  process.exit(2)
}

// ---------------------------------------------------------------- mutants
const rows: { id: string; status: string; detail: string }[] = []
for (const m of MUTANTS) {
  const mutated = m.apply(original)
  if (mutated === null) {
    rows.push({ id: m.id, status: "ERROR", detail: "the anchor text is not present in src/ast/real-bash-analyzer.ts — the mutant does not apply to this source" })
    continue
  }
  if (mutated === original) {
    rows.push({ id: m.id, status: "ERROR", detail: "the mutation produced byte-identical source" })
    continue
  }
  writeFileSync(MUTANT_PATH, mutated)
  let analyzer: any
  try {
    const mod: any = await import(`${MUTANT_PATH}?v=${encodeURIComponent(m.id)}`)
    analyzer = new mod.RealBashAnalyzer()
  } catch (e: any) {
    rows.push({ id: m.id, status: "ERROR", detail: `mutant module failed to load: ${e?.message ?? String(e)}` })
    continue
  }
  const res = await runLang("bash", analyzer)
  const failing = res.details.filter((d: any) => !d.ok).map((d: any) => d.fixture)
  rows.push({
    id: m.id,
    status: res.fail > 0 ? "CAUGHT" : "SURVIVED",
    detail: res.fail > 0 ? `${res.fail} fixture(s) failed: ${failing.slice(0, 4).join(", ")}` : "the fixture battery stayed green — the mutant is not covered",
  })
}

if (existsSync(MUTANT_PATH)) unlinkSync(MUTANT_PATH)

process.stdout.write("\nmutants\n")
for (const r of rows) process.stdout.write(`  ${r.status.padEnd(9)} ${r.id}\n            ${r.detail}\n`)
const survived = rows.filter((r) => r.status === "SURVIVED").length
const errored = rows.filter((r) => r.status === "ERROR").length
process.stdout.write(`\n${rows.length} mutants, ${rows.length - survived - errored} caught, ${survived} survived, ${errored} did not apply\n`)
process.exitCode = survived + errored === 0 ? 0 : 1