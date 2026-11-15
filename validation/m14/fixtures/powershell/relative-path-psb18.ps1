# PS-B18 — a RELATIVE PATH naming one of the lane's ADMITTED spellings is a PROJECT FILE
# reference, not an external target.
#
# WHY THIS FILE EXISTS. The fleet's FIRST refuted-claim incident was powershell: two claims the
# analyzer published about files the project OWNS were refuted by the arbiter's own case-1 path
# check. The fix (`8cd43c988`) added ONE predicate — `isRelativeScriptPath` — and that predicate
# read "a relative path ending in `.ps1`". The ARBITER's question is a different one: "is this
# path one of the PROJECT's admitted files?" (`pathTargetInProject`, script/m14/incoming-rule.ts).
# The two disagree on three axes, and this file is a row per disagreement.
#
#   AXIS 1 — THE EXTENSION. The gate admits `powershell: "ps1,psm1,psd1"`
#   (script/m14/incoming-gate.ts:134), so a project owns `.psm1` and `.psd1` files exactly as it
#   owns `.ps1` ones, and `pathTargetInProject` matches the admitted list by SUFFIX, so the
#   extension is irrelevant to it and decisive to the old predicate.
#   MEASURED on the whole population (1,181 files / 30 repos, production `parseFile`): two rows —
#   powershell/test/powershell/Modules/Microsoft.PowerShell.Security/FileCatalog.Tests.ps1:365
#   and :366 — published `uses -> DSCResources\UserConfigProviderModVersion1\UserConfigProvider
#   ModVersion1.psm1` with `externalTarget: true`, and that file IS in the project. The arbiter's
#   own `verifyExternalClaim` answers `externalRefuted` on both. The lane's extFAIL column read 0
#   anyway, because PS38 withholds the arbiter-readable key on a bare owner and the spelling the
#   analyzer DOES publish is not in EXTERNAL_KEYS — so the false claim was published AND INVISIBLE.
#   That is the second refuted claim, and the first incident's fix is what made it hard to see:
#   the fix answered the wrong question.
#
#   AXIS 2 — THE SEPARATOR. The old predicate also required a path separator, so a BARE
#   `Helper.psm1` was marked. The arbiter's suffix match does not care: `nf.endsWith("/" + norm)`
#   matches a bare `Helper.psm1` against ANY admitted file with that basename.
#
#   AXIS 3 — THE ABSOLUTE CASE, WHICH THE OLD PREDICATE GOT WRONG THE OTHER WAY. An ABSOLUTE path
#   can never be refuted by the path branch, because the gate's project facts are REPO-RELATIVE
#   (`path.relative(repoRoot, abs)`, incoming-gate.ts:577) and no admitted path ends with `/` plus
#   an absolute norm. The old predicate withheld the claim on `/usr/lib/Helper.ps1` — a TRUE claim
#   thrown away, for a shape the arbiter can check and answer.
#
# THE RULES THIS FILE IS A TEST OF, in one sentence each:
#   a RELATIVE path ending in .ps1 / .psm1 / .psd1  -> NO externality reading
#   an ABSOLUTE path ending in one of those          -> the reading FIRES
#   a relative path ending in NO admitted extension -> the reading FIRES (the arbiter cannot
#                                                          refute it: every admitted file ends in
#                                                          an admitted extension)
#
# THE SHAPE IS THE PRODUCTION SHAPE. The two population rows are a CONSTANT-KEY ELEMENT ACCESS —
# `$result.CatalogItems["DSCResources\...\UserConfigProviderModVersion1.psm1"]` — and this
# analyzer publishes such a key as a `uses` target, UNQUOTED. That matters: a quoted target is
# excluded from the qualified reading by the leading-QUOTE rule (PS-B16), so only the unquoted
# element-access key reaches the path reading, and a fixture written with dot-sources alone would
# not have exercised the production shape at all.
#
# One shape per case, so a single row can fail while the rest pass. Every negative row asserts
# `meta.externalTarget: null`, which is the only vocabulary that can say a KEY is absent.

# ── THE ELEMENT-ACCESS SHAPE — the production shape ───────────────────────────────────────────

# 1. THE ROW THE WHOLE FIX EXISTS FOR, and the PRODUCTION row verbatim in shape. The project owns
#    `.../DSCResources/UserConfigProviderModVersion1/UserConfigProviderModVersion1.psm1`, so the
#    arbiter REFUTES an externality claim about it. Before the fix this row carried
#    `externalTarget: true` — a claim the project itself answers false.
$a = $x["DSCResources\UserConfigProviderModVersion1\UserConfigProviderModVersion1.psm1"]

# 2. THE LANE'S THIRD ADMITTED SPELLING. `.psd1` is a manifest, and the gate admits it exactly as
#    it admits `.ps1` and `.psm1`.
$b = $x["DSCResources\scriptdsc\scriptdsc.psd1"]

# 3. THE BARE SPELLING — AXIS 2. `Helper.psm1` names no directory, and the arbiter's suffix match
#    does not need one: it matches ANY admitted file with that basename. The old predicate
#    required a separator, so this row was marked.
$c = $x["Helper.psm1"]

# 4. A UNIX-ROOTED PATH. It names something outside any project, and the gate's facts are
#    repo-relative, so no admitted path can answer it. The reading is KEPT — and under the OLD
#    predicate it was WITHHELD, a true claim thrown away.
$d = $x["/usr/lib/Helper.ps1"]

# 5. A WINDOWS DRIVE PATH. Same shape, same answer: a drive letter names a machine, not a project.
$e = $x["C:\lib\Helper.ps1"]

# 6. A URI WITH A SCHEME. It names a host. The old predicate withheld it too (it ends in `.ps1`
#    and carries a separator), so this row is also a widening in the other direction.
$f = $x["https://example.com/Helper.ps1"]

# 7. THE CONTROL BESIDE THE EXCLUSION. `.\lib\Helper` names no file the project can own, because
#    every admitted file ends in `.ps1`, `.psm1` or `.psd1` — so the arbiter's path branch can
#    never refute a claim about it, and the claim is KEPT. A rule that withheld EVERY relative
#    path would pass rows 1-6 and fail only here.
$g = $x[".\lib\Helper"]

# ── THE OPERATOR SHAPE — the same rule, reached a different way ───────────────────────────────

# 8. THE DOT-SOURCE OPERATOR. `. .\lib\Helper.psm1` is a project-file reference in command
#    position, the shape the FIRST incident was about, on the spelling the first fix missed.
. .\lib\Helper.psm1

# 9. THE INVOCATION OPERATOR. `&` is the other way a path reaches a call, and a rule that only
#    read the dot-source operator would pass rows 1-8 and fail only here.
& .\lib\Helper.psm1

# ── THE RUNTIME-VARIABLE ROW — the NARROWING, and the row that keeps the fix from over-reaching ──

# 10. A PATH THAT BEGINS WITH A RUNTIME VARIABLE. `$PSScriptRoot\..\..\Helper.psm1` is resolved at
#     RUN TIME, against a directory the project does not know, so this file is NOT in a position to
#     judge whether the project owns it — and the measurement says the judgement would be wrong
#     either way: over the whole population, 30 rows of this shape split 12 false claims against 18
#     true ones. So the externality reading STAYS here. A rule that withheld EVERY relative path
#     would pass rows 1-9 and fail only this one.
#
#     THE SHAPE IS THE PRODUCTION SHAPE FOR THIS CLASS: an `imports` / `references` row. (An
#     ELEMENT-ACCESS key containing `$` is not published as a target at all — the analyzer skips a
#     key that contains a `$` — so this class can only be reached through an import.)
Import-Module $PSScriptRoot\..\..\Helper.psm1
