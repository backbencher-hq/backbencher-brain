#requires -Version 7.0
# PS-B17 — the ARBITER'S spelling of the externality claim, and the one defect it repairs.
#
# `script/m14/incoming-gate.ts` reads an external claim from an EXPLICIT key list
# (`EXTERNAL_KEYS`, script/m14/incoming-rule.ts). This analyzer has published its externality
# reading as `externalTarget` + `externalVia` since PS-B16, and `externalTarget` is NOT in
# that list — so all 1,938 marked edges of the `powershell ps1 60` population arrived at the
# arbiter as UNMARKED edges, which is indistinguishable there from broken ones. Measured
# before the change: `1192 ambiguous + 5877 unresolved of 9911 edges, 0 external`.
#
# `isExternalTarget` IS in the list and is the same claim word for word, so PS38 re-spells it
# on exactly the rows the existing reading already marks. The rows below are what makes that a
# check rather than a claim: every POSITIVE row has a NEGATIVE twin with the identical
# spelling shape, and a rule that marked on shape alone would fail the twin.
#
# Measured after the change (`powershell ps1 60`, same population, same analyzer):
#   1192 ambiguous + 3939 unresolved of 9911 edges; 1938 marked external = 226 verified
#   (the project's own key space has no declaration of the owner) + 1711 unverifiable
#   (the arbiter has no identifier-shaped owner to look up) + 1 REFUTED
#   (`Test.User32::GetPlacement` in the corpus, whose arbiter-owner `Test` collides with an
#   unrelated Pester `class Test` — an arbiter limitation, recorded in the spec, not here).

# 1. A CMDLET. PowerShell's Verb-Noun command spelling, bound by the runtime from an installed
#    module. Nothing in this file declares it and nothing can. The arbiter's bare-name check
#    (`verifyExternalClaim`) answers it directly: no declaration carries this name.
Get-ChildItem -Path . | Out-Null

# 2. A .NET TYPE through the constructor. `New-Object System.Version` publishes
#    `instantiates -> System.Version`, and the arbiter's owner lookup asks for `System`.
$v = New-Object System.Version

# 3. A RUNTIME TABLE. `$env:TEMP` is bound by the runtime from the process environment; no
#    declaration in this file can shadow it.
$here = $env:TEMP

# 4. A BCL STATIC MEMBER CALL. `[System.IO.Path]::Combine` publishes
#    `calls -> System.IO.Path::Combine`, whose arbiter owner is `System.IO`.
$p = [System.IO.Path]::Combine('a', 'b')

# 5. THE TWIN, and the reason a shape rule alone cannot stand: the SAME Verb-Noun shape,
#    declared by THIS file. A spelling-only rule marks it; the declaration guard is what stops
#    it. Measured on the admitted corpus: the unguarded Verb-Noun reading marks 32,368 live
#    edges of which 7,040 (21.75%) point at a name the EMITTING FILE declares.
function Get-Thing {
    param($Name)
    $Name
}

# 6. THE TWIN, called. Line 40 and line 53 carry identical spellings and must carry different
#    metadata — that difference is the entire claim, and it is one boolean wide.
Get-Thing -Name "x" | Out-Null

# 7. A DECLARED CLASS, so `[Local]::new()` has a declaration in this file to be found.
class Local {
    [void] Render() { $null }
}

# 8. THE TWIN through the qualified channel. `instantiates -> Local` names a type this file
#    declares, and no spelling distinguishes `[Local]::new()` from `[System.Version]::new()`.
$l = [Local]::new()

# 9. A QUOTED LITERAL carrying a qualifier byte. This analyzer publishes hashtable keys
#    verbatim, so a leading quote is excluded from the qualified reading.
$headers = @{ 'application/json' = 'text/plain' }
$headers2 = $headers

# 10. A SCOPE PREFIX THIS FILE CAN DECLARE INTO. `function global:Helper` is ordinary
#     PowerShell, so marking `global:Helper` external would be a claim this file can falsify.
function global:Helper {
    param($X)
    $X
}

# 11. THE CONTROL for row 10: the declaration is present, so a rule that regressed to
#     shape-only would mark this edge and the fixture would fail.
global:Helper -X 1 | Out-Null
