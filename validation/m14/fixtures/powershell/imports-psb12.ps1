# PS23 — the `imports` EDGE, which the lane did not have.
#
# The gap, stated in the lane's own terms. PowerShell states a module dependency four
# ways and `addImport` was already the single reader of all four — `Import-Module`
# (bare, `-Name`, and positional forms), `using module`, `using namespace`, and
# `#requires -Module`. It filled the `imports[]` array correctly for every one of them.
# What it did NOT do is publish an `imports` RELATIONSHIP: it published the dependency
# as `references` and nothing else, so across a 1,092-file corpus the `imports`
# relationship type was emitted 0 times while `imports[]` held every module name.
#
# Why that is a GAP and not a modelling preference. The ontology carries `imports` as
# its own type and 22 of the 48 analyzers in `src/ast/` emit it (`grep -l 'RelationshipType.Imports'
# over `src/ast/real-*-analyzer.ts` names 22 before this wave and 23 after). bash — the same
# construct in the same family, a shell sourcing another file — emits BOTH `imports`
# and `references` for `source ./x.sh`, because a file-level dependency answers two
# different consumers. PowerShell was the only analyzer here with a real module system
# that published neither-shaped-only-`references`.
#
# What this fixture pins, and why each row is here rather than left to the corpus:
#
#   1. All four import forms produce an `imports` edge. `module-surface-psb9` already
#      pins them on `imports[]` and on `references`; this file pins them on the
#      `imports` CHANNEL, because a channel with no fixture row is the exact state the
#      lane was in — the type was live in the enum and absent from the output.
#   2. The tier. Every `imports` edge must be `evidenceClass: import_based`. Left on the
#      `evidenceClassFor` fall-through it would have been labelled `usage_contextual`,
#      which claims the edge came from a node's POSITION. It does not: it comes from a
#      named construct. A wrong tier is not a cosmetic label — honesty contract §4 is
#      about exactly this number.
#   3. An import INSIDE a function is sourced from the FUNCTION, not from the file.
#      `addImport` uses `top().scope`, and at file scope that is the module symbol; one
#      frame deeper it is the function. The corpus contains both and a fixture that only
#      pinned the file-scope form would pass on a change that flattened the second one.
#   4. `-ErrorAction Stop` must not appear on the `imports` channel either. PS7's
#      switch-value exclusion was written for `imports[]`; a second channel reading the
#      same argument list is a second chance to read a switch VALUE as a module name,
#      and it is the failure PS7 was filed for.
#   5. `Import-Module` and `using` must not become CALLS. Both are handled on dedicated
#      branches that `break` before the call edge, and the keyword call edge is the PS5
#      defect class reached through the import path.
#   6. The `#requires` MODULE LIST has three shapes and the pre-PS24 reader answered
#      none of the two list-shaped ones. It stopped at the first space, tab or comma, so
#      `#requires -Modules Pester, PoshRSJob` returned `Pester` alone and
#      `#requires -Modules @{ ModuleName = 'X'; ModuleVersion = '1.0' }` returned the
#      literal `@{` as the module name — which wrote a row with `path: "@{"` into
#      `imports[]` and published an edge to `@{`. Measured on the corpus: 2 of its 1,092
#      files carry the hashtable form (both `ansible/.../win_app_control/files/
#      {New-AnsiblePowerShellSignature,Set-ManifestSignature}.ps1`, both
#      `@{ ModuleName = 'OpenAuthenticode'; … }`), and they were the whole of the gap
#      between `imports[] 552` and `imports 550` — the other half of each pair was
#      dropped downstream by `filterNoiseRelationships`, which rejects any target
#      containing `{`. A comma-separated `#requires` module list has ONE occurrence in
#      the corpus (`ansible/.../sanity/pslint/pslint.ps1:2`, `#Requires -Modules
#      PSScriptAnalyzer, PSSA-PSCustomUseLiteralPath`), so `PSSA-PSCustomUseLiteralPath`
#      was a real dropped dependency; the two rows below at line 61 are this fixture's
#      own copy of that shape, and `equals: 9` is the assertion a single-name reader
#      cannot satisfy.

#requires -Version 7.0
#requires -Module Pester
#requires -Modules CimCmdlets, PSReadLine
#requires -Modules @{ ModuleName = 'OpenAuthenticode'; ModuleVersion = '0.5.0' }

using namespace System.IO
using module ./helpers.psm1

Import-Module Az.Accounts -ErrorAction Stop
Import-Module PoshRSJob

function Install-Toolchain {
    # An import at FUNCTION scope. Sourced from the function, not from the file.
    Import-Module -Name SqlServer -ErrorAction SilentlyContinue
    return $true
}

function Get-Setting {
    param([string]$Name)
    return $Name
}

Export-ModuleMember -Function Get-Setting