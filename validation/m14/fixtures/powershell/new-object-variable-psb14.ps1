# PS29: `New-Object` whose constructed "name" is a VARIABLE. Authored 2026-10-03.
#
# `New-Object`'s constructed name is `comObject ?? typeName ?? positional`, and all
# three readers produce TEXT. Before this pass nothing asked whether that text came
# from a variable node or a literal one, so `New-Object $type` published
# `instantiates -> type` — an edge asserting the target IS a type, when the source
# says "constructs whatever that variable holds", resolved at run time.
#
# Measured over all 1,108 admitted corpus files through production `parseFile`, and
# cross-referenced against the symbol table OF THE FILE THAT PUBLISHED IT (so a
# corpus-wide name collision cannot explain it): 123 of 1,268 `instantiates` edges —
# 9.70% — named a `variable` symbol their own file declares.
#
# This is the class the lane already declares fixed for `calls`: F9 turned
# `$type::$method()` from `calls -> $method` into `uses -> method` because a
# `$`-prefixed member is a VARIABLE, not a name. `instantiates` did not get the same
# treatment and this file is what pins it.
#
# The twin matters more than the positive row. `New-Object System.Version` and
# `New-Object $type` are the same code path with a different node underneath, so a fix
# that simply suppressed the variable form would satisfy every positive row here and
# still be wrong. The `-TypeName '…'` and positional-literal rows below are the ones
# that keep `instantiates` firing on the shapes it is for.

function New-Dynamic {
    # The VARIABLE form, positional. A bare `$type` is wrapped by the pinned wasm in an
    # `array_literal_expression`, which is why this arrives on the POSITIONAL branch
    # even though there is no flag at all.
    $a = New-Object $typeName

    # The VARIABLE form behind a flag. `parameterValue` accepts only a generic_token /
    # string_literal / expandable_string_literal, so it finds nothing here and the
    # positional reader takes it — the flag changes nothing about the node underneath.
    $b = New-Object -TypeName $typeName

    # The COM ProgID behind a flag, same shape.
    $c = New-Object -ComObject $progId

    # The INTERPOLATED form: a double-quoted argument. It reaches the tree as
    # array_literal_expression > unary_expression > string_literal >
    # expandable_string_literal > variable, so the WRAPPER's descendant search is what
    # finds it. Single quotes below are the control: `'$literalType'` is a literal string
    # in PowerShell and must NOT be read as a variable reference — the two are separated
    # by what is inside the wrapper (`verbatim_string_characters`), not by a `$` in text.
    $d = New-Object "$typeName"
    $e = New-Object '$literalType'

    # THE TWIN — all three are literals and all three must keep emitting `instantiates`.
    $lit1 = New-Object System.Version
    $lit2 = New-Object -TypeName System.Text.StringBuilder
    $lit3 = New-Object -TypeName 'System.Collections.ArrayList'
    return $a, $b, $c, $d, $e, $lit1, $lit2, $lit3
}