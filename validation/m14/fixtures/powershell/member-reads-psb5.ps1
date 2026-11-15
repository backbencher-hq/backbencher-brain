# PS9 — a MEMBER READ is a `uses` edge.
#
# WHY. The pre-wave lane had a `case "member_access"` whose entire body was
# `break`, commented "Property reads ($obj.Prop) are not declarations or calls —
# no edge". So the language emitted **ZERO** `uses` edges in 2,145 symbols and
# 3,410 relationships, while the 105 grammar types it never named include
# `member_access` (20,188 occurrences in the production draw), `element_access`,
# `sub_expression` and `type_name`. This is the #740 kotlin defect class ("emits
# no member uses at all") in a second language, with no issue filed, because no
# corpus lane existed to see it.
#
# The six read forms PowerShell actually has, one per line, so a regression that
# fixes one and drops another fails here:
#
#   1. `$obj.Prop`               — the plain member read
#   2. `$this.Prop = value`      — a member WRITE is also a use
#   3. `$hash['Key']`            — element access with a CONSTANT key names a slot
#   4. `$list[$i]`               — element access with a VARIABLE key is a read of it
#   5. "$($obj.Method())"        — an interpolated SUBEXPRESSION (the groovy G7
#                                  class: 283 such sites in the draw, all dark)
#   6. "$name"                   — a bare interpolated variable
#
# The receiver is NOT part of the target: the family contract is the member
# LEAF, never the dotted chain (web-family ruling R2 / M60 R10).

class Session {
    [string]$User = 'root'
    [int]$Attempts = 0
}

$s = [Session]::new()
Write-Host $s.User
$s.Attempts = 1

$settings = @{ Retries = 3; Label = 'prod' }
Write-Host $settings['Label']

$names = @('a', 'b', 'c')
$index = 1
Write-Host $names[$index]

Write-Host "user=$($s.User)"
Write-Host "plain=$settings"

# 7. a NUMERIC dotted chain is a parse shape, not a member read. The grammar hands
#    `1.2` and `3.4` to the member pass as `member_name` nodes, and they are not
#    names: publishing `uses -> 2.3` names a symbol no project can declare, so the
#    incoming gate counted the rows as external claims its own project refuted.
#    The receiver is not published either (the family leaf contract), so the correct
#    number of edges on these two lines is ZERO, pinned by the forbid rows below.
$intKeys = 1
$intKeys.1.2.3.4
$1.2.3.4
