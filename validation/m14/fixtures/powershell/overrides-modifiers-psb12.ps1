# PS25 / PS26 / PS27 — pass-2 adversarial fixture. Three removals, and the
# CORPUS DELTA of each is stated rather than implied.
#
# All three were found by writing the strongest argument against an emitted label
# and measuring it (`validation/m14/fixtures/powershell/adversarial-probes.ts`).
# All three are pinned HERE because the corpus cannot reach them:
#
#   PS25  `Export-ModuleMember -Function Measure*` — the corpus DOES carry this,
#         7 of the lane's 113 `exports` edges, all of them target `Measure*`. The
#         pre-fix guard was `startsWith("*")`, so it refused the one spelling
#         nobody writes and published the common one.
#   PS26  `hidden` / `static` / member-kind on an `overrides` match — the corpus
#         carries 0 `hidden` class members, 0 `static` class members, and 0
#         same-name derived/base pairs whose kinds differ, over all 1,108
#         admitted files. Measured delta: 0 edges.
#   PS27  a class member's name SPLIT by the pinned wasm's lexer — `[int]
#         StaticOpen()` parses as class_attribute "Static" + simple_name "Open",
#         so the method was published as `Open`. Root cause is
#         grammars/tree-sitter-powershell/grammar.js:1266 with
#         `caseInsensitive` (line 1839) emitting no word boundary. This fixture
#         pins the analyzer's mitigation of the NAMING half; the destruction half
#         (`[int] Hidden()`, `[int] Static2()` become ERROR nodes) is a grammar
#         fix and is reported, not repaired here.
#
# The CONTROL rows matter as much as the negative ones. A `forbid` passes just as
# happily against an analyzer that emits nothing, so every rejected construct has a
# sibling that IS published, and `expectRelationshipCount` pins the totals.

# ---------------------------------------------------------------- PS27: the split
# `StaticOpen` with NO leading modifier is the trigger. `static [int]
# StaticOpen()` two lines below parses correctly, which isolates the trigger to the
# ABSENCE of a modifier rather than to the identifier text.
class SplitBase {
    static [int] StaticOpen() { return 1 }
    [int] HiddenThing() { return 2 }
    [int] Stat() { return 3 }
}

class SplitDerived : SplitBase {
    [int] StaticOpen() { return 10 }
    static [int] StaticOpen() { return 11 }
}

# --------------------------------------------------------- PS26: the modifiers
class HiddenBase {
    hidden [int] Secret() { return 1 }
    [int] Open() { return 2 }
    [int] AlsoOpen() { return 3 }
    static [int] StaticBase() { return 4 }
}

class DerivedOverHidden : HiddenBase {
    [int] Secret() { return 10 }
    [int] Open() { return 20 }
    [int] AlsoOpen() { return 30 }
    [int] StaticBase() { return 40 }
}

# PS26 kind asymmetry: a derived METHOD named like a base PROPERTY is two different
# members. `classMembers` was filled from properties as well as methods, so this pair
# published an `overrides` edge naming a method overriding a property.
class BaseWithProp {
    [int] Shared() { return 1 }
    [int] $OnlyProp = 2
}

class DerivedOverProp : BaseWithProp {
    [int] Shared() { return 10 }
    [int] $OnlyProp = 20
}

# The reverse direction, which the pre-fix asymmetry made UNREACHABLE: a derived
# PROPERTY never became an override candidate, so this pair published nothing.
class BaseForProp {
    [int] $Slot = 1
}

class DerivedProp : BaseForProp {
    [int] $Slot = 2
}

class Base2 {
    [int] Shared() { return 1 }
}

class DerivedNormal : Base2 {
    [int] Shared() { return 10 }
}

# ------------------------------------------------------------- PS25: the exports
function Get-Widget { return 1 }
function Get-Gadget { return 2 }
function Get-Sprocket { return 3 }

Export-ModuleMember -Function Get-Widget
Export-ModuleMember -Function Measure*
Export-ModuleMember -Function *
Export-ModuleMember -Function Get-Sprocket?
Export-ModuleMember -Variable Get-Gadget