# PS-B25 — a QUOTED MODULE PATH IS A PATH, not the first variable inside it.
#
# The pinned grammar wraps every quoted command argument as
# `array_literal_expression > unary_expression > string_literal`, and the argument
# reader ran its first-variable search before it ever considered the string.
# `Import-Module "$here/../helpers.psm1"` therefore published `imports -> here` and
# `references -> here` — a VARIABLE where the module's path belongs — while the
# identical UNQUOTED spelling is a `generic_token` and was always published whole.
# The analyzer disagreed with itself depending only on quoting.
#
# Measured over the authoritative corpus (reconcile-f5.mts, every admitted file):
# 209 `imports` + 203 `references` rows of this shape — the lane's largest single
# differential class. The three import spellings below are the positive controls;
# the forbid rows at the bottom are the pre-fix shape and the dynamic-name family.

$here = $PSScriptRoot

Import-Module "$here/../helpers.psm1"
Import-Module "$PSScriptRoot/./local.psm1" -Force
Import-Module $PSScriptRoot/plain.psm1

$dynamic = 'Pester'
Import-Module $dynamic

function Get-Setting {
    param([string]$Name)
    return $Name
}

Export-ModuleMember -Function Get-Setting
