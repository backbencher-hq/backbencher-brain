# PS30: `Export-ModuleMember` must record WHICH FLAG published the name. Authored 2026-10-03.
#
# `Export-ModuleMember` publishes a name under one of four flags — `-Function`,
# `-Variable`, `-Alias`, `-Cmdlet` — and the four are not the same kind of thing.
#
# The reader COMPUTED the flag: `if (!isFlag(flag)) continue` is a test on the very
# string it then discarded, passing `leaf` — the COMMAND NAME — as `via` instead. So
# `via` was the literal `Export-ModuleMember` on every row, and 0 of 106 named the
# flag. Measured over all 1,108 admitted files through production `parseFile`.
#
# This is the argument PS23 made for `imports`, on the sibling channel: `file -> Foo`
# does not say which of the declarations produced it, so `metadata.via` names the form
# on every row. `imports` got it; `exports` had the value in hand and did not write it
# down.
#
# WHY THIS FIXTURE USES ONLY TWO OF THE FOUR FLAGS. `script/m14/run-fixtures.ts:1419`
# runs a global invariant on EVERY fixture in EVERY language: "every export name must
# resolve to a TOP-LEVEL symbol", because the export list is the index's importable-unit
# set. PowerShell's `-Alias` and `-Cmdlet` flags publish names the file cannot declare —
# an alias is made by `New-Alias` at run time and a cmdlet comes from a module — so a
# module that publishes an alias CANNOT be written as a fixture at all. That is reported
# as a shared-machinery finding rather than worked around, and it is also the sharpest
# demonstration of why the flag matters: a consumer reading `exports -> gs` cannot tell
# an alias from a function, and the invariant above says an alias should not be there.
# The two flags this fixture does use are enough to pin the rule, because the fix reads
# the flag string and does not branch on which of the four it is.

function Get-Setting {
    param($Path)
    return (Get-Content $Path)
}

function Get-Other {
    return 'other'
}

$cacheRoot = "$env:TEMP"

Export-ModuleMember -Function Get-Setting, Get-Other
Export-ModuleMember -Variable cacheRoot