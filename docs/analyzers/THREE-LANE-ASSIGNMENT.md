# The three lanes assigned to this agent: powershell · solidity · haskell

**Reconstructed 2026-10-28 from disk, git history and the working tree — not from conversation.**
This file exists so the assignment survives a compaction or a restart. If it disagrees with the
tree or `git log`, the tree and `git log` win; update this file to match.

**Allowed scope: these three lanes and nothing else.** Other uncommitted changes in the working
tree (julia, vb, python, the incoming-gate, etc.) belong to other lanes/agents. Do not edit,
revert, commit or "clean" them. Within these three lanes the lane-owned files are the
`src/ast/real-<lang>-analyzer.ts`, `docs/analyzers/real-<lang>-analyzer.md`,
`script/m14/spec/<lang>-completeness.json`, `script/m60/<lang>-*.ts` and
`validation/m14/fixtures/<lang>/`. Shared machinery (`script/m14/differential.ts`,
`incoming-gate.ts`, `incoming-rule.ts`, `validation/m14/results/*`) is Lead-owned: report a
need, do not take it.

## The bar each lane is measured against

Per lane, the 14 relationship types the language can express: each is either

- **EMITTED** — production `parseFile` produced it on the whole admitted corpus, with a count
  and the files it came from; or
- **RULED** — a named reason AND a corpus measurement (with a falsifier that can fire) showing
  the construct does not occur; or
- **GAP** — implement it.

Then the four clauses: every edge resolves or carries a verifiable claim; every ambiguous or
unresolved edge is classified by a named cause with a measured count; each cause fixed over the
same population or ruled with a runnable falsifier; `extFAIL / bindFAIL / causeFAIL = 0`.
"Resolved, not ruled" is the standard. A fixture suite is not evidence of a lane; the arm is.

## What "done" means, exactly

**The honesty contract bans unscoped "complete", "fully done" and "perfect".** A claim is scoped
or it is false (`docs/M14-HONESTY-CONTRACT.md` §1). "Done" is not a word an agent says; it is a
verdict the gate emits, and the Lead must be able to reproduce it.

The completion gate checks, per lane:

- **implemented** — every applicable type is implemented, `n/n` by the coverage gate;
- **whole-population** — the declaration names parsed/admitted, closure and cause rulings;
- **resolved** — per-type closure: every edge in exactly one declared class, with counts;
- **walls-dispositioned** — every remaining wall has a named cause, a measured count and a
  runnable falsifier;
- **fixtures** — the lane's suite passes both ways (a suite that cannot fail proves nothing);
- **no-regex** — no regex literal in the analyzer.

`validation/m14/verification/ALL-OUT-OF-ALL-PROGRAMME.md` §9.1 states the fuller six-clause bar
(D1–D6): the **applicable set** from the language (with an implementation site and a fixture that
can go RED); **whole-population emission** (rows + files + repos, or a counted ruling — a cap-50
stride is triage, never the number); **resolution truth** (one whole-population incoming-gate run,
every edge in exactly one declared class, no unclassified residual, `extFAIL/bindFAIL/causeFAIL=0`);
**audit** (every emitted label differential-derived and admitted to the compared set, both halves
same commit); **permissions** (fixtures, docs/head comment, spec table, no-regex, perf, typecheck);
**truthfulness** (`arbitraryTwin`/`extFAIL` not risen against baseline, claims never merged into
resolutions, every number carries its command and scope, negative results written down).

**Outgoing** means the analyzer emits every applicable relationship type on the production path.
**Incoming** means every emitted edge resolves to exactly one declaration or carries a claim the
project verifies. Both are part of done; coverage alone is not.

## Grammar remedy — ruling is the last resort

Owner ruling L-2026-10-21-14, codified in `script/m14/grammar-remedy.ts`: **a lane owns the grammar
for its language the way it owns the analyzer.** The grammars can be cloned, fixed, generated and
built; the objective is all applicable relationship types, not a tidy exclusions table.

```
R1  bump to a published build whose inventory HAS the construct
R2  clone + patch the grammar source, `tree-sitter generate`, `tree-sitter build --wasm`
R3  implement the construct with an EXISTING node type (no grammar change)
```

**`grammar-absence` is a REMEDY DISPOSITION, not a terminal class.** An exclusion is legitimate
only when the language cannot express the construct — a grammar patch would invent syntax or
semantics it does not have — or after the ladder has been walked and measured. A construct that
exists but occurs 0 times in the corpus is `zero-sites`: it stays in the denominator as
unexercised, it is not excluded. A remedy is proven by measurement, not a node list: the new build
against the old, a behavioural fixture whose edge exists only when the construct reaches the
analyzer as a real node, the `idOrderDigest` identity between wired bytes and source, and the
patch recorded in the lane's `PIN.md`/`PROVENANCE.md`.

**Consequence for this assignment:** the three lanes' current exclusions are not accepted merely
because the packaged grammar lacks a node. Each is re-audited through R1 → R2 → R3 before it is
ruled, and the only exclusions that survive are ones where the language itself has no construct
(e.g. a host renderer/component model that does not exist; member-set composition the language
does not perform). "The grammar we happen to ship has no node for it" is a reason to clone the
grammar, not a reason to rule.

## Status, with the artifact each number comes from

### powershell — committed DONE, then a later uncommitted depth pass

- Commit `ac26ed382` — whole-population declaration; the lane reads DONE by the completion gate.
  11 implemented + 3 excluded (`decorates`, `renders`, `mixes_in`) = 14 applicable.
- Arm: **1,181 of 1,181** admitted files, **30 repositories**, 179,957 edges, 0 unclassed;
  84,901 resolved · 16,184 ambiguous · 27,801 external · 51,071 otherUnresolved. The declaration
  charges its own 85 refuted claims and declares `renders`/`mixes_in` as measured zeros.
- The lane's findings beyond coverage: the fleet's first and second refuted-claim incidents
  (`POWERSHELL-VERDICT-2026-10-20.md`), the runtime-variable path disposition (W9), the
  automatic-variable guard, static-call qualified targets, `-not`/`!` handling.
- **The depth pass LANDED 2026-10-28 together with PS-B27** (commit on this branch, message
  `powershell: land the depth pass and stop claiming an owner for a .NET constructor target`).
  Measured over the whole admitted population, same corpus, same instrument, A/B by analyzer
  digest: **180,956 → 197,028 edges**, **84,901 → 101,352 resolved**, ambiguous 16,184 → 17,762,
  unresolved 50,986 → 49,207, and **extFAIL 113 → 60** (the committed HEAD analyzer reads 85 under
  today's arbiter, so the pre-pass “0” in `POWERSHELL-VERDICT-2026-10-20.md` was the WITHHELD key,
  not a clean lane).
- PS-B27: `instantiates` joined the namespace pass, a .NET type literal's root is now claimed as a
  LIST (`languageNamespace`) instead of an owner the edge does not name, and a target with no ASCII
  letter carries no externality reading. The 60 remaining refuted claims are attributed row by row
  by `validation/m14/fixtures/powershell/refutation-row-probe.mts` (22 `using namespace` type
  literals · 20 executables · 13 runtime-variable paths · 3 `Add-Type` types · 2 quoted keys) and
  every one is the ARBITER's owner question, whose structural patch is filed with the Lead
  (`POWERSHELL-DEPTH-PASS-2026-10-28.md` §4).
- Gates from the committed tree: suite **25 pass / 0 fail**, mutants **67 of 67 caught, 0
  survivors**, zero-regex **0/0**, spec-shape audit PASS, `tsc -p tsconfig.json` 0.
- **PS-B28 then removed a fabrication with a defence**: PS-B10 published `uses -> <digits>` for
  `$tags[0]` with `isNumericIndex: true` (3,734 rows). A numeric index is not a dependency on a
  symbol named `0`, and the name model proved it — the `powershell` repo declares exactly ONE symbol
  named `0` (a hashtable property in `Parsing.Tests.ps1`), and 1,819 array indices bound to it. The
  row is gone; the string key and the variable key in the same `element_access` case stay.
- **Current whole-population state (2026-10-28, after PS-B27 + PS-B28):** 193,297 edges · resolved
  98,975 · ambiguous 17,030 · unresolved 48,585 · extOK 25,285 · ext? 3,362 · **extFAIL 60**.
  The wall is **65,615**, down from 80,051 when the lane was declared done. The resolved COUNT fell by
  2,377 with PS-B28 and every one of those was a false binding, so the verified-class rate reads
  51.20% and NOT a higher number that counted them.
- **PSD10 then closed the lane's own "not done" gap**: the externality reading was SHAPE-based, so
  a bare command name (`git`, `cd`, `mkdir`) carried no claim. A `calls` row from a `command` node
  (or from an invocation operator with a bare name) now carries `externalVia: "command"`, and the
  measured split says the widening costs nothing: of 36,916 bare command-position rows, 34,158 name
  nothing project-wide and 2,758 keep their resolved/ambiguous answer because the arbiter consults a
  claim only where the name model has nothing. **extOK 25,285 → 53,882, unresolved 48,585 → 19,988,
  ambiguous/resolved/extFAIL all UNCHANGED.**
- Gates: suite **26 pass / 0 fail**, mutants **70 of 70 caught, 0 survivors**, zero-regex **0/0** PASS.
- **PSD14 reached clause 4: `extFAIL 60 → 0` (bindFAIL 0, causeFAIL 0), and the lane's page says
  so with the price beside it** (`validation/m14/verification/POWERSHELL-CLAUSE4-2026-10-28.md`).
  The 60 refutations were FIVE shapes: native programs with their extension (17 → path claim),
  runtime-variable paths (13 → no claim), quoted member names (2 → no claim), types the file compiles
  with `Add-Type` (3 → no claim), and type literals under a `using namespace` directive (22 →
  **expanded to the type the prefix makes addressable**, the one resolution in the batch).
- **PSD15 then asked whether the file's compiled types should be PUBLISHED as symbols** (the rows PSD14
  had to withdraw a claim from name them). Measured: **+62 resolved, 0 new keys** — and **39 refuted
  claims appeared**, because a published type answers the arbiter's owner question for its own name and
  the owner strips the last segment (`[Ansible.AccessToken.Win32Exception]` asks about
  `Ansible.AccessToken`, a class another file declares). Withholding the static-call reading — correct
  on its own terms — left 6 in `catch` clauses of files that compile nothing. So the publication is
  **NOT taken**, and the arbiter's `typeNames` patch is now priced at **+62 resolved / 0 refuted** on
  this lane. What IS shipped: a static call through a compiled type (35 rows) and a type mention of one
  carry no externality reading.
- **Whole-population state (2026-10-28, after PSD15):** 193,297 edges · resolved **98,981** · ambiguous
  **17,030** · unresolved **20,330** · extOK **56,822** · ext? **134** · **extFAIL 0**. Resolved and
  ambiguous are byte-identical to PSD13 — every movement is inside the claim columns (A/B by analyzer
  digest, joined on the gate's own `(label,target,file:line)` key: 22 keys changed target, 0 appeared,
  0 disappeared). The price is stated, not hidden: **220 verified claims withdrawn** (123 runtime
  paths + 62 file-created types + PSD15's 35 compiled-type calls) for 38 refutations removed and 20
  turned into verified path claims.
- **ext? 134 is fully named:** 83 `ownerMemberAbsent` (static-call literals PSD12 refuses to invent a
  namespace for), 38 `owner` (drive / path-plus-variable / expression shapes — the arbiter's case 2),
  13 `namespace` demoted because the module IS project layout.
- **The wall is now MEASURED AND NAMED** (`real-powershell-analyzer.md` §PSD17): bare `uses` 23,335
  (cross-file name space — the retarget pass already fires where a visible unique declaration exists);
  scope-qualified reads 749 (`$script:`/`$global:`/`$local:` — **needs a scope model; a prefix strip
  would bind a script-scope read to a function-local declaration, so it is not taken**); quoted data
  keys 73 (no claim is available); dotted 2,674 (the `typeNames` class); `calls` 9,589 (cmdlets already
  claimed by PSD10, the rest are members whose receiver type is unknowable).
- **Rejected by measurement, recorded so it is not retried:** `$this.Member -> Class.Member` (+151
  ambiguous keys, 0 resolved — the corpus declares the same class in many files).
- **Next in value order:** (1) re-take the C# symbol publication the moment the Lead's `typeNames`
  patch lands — measured at **+62 resolved, 0 refuted**; (2) a frame-scope identity for method-owned
  locals and scoped reads (lane-sized, named above); (3) clause 1 cannot close on this lane without
  the name-model/ontology work the bare and dotted classes need. Clause 1 is FAIL: 37,360
  ambiguous/unresolved.
- Gates from the committed tree: suite **30 pass / 0 fail**, mutants **87 of 87 caught, 0 survivors**,
  zero-regex **0/0** PASS, `tsc -p tsconfig.json` 0.

### haskell — committed DONE, clean tree

- Commit `fbe61b88b` — `renders` and `mixes_in` ruled with whole-population counts; the lane
  reads **12/12** (12 implemented + 2 excluded = 14 applicable).
- Population: **3,702 of 3,702** admitted `.hs`/`.lhs` over **6 repositories**, 0 failures.
  `extends` 189 · `implements` 13,721 · `overrides` 1,274 are the conformance family;
  DerivingVia (493 sites) is read as `implements` with `metadata.derived`, not `mixes_in`.
- Fixtures 8/8, and no working-tree changes in this lane. Nothing outstanding.

### solidity — 11/11 implemented, 3 ruled, and every wall DISPOSITIONED (2026-10-28)

- Coverage: **11 implemented + 3 excluded** (`renders`, `part_of` grammar-remedy-ruled; `mixes_in`
  ontological, emission tried and withdrawn as SOL-24). `coverage-block-gate` reads solidity
  11/11/3 with 0 problems.
- Whole-population arm (`incoming-gate solidity sol 0 --index`, farm root): **421 of 421 files over
  2 repos, 35,099 edges, 0 unclassed**; **resolved 22,750 · verified claims 948 · ambiguous 1,130 ·
  unresolved 1,348**; extFAIL / bindFAIL / causeFAIL **0**. The verified class is
  (22,750 + 948) / 35,099 = **67.5%**, up from 48.9% at the start of this campaign.
- The movement is measured as A/B by analyzer digest with the same corpus and instrument, and
  reconciled on the gate's own `(label, target, file:line)` key every time: **627 ambiguous rows
  became resolved, 0 appeared** across SOL-25 (receiver typing, implicit-`this`, static library
  call, container element, conversion receiver, inherited modifier).
- **The wall classification is now trustworthy and it CHANGED the lane's remaining work**: the
  classifier used to re-analyse each file WITHOUT the project index while every arm ran WITH one,
  which read an inherited member call as `calleeKind: external` and charged 826 ambiguous calls to
  W3. The join now rebuilds the arm's index and REFUSES a sampled dump. Classes: W3 1,070 · W7 704
  · W14 208 · W6 146 · W1 134 · W15 85 · W10 72 · W8 38 · W4 16 · W5 4 · W11 1. Each is disposed by
  where its target lives in the project (`docs/analyzers/real-solidity-analyzer.md` §WALL
  DISPOSITIONS): W3's 1,070 are ALL absent from the project (forge-std `Test` helpers outside the
  admitted corpus, plus `wrap`/`unwrap`/`push`/`slice` builtins) — a corpus/owner decision, not a
  resolver defect; W1's 134 are module specifiers by construction; W7's 159 absent are builtins and
  its 545 member rows are untyped receivers; W14's 208 are bytes/array builtins and objects with two
  declarations; W15's 85 need an index count for non-type names.
- Commits this campaign: `dc8290f4e` (SOL-24 withdrawal + SOL-12 fix + oracle coverage),
  `893c00fc9` (exclusion ladder), `6cfad3971` (classifier), `82f0589d7` (import file claim, 798
  verified), `414aa07f7` (`abi.*` namespace claim, 150 verified), `3f410436f` (receiver typing +
  implicit-`this` + indexed classifier), `49b3a4112` (static call + the stale-target defect),
  `49fc66240` (wall dispositions), `9a843b4dc` (container + conversion receivers), `663a0b0c2`
  (inherited modifier), `a4b2c8239` (Yul frame bindings, correctness only).
- Fixtures **36/0**; doc-truth 74/74; zero-regex 0/0; differential 60 files MISSING 0 / unexplained 0.
- **Next for this lane, in value order:** W4's 16 event rows (declared kind not in run), then the
  index facts that would close W14's 208 and W15's 85. W3/W7-builtin/W1/W10 are not the analyzer's
  to close; they need a dependency index or a corpus decision from the owner, and the doc states the
  falsifier for each. **The lane is NOT "done"**: clause 1 still fails on 1,130 + 1,348 rows, and
  those rows are dispositioned, not resolved.

## The interruption point, stated plainly

Solidity's in-flight batch is now COMMITTED and its walls are dispositioned; the next lane to take is
**haskell** (committed DONE at `fbe61b88b`, clean tree, 12/12 with `renders`/`mixes_in` exclusions to
re-walk through the ladder) or **powershell** (committed DONE at `ac26ed382` but with a later
UNCOMMITTED depth pass — analyzer +826 lines, doc, spec and 11 fixture files — that must be verified
and committed, or reverted whole). Work in one lane's files only, never mixing the two.

Verification protocol for whichever is taken:

```
npx tsc --noEmit -p tsconfig.json            # src/ only, must be silent
npx tsc --noEmit -p tsconfig.scripts.json    # script/ only
bun run script/m14/run-fixtures.ts --lang <lane>   # scoped, must be green
git status --short                            # only the intended files changed
```

Commit per verified batch, message says what was changed and what was measured. Never merge to
`main`; never push over another lane's branch.
