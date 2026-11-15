# PS5/PS6 — a RESERVED WORD IS NOT A CALL, and nothing is emitted from a
# recovery region.
#
# WHY. Two of the pre-wave lane's `calls` edges named a PowerShell KEYWORD, and
# one of the two classes is invisible to every gate in this repository.
#
# (a) NAMED BLOCKS. `begin` / `process` / `end` / `clean` / `dynamicparam` delimit
# the blocks of an advanced function or script (`about_Functions`). The grammar
# models each as a `command` node — reproduced in isolation:
# `hasError=false`, `command nodes: ["End","Process","Begin"]` — and the
# pre-wave `FLOW_KEYWORDS` set did not list them, so every advanced function
# emitted three fabricated `calls` edges naming its own block keywords. Hand-
# confirmed at `dsc/pwsh.profile.resource.ps1:15-16` in the pinned corpus.
#
# (b) `if` AS AN EXPRESSION. `$mode = if (…) { … } elseif (…) { … } else { … }`
# is legal PowerShell (an `if` is an expression since PS 3) and it parses with
# **`hasError = false`** while leaving `elseif` and `else` as bare `command`
# nodes. F1 cannot see it (the node type is real), F10 cannot see it (the file
# is not damaged), and the M12 corpus-errors census cannot see it (it counts
# ERROR nodes). This is why `script/m60/powershell-keyword-census.ts` exists: the
# only instrument that can catch a reserved word in a call target.
#
# (c) DSC. A Desired State Configuration is a language construct resolved by the
# DSC engine, not a sequence of cmdlet calls.
#
# (d) RECOVERY. A `command` whose name lives inside an ERROR/MISSING node is
# recovery noise (bash BD5, extended).

function Get-Mode {
    [CmdletBinding()]
    param([string]$Runtime)

    begin {
        $seed = 1
    }

    process {
        $seed++
    }

    end {
        Write-Output $seed
    }
}

$mode = if ($env:CI -eq 'true') {
    'ci'
}
elseif ($env:BUILD -eq 'fast') {
    'fast'
}
else {
    'slow'
}

Configuration SiteConfig {
    node 'localhost' {
        File Marker {
            Destination = 'C:\marker.txt'
            Ensure = 'Present'
        }
    }
}

$value = 1
$value = $(if ($value -gt 0) { 'pos' } else { 'neg' })
Get-Mode -Runtime 'fxdependent'

# PS19 — the invocation operator over a VARIABLE. `& $sb` publishes a `uses` edge
# to `sb`; the pre-wave lane wrote the raw command text, so it published
# `calls -> "$sb"` — a name no symbol can have, because a variable is stored
# stripped. `. $sb` (dot-sourcing a variable) published nothing at all.
$sb = { Write-Host 'body' }
& $sb
. $sb
