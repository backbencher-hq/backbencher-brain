# PS11/PS23 — the symbol payload the STORE actually reads.
#
# WHY. `pool-worker.ts` carries a symbol across the worker boundary by NAMING
# its fields, and it drops the whole `metadata` object except the single narrow
# key `isDeclaration`. The pre-wave lane wrote `isStatic`, `isHidden`,
# `annotations`, `type` and `docstring` INTO `metadata` — so every one of them
# was discarded before the store ever saw it. Measured at the store: a
# `static [int]` property stored with `is_static = 0`, and `[ValidateSet('a','b')]`
# stored with `annotations = NULL`, on a project where the analyzer had
# extracted both correctly.
#
# The payload is therefore asserted on the ANALYZER's own output — which is what
# bb_edit, bb_doc and the parameter matrix consume — and the worker-boundary
# consequence is recorded in the analyzer's contract (PS11) rather than pinned
# twice here.
#
# PowerShell's documented payload surface, one per line:
#   · `isStatic` / `isHidden`   — `static` / `hidden` class attributes
#   · `decorators`              — the attribute list, as written
#   · `parameters`              — all three parameter forms, with `type` and
#                                 `isOptional`; an UNTYPED parameter is `untyped`,
#                                 not `any`, because `[int]$d = 0` and `$d = 0`
#                                 are different contracts
#   · `returnType`              — the declared return type
#   · `docstring`               — comment-based help, which IS a PowerShell
#                                 function's documentation (`about_Comment_Based_Help`).
#                                 The pre-wave lane read no comment but
#                                 `#requires`, so `docstring` was `null` for every
#                                 symbol in the language. ADJACENCY is the rule,
#                                 Javadoc-style: a blank line between the help
#                                 block and the declaration ends the association,
#                                 so this file's own twenty-nine-line banner is
#                                 NOT `Get-Report`'s documentation. The first
#                                 version of the scanner skipped blank lines and
#                                 published the banner as the docstring of
#                                 whichever declaration came first.

<#
.SYNOPSIS
Reads the deployment report.
.DESCRIPTION
Long form, on its own line, which must survive as part of the docstring.
#>
function Get-Report {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateSet('daily', 'weekly')]
        [string]$Window,

        [int]$Limit = 10,

        $Untyped
    )
    return $Window
}

class Store {
    hidden [string]$Token = 'x'
    static [int]$Version = 2
    [string]$Root

    [string] Path([string]$Leaf) {
        return $Leaf
    }
}

# This comment is separated from `Store` by a blank line, so it is not `Store`'s
# docstring — the adjacency rule, pinned by the absence of a `docstring` on Store.

enum Level {
    Low
    High
}
