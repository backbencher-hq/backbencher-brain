# PS-A2: a class's INHERITANCE edges. Authored 2026-09-27.
#
# `method-scope-psb3` already pins `extends` and `overrides`, but it declares
# `class TurboDeployment : Deployment` — ONE base and NO interface — so it cannot
# carry an `implements` row at all. `implements` was therefore emitted by live code
# with ZERO fixture rows and ZERO mutants: deleting the loop that produces it would
# have turned every gate in the repository green. Measured directly before authoring
# (script/m14/tmp probe over this file's shape): the analyzer emits extends 2,
# implements 1, overrides 2 with `overridesMember` set, and 2 import-annotated
# `references` for the two `using` directives.
#
# The subtree deliberately carries a method that is NOT overridden as well, so a
# naive "same name anywhere in the base" rule fails: `Describe` overrides,
# `Area` does not.

using module ./shapes.psm1

interface IShape {
    [string] Describe()
}

class Shape {
    [string] $Name
    [string] Describe() { return $this.Name }
    [double] Area() { return 0.0 }
}

class Circle : Shape, IShape {
    [double] $Radius
    [string] Describe() { return "circle" }
    [double] Area() { return 3.14 * $this.Radius * $this.Radius }
}

class Square : Shape {
    [string] Describe() { return "square" }
}
