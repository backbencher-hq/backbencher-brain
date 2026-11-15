# PS28 — `overrides` under-fired by 10 of 12 edges on one corpus file.
#
# Two independent defects, both in the matcher rather than in the tree, and both
# measured on powershell/test/powershell/Language/Classes/scripting.Classes
# .inheritance.tests.ps1 — a Pester file that redeclares `A`, `B`, `C`, `bar`,
# `baz`, `MyIntList` and `TestHost` across roughly forty `It` blocks.
#
#   (a) `classMembers.set(className, new Set())` ran on EVERY class_statement, so
#       only the LAST declaration of a class name kept its members. The last
#       `class B` in that file declares only a constructor, so the member set for
#       `B` was empty; the last `class A` declares only properties `i` and `s`, so
#       the set for `A` held no methods. The parse tree holds 8 same-name
#       derived/base method pairs in that one file and the matcher could see 2.
#   (b) The name comparison was CASE-SENSITIVE, in a language whose identifiers
#       are not and in a file whose own base declares `foo` while the derived class
#       declares `fOo`. Every other name comparison in the analyzer lowercases
#       first, and `pushSymbol` says why: "`$Foo` and `$foo` are ONE variable".
#
# After the fix the file yields 12 `overrides` edges instead of 2. This fixture
# reproduces both shapes in miniature, and the redeclaration here is DELIBERATE: a
# fixture with one declaration per class name cannot reach either defect, which is
# why pass 1's suite could not see them.

class Base {
    [int] GetName() { return 1 }
    [int] ToStr() { return 2 }
    [int] Noop() { return 3 }
}

# Case (b): the same member, spelled differently. Under PowerShell's rules
# `Getname` IS `GetName`, so this overrides it.
class MixedCase : Base {
    [int] Getname() { return 10 }
    [int] ToStr() { return 20 }
}

# Case (a): `Later : MixedCase` is declared, then `MixedCase` is REDECLARED with
# only a property. Before PS28 the re-declaration reset `classMembers["MixedCase"]`
# to an empty set, so `Later`'s two members found nothing to override.
class Later : MixedCase {
    [int] Getname() { return 30 }
    [int] ToStr() { return 30 }
}

class MixedCase {
    [int] $marker = 0
}

# A redeclaration that introduces a NEW member: the union has to keep it, or a fix
# for (a) that only preserved the first declaration would drop this override.
class Introduced : Later {
    [int] Getname() { return 40 }
    [int] ToStr() { return 40 }
    [int] BrandNew() { return 41 }
}

class Introduced2 : Later {
    [int] Getname() { return 50 }
    [int] ToStr() { return 50 }
    [int] LaterAdded() { return 51 }
}