# PS-A4: a VARIABLE REFERENCE, in every spelling PowerShell has. Authored 2026-09-27.
#
# Written from the F9 completeness audit, which found these by asking a question no
# gate was asking: of the grammar's 152 named node types at audit time (154 on re-measure), which ones does the analyzer
# never name? `braced_variable`, `*_increment_expression` and
# `expandable_here_string_literal` were in that set, and probing them found five real
# defects — a variable read correctly in one spelling and not in another.
#
# The verification that found them is in the review: a line-level check over all 25,023
# variable-reference edges in the corpora, asking whether the declared line actually
# contains the variable. It read 96.75% on the first run and 100.00% after, and every
# defect it found is pinned below.

$plain = 1
${braced} = 2
$splatArgs = @{ A = 1 }

# 1. every SPELLING of a bare read reaches the graph as the SAME symbol
Write-Host $plain
Write-Host ${braced}
Write-Host ($plain)

# 2. SPLATTING: `@name` is the same variable as `$name`
New-Item @splatArgs

# 3. an ARGUMENT is a use — this was the big one. `Write-Host $a` published the call
#    edge and no read at all, so every variable handed to a cmdlet was invisible.
Write-Host $plain $braced

# 4. an EXPANDABLE HERE-STRING is interpolated, and each read lands on its OWN line.
#    The grammar gives the interpolation a span that starts at the END of the previous
#    line, so the edge used to be published one line high, and its target carried the
#    line break and the sigil: `uses -> "\n$message"`.
$report = @"
first: $plain
second: ${braced}
"@

# 5. a DYNAMIC method target is a VARIABLE holding a method name, not a method name.
$type = [IO.Path]
$method = "GetRandomFileName"
$type::$method()

# 6. an INCREMENT/DECREMENT reads its operand, in all four spellings. The prefix
#    forms nest the operand one level deeper, which a direct-child lookup misses —
#    the same shape of miss as `sub_expression` and `left_assignment_expression`.
$count = 0
$count++
$count--
++$count
--$count

# 7. a COMPOUND assignment READS its left side, and a plain one does not. The
#    operator is the whole distinction: `=` writes only.
$total = 0
$total += 1
$total -= 1

# 8. a scope-qualified READ is an external dependency, while its ASSIGNMENT still
#    declares nothing. PS8's ruling is about DECLARATIONS and stands unchanged —
#    `$env:FOO = 'x'` below declares no symbol, and the forbid row pins that. But a
#    READ of one is a real dependency on something outside the file, and the read path
#    was reusing the DECLARATION guard, so `Write-Host $env:TEMP` published nothing.
$env:IGNORED = 'assignment declares nothing'
$env:TEMP = '/tmp'
Write-Host $env:TEMP
$script:cfg = 1
Write-Host $script:cfg
Write-Host $_
