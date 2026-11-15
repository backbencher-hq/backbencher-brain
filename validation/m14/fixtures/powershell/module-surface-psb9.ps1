# PS7/PS20/PS21/PS22 — the module surface: imports in, exports out, and the
# argument forms that must not be mistaken for either.
#
# PS7. The pre-wave import reader took the token after ANY `command_parameter` as
# the module's name, so `Import-Module Az.Accounts -ErrorAction Stop` stored TWO
# external module imports — `Az.Accounts` and `Stop`, an `-ErrorAction` VALUE.
# Measured on the pinned corpus: `tools/packaging/packaging.psm1`.
#
# PS20. `Export-ModuleMember -Function F` is how a `.psm1` publishes its surface.
# The pre-wave lane hard-coded `exports: []`, so a module's public API was
# invisible: nothing in the graph said which function a module exports.
#
# PS21. `using namespace System.IO` / `using module ./helpers.psm1` are
# STATEMENTS, not calls. The pre-wave lane emitted a `calls` edge naming `using`.
#
# PS22. `#requires` — the pre-wave lane read `-Module` only, so the commonest
# form, `#requires -Version 7.0`, published nothing and a module's declared
# minimum runtime was invisible. Comments are opaque to the grammar, so this one
# extraction is a character scan by necessity and is declared as such.

#requires -Version 7.0
#requires -Module Pester

using namespace System.IO
using module ./helpers.psm1

Import-Module Az.Accounts -ErrorAction Stop
Import-Module ./relative.psm1
Import-Module -Name SqlServer -ErrorAction SilentlyContinue
Import-Module PoshRSJob

function Get-Setting {
    param([string]$Name)
    return $Name
}

function Get-Internal {
    return 'private'
}

Export-ModuleMember -Function Get-Setting
