# PSD12 — a TYPE ACCELERATOR names a FRAMEWORK type, so the row is published under that type's name.
#
# `[string]::IsNullOrWhiteSpace($x)` is `System.String.IsNullOrWhiteSpace`. The analyzer used to keep
# the written spelling and emit `ownerMemberAbsent {owner: "string"}` — a claim whose owner NO admitted
# file declares, so the arbiter could only answer UNVERIFIED (2,256 such rows over the population, the
# largest single class in `ext?`). The claim was also false in its own terms: it asserts the owner is
# published, and `string` is not.
#
# The resolved name makes the row checkable, because its root is a documented namespace:
# `System.Math.Max` is the shape `[System.Math]::Max` already produced, and the namespace pass
# certifies the root from its list.
#
# THE NEGATIVES ARE THE POINT OF THE FILE:
#   3. a class declared HERE of the same spelling SHADOWS the accelerator — PowerShell's class lookup
#      is case-insensitive, so `class Regex` wins over `[regex]`, and the call must bind in-file;
#   4. a BARE name whose resolution is NOT documented (`[Path]` — there is no `System.Path`) keeps its
#      previous treatment: it is not rewritten to a type nobody can name;
#   5. a DOTTED literal (`[IO.Path]`) is outside the population by construction and carries the generic
#      externality reading instead.

# 1. POSITIVE — an accelerator for a .NET primitive type alias.
$blank = [string]::IsNullOrWhiteSpace('x')

# 2. POSITIVE — the same mechanism for a struct, to show the table is not one entry deep.
$id = [guid]::NewGuid()

# 3. NEGATIVE TWIN — a class THIS FILE declares under the accelerator's spelling. `[Regex]` is the
#    file's class, not `System.Text.RegularExpressions.Regex`, and the call binds to the declaration.
class Regex {
    static [string] Pattern() {
        return 'local'
    }
}
$local = [Regex]::Pattern()

# 4. NEGATIVE TWIN — `[Path]` has no documented resolution (`System.Path` does not exist; the
#    assembly search can return more than one type of that name), so no type name may be invented.
$combined = [Path]::Combine('a', 'b')

# 5. THE SECOND HALF — a dotted literal names `System.IO.Path` through the implicit-`System.` rule and
#    is outside the population by construction. It keeps the generic reading, with its owner intact.
$full = [IO.Path]::GetFullPath('a')

# 6. THE DECLARED SPELLING — PowerShell class and member lookup is case-insensitive, so
#    `[counter]::Zero()` calls `class Counter`'s method. The store's qualified name is built from the
#    DECLARATION, so the target must be `Counter.Zero`, not the literal's `counter.Zero`.
class Counter {
    static [int] Zero() {
        return 0
    }
}
$zero = [counter]::Zero()
