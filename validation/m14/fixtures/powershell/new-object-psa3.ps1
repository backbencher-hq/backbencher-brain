# PS-A3: `New-Object` as a CONSTRUCTOR CALL. Authored 2026-09-27.
#
# PowerShell spells the constructed thing two ways and only one was read. `-TypeName`
# took a managed type; `-ComObject` takes a COM ProgID, and it was not read at all —
# so `New-Object -ComObject Shell.Application` published NO EDGE rather than a wrong
# one. Found by hand-auditing the F5 differential's MISSING samples, where
# `instantiates Extract-ZipLegacy -> Shell.Application` appears on ansible's own
# Windows modules, then confirmed in isolation.
#
# The accelerator rows are the other half: `New-Object` with a type accelerator
# (`-TypeName string`) constructs nothing the graph should name, and the pre-wave
# lane's `isTypeAccelerator` guard exists precisely so `uses -> string[]` cannot happen
# again. `New-Object [string]` and a bare `New-Object` with no flag are both pinned so
# the guard cannot be widened into silence.

function New-Com {
    $shell = New-Object -ComObject Shell.Application
    $app = New-Object -TypeName System.Text.StringBuilder
    $sb = New-Object System.Collections.ArrayList
    $text = New-Object -TypeName string
    $plain = New-Object
    return $shell, $app, $sb, $text, $plain
}
