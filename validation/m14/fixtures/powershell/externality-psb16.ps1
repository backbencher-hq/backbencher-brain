#requires -Version 7.0
# PS-B16 — cause C. One shape per case, so a single row can fail while the rest pass.
#
# Two additive keys are asserted here and neither changes an edge count:
#   externalTarget:true + externalVia:"cmdlet"|"qualified"   a reading names a reason
#   noDeclarationInFile:true                               no reading fired, still no binding
# They PARTITION the "this file declares nothing with that spelling" population, so a row
# carrying one must not carry the other. Every negative row below asserts `meta.X: null`,
# which is the only vocabulary that can say a KEY is absent.

# 1. A CMDLET. PowerShell's own Verb-Noun command spelling, bound by the runtime from an
#    installed module. Nothing in this file declares it and nothing can.
Get-ChildItem -Path . | Out-Null

# 2. THE TWIN, and the reason a shape rule alone cannot stand: the SAME Verb-Noun shape,
#    declared by THIS file. A spelling-only rule marks it external; the declaration guard is
#    what stops it. Measured on the admitted corpus: the unguarded shape marks 32,368 live
#    edges of which 7,040 (21.75%) point at a name the EMITTING FILE declares.
function Get-Thing {
    param($Name)
    $Name
}

# 3. THE TWIN, called. Line 7 and line 16 carry identical spellings and must carry different
#    metadata — that difference is the entire claim, and it is one boolean wide.
Get-Thing -Name "x" | Out-Null

# 4. A .NET TYPE through the constructor. `New-Object System.Version` publishes
#    `instantiates -> System.Version`, and a dotted type name is not a bare-word spelling, so
#    the qualified reading fires. This is the case the `cmdlet` reading cannot reach.
$v = New-Object System.Version

# 5. A RUNTIME TABLE. `$env:TEMP` is bound by the runtime from the process environment and no
#    declaration in this file can shadow it, so `env:` KEEPS the qualified reading even though
#    it is a scope prefix.
$here = $env:TEMP

# 6. A SCOPE THIS FILE CAN DECLARE INTO. `function global:Helper` is ordinary PowerShell, so
#    marking `global:Helper` external would be a claim this file can falsify. The same holds
#    for script:/local:/private:/function:, and all five are excluded.
function global:Helper {
    param($X)
    $X
}

# 7. THE CONTROL for row 6, and the only thing that makes it a test rather than a claim: the
#    declaration is present, so a rule that regressed to shape-only would mark this edge and
#    the fixture would fail.
global:Helper -X 1 | Out-Null

# 8. A LOCAL VARIABLE, declared and read. Neither key may fire. A rule that asserted
#    `noDeclarationInFile` on every calls/uses edge would pass every other row in this file
#    and fail only here.
$local = 1
$local2 = $local

# 9. A READ OF A NAME THIS FILE DECLARES NOWHERE, and the only row in the file carrying
#    `noDeclarationInFile`. Nothing here declares `$fromElsewhere`; PowerShell binds it from a
#    dot-sourced file, a caller's scope or a module export, all of which happen at RUN TIME.
#    66,482 corpus edges are in this state and this is what the second key is for — it is the
#    answer to cause A, where a consumer's name -> symbol map has nothing to map to.
Write-Host $fromElsewhere

# 10. A QUOTED LITERAL carrying a qualifier byte. This analyzer publishes hashtable keys
#     verbatim, so the key arrives as a property NAME; a leading quote is therefore excluded
#     from the qualified reading. Measured on the corpus: without the exclusion these 43 + 18
#     + 7 edges would be marked. The key has to contain a `/` or a `.` for the reading to have
#     anything to misfire on — 'Content-Type' carries a hyphen, which is the CMDLET byte and
#     not a qualifier byte, so a first draft of this fixture pinned a row the exclusion could
#     never have touched and its mutant SURVIVED.
$headers = @{ 'application/json' = 'text/plain'; 'Content-Type' = 'application/json' }
$headers2 = $headers

# 11. A CONSTRUCTOR CALL on a type this file declares. `instantiates -> Local` is a LOCAL type,
#     and the guard is the only thing that knows it — no spelling distinguishes `[Local]::new()`
#     from `[System.Version]::new()`.
class Local {
    [void] Render() { $null }
}
$l = [Local]::new()

# 12. A METHOD CALL on a declared receiver. `$l.Render()` is a `calls` edge at confidence 0.6
#     and the keys must not fire on it; `Render` is declared in this file.
$l.Render()