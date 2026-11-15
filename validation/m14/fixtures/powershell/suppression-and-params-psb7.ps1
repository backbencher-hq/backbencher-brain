# PS8/PS10 — suppression must not eat real declarations, and every parameter
# form must be read.
#
# PS8. The pre-wave `AUTOMATIC_VARIABLES` set contained `foreach` and `switch` —
# those are LANGUAGE KEYWORDS, not automatic variables, and `$switch = 1` is a
# legal declaration. Reproduced: 6 of 9 top-level assignments in a probe file
# were silently dropped. The ledger's standing fixture-authoring rule exists for
# exactly this class — "every language's fixtures MUST include identifiers that
# collide with stdlib/builtin words, because suppression filters are invisible to
# output-diff tests otherwise" — and this lane had NO fixtures, so nothing pinned
# it.
#
# The second half of PS8 is CASE. PowerShell identifiers are case-insensitive, so
# `$null`, `$Null` and `$NULL` are one automatic variable — and the pre-wave
# comparison was case-SENSITIVE, so the lower-case spellings were published as
# project declarations. Measured on `ansible@7ec731b`: `exec_wrapper.ps1`
# published `null` as a variable FIVE times, and `$Script:AnsibleClrFacadeSet`
# was published as a variable named `Script:AnsibleClrFacadeSet` because the
# scope-prefix list was case-sensitive too.
#
# PS10. `function G($x, $y) { … }` — the inline parameter list, the most
# idiomatic PowerShell function form — published ZERO parameters, because the
# pre-wave reader accepted only `script_parameter` and `class_method_parameter`.
# The grammar declares the third shape (`function_parameter_declaration`) and the
# production draw holds 0 occurrences of it, so this is a SHAPE-PROBE fix and is
# described as such rather than as a corpus MISSING.
#
# Every name below that COLLIDES with an engine-supplied or reserved word is a
# real declaration and must survive. The genuine automatic variables must not.

$switch = 'a-real-variable'
$foreach = 'also-real'
$null = 'NOT the automatic null'
$Error = 'shadowing is legal'
$args = 'shadowing is legal'
$input = 1
$PSItem = 'shadowing is legal'

$global:Shared = 'script scope, not a local declaration'
$Script:Upper = 'the capital S is the same modifier'
$env:PATH = 'environment scope, not a local declaration'

function With-ParamBlock {
    param([string]$Name, [int]$Count = 0)
    return $Name
}

function Inline-Params($First, [string]$Second = 'x', $Third) {
    return $First
}

function No-Params {
    return 'none'
}

Write-Host $switch $foreach $Error $args $input $PSItem
