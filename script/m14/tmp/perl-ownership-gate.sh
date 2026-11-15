#!/usr/bin/env bash
# PERL-OWNERSHIP GATE — fires at COMMIT time, on the perl lane's CONTENT.
#
# WHY THIS EXISTS, and why it is not the same thing as perl-head-gate.sh
# ------------------------------------------------------------------------
# `perl-head-gate.sh` checks out HEAD and re-runs the lane's gates there. It is
# thorough — it caught every instance of the failure below — and it is a DETECTOR.
# Nothing runs it when a commit is made, so the sequence is always the same:
#
#   1. perl work is committed, correctly, and verified
#   2. a later commit rebuilds a shared file from a base older than that work
#   3. the perl content is gone; every gate that ran in the worktree is still green
#   4. the head gate eventually goes red and the work is re-applied
#
# That happened three times in one session, to five files, and one of them put
# THREE REGEX LITERALS back into a lane whose contract is zero regex literals.
#
# The trap that made it survive is worth stating, because it is the part that
# looks like a safeguard and is not: `git merge-base --is-ancestor <my-commit>
# HEAD` returned TRUE for every one of the five. The commits ARE in the history.
# Their CONTENT was undone by a later commit that rewrote the file. So an
# ancestry check is not a content check, and a rebase-conflict resolution or a
# "restore the file as I found it" habit both pass it.
#
# So this gate asks a different question, and the answer has to be cheap: does the
# working tree still CONTAIN each perl-owned invariant, as a named assertion
# rather than as a whole suite run? It is designed to run in under a second, so it
# can be a pre-commit or a CI step, unlike the head gate's minutes.
#
# Every row below is a defect this lane actually shipped and then lost. The
# wording is deliberately specific enough that a plausible re-implementation fails
# it: a rule that only the original spelling satisfies is a rule that a rewrite
# cannot silently satisfy by accident.
#
# usage: bash script/m14/tmp/perl-ownership-gate.sh [--quiet]
#   exit 0 iff every invariant holds. Prints each row and why it exists.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

pass=0
fail=0

# row <id> <description> <shell-snippet>
row() {
  local id="$1" why="$2" snippet="$3" out rc
  out="$(eval "$snippet" 2>&1)"; rc=$?
  if [ $rc -eq 0 ]; then
    pass=$((pass + 1))
    [ "$QUIET" -eq 1 ] || printf '  pass %-26s %s\n' "$id" "$why"
  else
    fail=$((fail + 1))
    printf '  FAIL %-26s %s\n' "$id" "$why"
    [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/          /'
  fi
}

echo "perl ownership gate — perl-owned CONTENT, not perl-owned commits"

# DESCRIPTIONS ARE DISPLAY TEXT, SO THEY CARRY NO BACKTICKS (fixed 2026-10-08).
# The two MR4 rows spelled the fat comma as a backticked `=>` inside a
# double-quoted description, and bash reads a backtick there as a COMMAND
# SUBSTITUTION: the run printed `syntax error near unexpected token '=>'` twice,
# those two rows never executed, and the tally came back short. Any future
# description that wants to quote code must use plain words — a description reaches
# the terminal, not a shell.
row has-receiver-qualification \
  "a calls target carries its owner when the source proves one (PERL-MR11)" \
  'grep -q "provableClass" src/ast/real-perl-analyzer.ts && grep -q "perl: \"mojo\"" script/m14/differential.ts'

row has-written-callee-rule \
  "a callee that is CODE is not published as a NAME (PERL-MR12)" \
  'grep -q "isWrittenCalleeName" src/ast/real-perl-analyzer.ts && grep -q "isWrittenName" script/m14/differential.ts'

row has-name-line-rule \
  "an edge line is the line that NAMES it, for the two labels with no node in hand (#921)" \
  'grep -q "nameLineOf" src/ast/real-perl-analyzer.ts && grep -q "lineOfNameWithin" src/ast/real-perl-analyzer.ts'

row has-per-parent-base-lines \
  "an extends edge claims the line its base NAME is on, not the use keyword line" \
  'grep -q "parentLines" src/ast/real-perl-analyzer.ts'

# The one that must never be negotiable, and the row this gate got WRONG first.
#
# The first version grepped for a bracket-class literal. It reported a violation on
# a clean tree, and the match was a COMMENT in the analyzer explaining that a single
# `const IDENT = /[A-Za-z0-9_]/` would be shorter and would put the lane back in
# violation. The AST instrument, which is the authoritative check, reported 0 regex
# literals on that same file.
#
# So this row now calls the AST scanner: slower by seconds, and the only thing that
# can tell a regex in code from the same characters inside a comment. The lane's own
# documentation says the same thing — counting regex literals is not the metric,
# regexes doing SYNTAX work are, and a grep cannot tell them apart — and a gate that
# violates its own lane's rule is worse than none, because it trains its reader to
# ignore it.
row zero-regex-in-analyzer \
  "ZERO regex literals in the perl analyzer, by AST scan and not by grep" \
  'bun script/m14/tmp/perl-zero-regex.mts 2>&1 | grep -q "^PASS working-tree-ast-scan" && grep -q "isPerlIdentStart" src/ast/real-perl-analyzer.ts'

row spec-classifies-error \
  "the completeness spec classifies ERROR and MISSING (170 types, not 168)" \
  'grep -q "\"ERROR\"" script/m14/spec/perl-completeness.json && grep -q "\"MISSING\"" script/m14/spec/perl-completeness.json'

row fixture-has-seven-shapes \
  "the receiver fixture 7th shape, a symbolic deref, is still in the file" \
  'grep -q "next_tick" validation/m14/fixtures/perl/receiver-qualification.pm && grep -q "targetEndsWith" validation/m14/fixtures/perl/receiver-qualification.expectation.json'

row fixture-pins-the-line \
  "the contains and overrides pins assert a LINE, not the old null contract" \
  '! grep -q "\"line_number\": null" validation/m14/fixtures/perl/core-oo-class-role.expectation.json && ! grep -q "\"line_number\": null" validation/m14/fixtures/perl/inheritance.expectation.json'

row differential-oracle-present \
  "the perl independent oracle is present in the differential" \
  'grep -q "export function derivePerlEdges" script/m14/differential.ts'

row differential-labels-audited \
  "perl is in the differential calls AND contains audited sets, or every truth row reads MISSING" \
  'grep -qE "lang === \"perl\" \? \[\"contains\"\]" script/m14/differential.ts && grep -qE "lang === \"perl\" \? \[\"calls\"\]" script/m14/differential.ts'

row differential-corpus-mapped \
  "LANG_REPOS and SECOND_CORPUS both name perl, or the lane measures one corpus and reports two" \
  'grep -q "perl: \"mojo\"" script/m14/differential.ts && grep -q "perl: \"plack\"" script/m14/differential.ts'

row scoped-pin-reachable \
  "--pin-baseline is ACCEPTED and REACHES the pin from a scoped run" \
  'grep -q "PIN_BASELINE_FROM_SCOPE" script/m14/differential.ts && grep -q "if (PIN_BASELINE_FROM_SCOPE)" script/m14/differential.ts'

row six-line-contract-mutants \
  "every PERL line-contract and companion mutant is in the mutation harness" \
  'n=$(grep -c "id: \"perl/" script/m14/mutate-analyzer.ts); [ "$n" -ge 33 ] && for m in contains-line-is-absent contains-line-at-declaration-start overrides-line-is-absent extends-line-at-the-use-keyword role-composition-line-at-the-with-keyword symbolic-deref-callee-published-as-a-name partial-companion-deletes-guesses; do grep -q "perl/$m\"" script/m14/mutate-analyzer.ts || exit 1; done'

# PERL-MR14's guard is the one most likely to be "simplified" back, because the
# shorter form reads more naturally and the branch has no production caller yet —
# which is exactly how the wrong one survived. The row pins the LONG form.
row companion-guard-asks-about-this-base \
  "a companion that has never heard of a base leaves the guess ALONE, it does not delete it (PERL-MR14)" \
  'grep -q "overrideCompanion?.has(base) && !context?.overrideCompanion?.has(baseLeaf)" src/ast/real-perl-analyzer.ts'

# PERL-MR4. Every rule here was derived by comparing this lane's emissions under
# BOTH grammar generations, and all three live in files a stale-base commit has
# rebuilt before. Two were reverted in the WORKTREE while their commits sat in
# history as ancestors -- once for the differential's Perl oracle and once for
# these very rows -- so these check the rules are present in the CONTENT, never in
# the ancestry.
row mr4-fat-comma-specification \
  "a top-level fat comma in a use argument list means specification, not an item list" \
  'grep -q "isArgumentSpecification" src/ast/real-perl-analyzer.ts'

row mr4-specification-scoped-to-imports \
  "the fat-comma rule is applied at the import site, not inside the shared word harvester" \
  'grep -q "args.length > 0 && !isArgumentSpecification(node)" src/ast/real-perl-analyzer.ts'

row mr4-code-is-not-names \
  "conditional branches and call arguments are computed values, not imported names" \
  'grep -q "conditional_expression" src/ast/real-perl-analyzer.ts && grep -q "function_call_expression" src/ast/real-perl-analyzer.ts'

row mr4-grammar-types-verified \
  "every node type the import rules name is a LIVE type in the wired grammar, and none of the seven invented ones survives" \
  'for t in conditional_expression function_call_expression method_call_expression func0op_call_expression func1op_call_expression coderef_call_expression ambiguous_function_call_expression lowprec_logical_expression logical_not_expression anonymous_subroutine_expression; do grep -qw $t src/ast/real-perl-analyzer.ts || exit 1; done; for t in fat_comma anon_sub match_expression list_call_expression list_operator_expression function_call_list_expression; do ! grep -qE "type === .$t." src/ast/real-perl-analyzer.ts || exit 1; done'

row mr4-no-dead-2-0-0-branches \
  "the wired build carries no branch for a 2.0.0-only node type; the bump requirement is recorded instead" \
  '! grep -qE "type === \"parenthesized_expression\"" src/ast/real-perl-analyzer.ts && grep -q "PERL-MR4" reviews/perl/master-review.md'

row mr4-fixture-present \
  "the fixture pinning all four MR4 rules and the both-grammars agreement is committed" \
  'test -f validation/m14/fixtures/perl/import-argument-items.pm && test -f validation/m14/fixtures/perl/import-argument-items.expectation.json'

row mr4-mutants-present \
  "each MR4 rule has a mutant reproducing its pre-fix behaviour" \
  'for m in perl/import-harvests-fat-comma-payload perl/import-harvests-conditional-branch perl/import-drops-parenthesized-args perl/import-harvests-call-format-string; do grep -q "$m" script/m14/mutate-analyzer.ts || exit 1; done'

# PERL-MR15. The override companion had a builder, a context channel and a
# correct resolver, and NO CALLER -- so 75.6% of this lane's overrides edges were
# false and nothing in the run could see it. These rows assert the CALLER exists,
# which is the part that was missing, and the part a stale-base rebuild of
# parallel-indexer.ts would drop silently: that file is 5,200 lines of shared hot
# path and this lane's hunks have been reverted five times this session.
row mr15-companion-module-present \
  "the production pass that builds the companion is committed" \
  'test -f src/ast/override-companion-pass.ts && grep -q "populateOverrideCompanion" src/ast/override-companion-pass.ts'

row mr15-companion-wired \
  "the indexer CALLS the pass between the parse and the store" \
  'grep -q "populateOverrideCompanion" src/ast/parallel-indexer.ts'

row mr15-wired-before-store \
  "the pass runs while FileResult.symbols is still in memory, not after the store" \
  'awk "/populateOverrideCompanion/{f=NR} /phases.parseMs = Date.now\(\) - parseStart/{t=NR} END{exit !(f>0 && f<t)}" src/ast/parallel-indexer.ts'

row mr15-scoped-to-perl \
  "the pass is language-scoped, so no other lane\u0027s pinned baseline moves" \
  'grep -qE "language: .perl." src/ast/parallel-indexer.ts'

row mr15-failure-is-not-fatal \
  "a companion that cannot be built leaves the completed index intact" \
  'grep -q "must never turn a completed index" src/ast/parallel-indexer.ts'

row companion-measured \
  "the cross-file override companion has a measured size, not just a rule" \
  'test -f script/m14/tmp/perl-override-companion.mts && grep -q "withdrawn" script/m14/tmp/perl-override-companion.mts'

row instrument-present \
  "the line oracle that found all of this is committed" \
  'test -f script/m14/tmp/perl-lineoracle.mts'

row evidence-current \
  "the machine-evidence artifact records 0 failures" \
  'test -f validation/m14/results/M14.6.perl.json && ! grep -q "\"status\": \"fail\"" validation/m14/results/M14.6.perl.json'

echo ""
if [ "$fail" -gt 0 ]; then
  echo "PERL OWNERSHIP GATE FAILED — $fail of $((pass + fail)) invariants absent."
  echo "  These are not new defects: each row is a rule this lane shipped, lost to a"
  echo "  stale-base rebuild, and re-applied. If a commit of yours rebuilt one of these"
  echo "  files, the fix is to re-apply the perl hunk — not to re-derive the rule."
  exit 1
fi
echo "PERL OWNERSHIP GATE PASS — $pass/$pass invariants present."
