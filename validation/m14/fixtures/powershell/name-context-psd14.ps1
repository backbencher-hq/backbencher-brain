# PSD14 — A NAME IS NOT A DECLARATION, AND FOUR SHAPES NEEDED THEIR OWN CLAIM.
#
# The externality pass decides a row's reading by SHAPE. That is right for "this spelling cannot be
# a local declaration" and it was wrong for four shapes, all measured whole-population:
#
#   1  a NATIVE PROGRAM named with its extension (`whoami.exe`) — the dot fired the qualified
#      reading, the arbiter asked about `whoami`, and a project that declares ANY symbol of that
#      spelling REFUTED a claim about a program. MEASURED: 17 refuted rows, all true program names.
#   2  a RUNTIME-VARIABLE PATH (`$PSScriptRoot/../../build.psm1`) — the arbiter's source-path claim
#      compares BASENAMES against the admitted list, so any repo with `build.psm1` at its root
#      refuted the claim even where the path resolves elsewhere. MEASURED: 13 refuted, and the
#      removal costs 123 verified rows, which is the price of not asserting what this file cannot
#      know (it has no project root).
#   3  a QUOTED MEMBER NAME (`$build.triggerInfo.'pr.number'`) — the dot is punctuation inside one
#      property's name, and the owner question about `pr` is answered by a VARIABLE. MEASURED: 2.
#   4  a TYPE THIS FILE COMPILES (`Add-Type` + `[Contoso.Helpers.Gadget]::new()`) — the type does not
#      exist until the script runs, so no project declaration table can answer for it. MEASURED: 3
#      refuted, and withholding costs 62 verified rows whose types the same construction creates.
#
# And one shape needed a RESOLUTION rather than a withheld claim: a type literal inside a
# `using namespace` directive names a framework type under that prefix (about_Using), so
# `[Language.VariableExpressionAst]` IS `System.Management.Automation.Language.VariableExpressionAst`
# — the same target the explicit spelling already produces, and a row the namespace claim verifies.
# MEASURED: 22 refuted rows.
#
# Every rule below has a TWIN, because each one is a boundary rather than a widening.

using namespace System.Management.Automation

Add-Type @'
namespace Contoso.Helpers
{
    public class Gadget
    {
        public int Size;
    }
}
'@

# 1. POSITIVE — a native program with its extension. The claim is the PATH claim.
function Invoke-Native {
    & whoami.exe
}

# 1b. NEGATIVE TWIN — the same program under a directory is a PATH, not a bare program name: the
#     program rule must refuse it and the relative-path rules keep the row.
function Invoke-ToolPath {
    & .\tools\whoami.exe
}

# 2. POSITIVE — a runtime-variable path carries NO claim at all. The file does not know the project
#    root, so neither polarity of the path question is its to assert.
function Invoke-Script {
    . "$PSScriptRoot/tools/Start-Thing.ps1"
}

# 2b. POSITIVE — the same runtime path through `Import-Module`, whose target is published VERBATIM
#     (`$PSScriptRoot/../modules/Ci.psm1`). This is the shape the arbiter's source-path claim used
#     to be published on, and its candidate list contains the BASENAME — so any repo with a
#     `Ci.psm1` anywhere refuted the claim regardless of where the path pointed.
function Import-Ci {
    Import-Module $PSScriptRoot/../modules/Ci.psm1
}

# 3. POSITIVE — a quoted member name is ONE property called `pr.number`.
function Get-MemberKey {
    $build = @{ triggerInfo = @{ 'pr.number' = 1 } }
    return $build.triggerInfo.'pr.number'
}

# 3b. NEGATIVE TWIN — an UNQUOTED member name is a bare name, and its per-file claim stays.
function Get-MemberValue {
    $build = @{ triggerInfo = @{ connection = 'x' } }
    return $build.triggerInfo.connection
}

# 4. POSITIVE — the type literal resolves through the file's `using namespace` directive.
function Get-TypeName {
    return [Language.VariableExpressionAst]
}

# 4b. NEGATIVE TWIN — `Text` is a child namespace of `System`, so the implicit-`System.` reading is
#     the one that governs it; the using expansion must not retarget it under the prefix.
function Get-FrameworkType {
    return [Text.StringBuilder]::new('x')
}

# 5. POSITIVE — the type this file compiles. `Contoso` is the ROOT the C# namespace declares.
function New-Gadget {
    return [Contoso.Helpers.Gadget]::new()
}

# 5b. NEGATIVE TWIN — a framework type in the same file keeps its namespace claim: the Add-Type
#     table must not swallow every type literal in a file that compiles something.
function New-Uri {
    return [System.Uri]::new('https://example.invalid')
}

# 6. POSITIVE — a STATIC CALL through the type this file compiles. The owner of the call target IS the
#    compiled type, so the dependency is internal to the file and no externality claim may be
#    published. MEASURED: publishing the type as a declaration made 33 such claims REFUTED by the
#    arbiter (its owner question finds the type), which is why the reading is withheld here.
function Get-Gadget {
    return [Contoso.Helpers.Gadget]::Create()
}

# 6b. POSITIVE — a CAST to the same compiled type. The `uses` row names the type and must carry no
#     reading either: the rule is the NAME, not the emitter's marker (`isCastExpression` here, the
#     `catch` clause's type list elsewhere) — keying on one marker left 6 population rows refuted.
function Convert-Gadget {
    param($raw)
    return [Contoso.Helpers.Gadget]$raw
}
