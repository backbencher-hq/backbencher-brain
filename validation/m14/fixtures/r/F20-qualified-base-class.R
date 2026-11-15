# F20-qualified-base-class.R — a base class can be NAMED WITH ITS PACKAGE.
#
# R writes a base class three ways and the analyzer read two of them:
#
#     inherit = Parent        identifier          -> Parent     (read)
#     contains = "Parent"     string              -> Parent     (read)
#     inherit = pkg::Parent   namespace_operator  -> DROPPED    (the gap)
#
# The third is real R6 syntax: `inherit` may name a class defined in another
# package, which is the only way to inherit across a package boundary without
# exporting a constructor call. R6's own test suite writes it at
# `R6/tests/manual/test-inheritance.R:126`:
#
#     BC <- R6Class(
#       inherit = R6testA::AC,
#       public = list(y = 2)
#     )
#
# A census of every class-constructor call in the admitted corpus — 738 across
# 2,342 R files (`new_class` 283, `R6Class` 229, `setClass` 201,
# `new_base_class` 12, `setRefClass` 9) — found exactly ONE qualified base class,
# so this is a one-edge gap and is pinned as one. All four carriers are exercised
# here because `extractNamedArguments` is the one helper behind all of them, so a
# fixture that tested only R6 would pass with S4 and S7 still broken.
#
# The edge carries the BARE class name. `pkg::Parent` names the class `Parent`,
# which is what `class(x)` returns and what dispatch keys on; a symbol named
# `pkg::Parent` binds to nothing in any file. `forbidRelationships` pins that.

library(R6)

# R6: the corpus form, verbatim in shape.
BC <- R6::R6Class(
  inherit = pkgA::AC,
  public = list(y = 2)
)

# R5: `contains` takes a character vector, so the qualified spelling can sit
# inside `c(...)` as well as stand alone.
RC <- setRefClass(
  "RC",
  contains = c("VIRTUAL", pkgB::BaseRC)
)

# S4.
SC <- setClass("SC", contains = pkgC::BaseSC)

# S7: `parent =` on `new_class`.
class_sd <- S7::new_class(name = "sd", parent = pkgD::BaseSD)

# And the plain spellings, so the fixture fails if the qualified read over-corrects
# and starts publishing `pkg` as a class name or mangling an unqualified base.
CD <- R6::R6Class(inherit = AC, public = list(z = 3))
