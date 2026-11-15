# `::` and `:::` name a PACKAGE DEPENDENCY, and both dependency labels carry it.
#
# F07 already pins `imports` for the namespace access. This file pins the OTHER label:
# `references`, which src/ast/types.ts:72 declares to BE the dependsOn type
# (`DependsOn = "references"`). Before this fixture the analyzer emitted `imports` here
# and `references` for library()/require()/source() — so a consumer asking "what does
# this file depend on" by reading `references` saw 0 of these. Measured cost of that
# asymmetry over the admitted R corpus: 1,751 namespace accesses, which held `references`
# recall at 16.9% where the independent oracle derives 2,171 edges.
#
# The trap this file exists to make un-missable: the TARGET IS THE PACKAGE, never the
# exported name. `references global -> filter` would assert that a package called
# `filter` exists, and `dplyr` is the package. Both are pinned below, one as required and
# one as forbidden, because a wrong-but-plausible target passes a presence check.
dplyr::filter(df, x > 1)
stats::median(x)
# `:::` reaches an INTERNAL object — same operator node type, same package target, and
# the access is just as hard a dependency: R must load the namespace to evaluate it.
internal:::secret()
utils::globalVariables(".my_var")
# A namespace access INSIDE a function body is still a file-level dependency: `::`
# resolves at parse time regardless of where it is written, so the source endpoint stays
# `global` and not the enclosing function. This is the R asymmetry that makes the
# attribution a judgement rather than a lookup.
compute <- function(v) {
  tibble::tibble(x = v) |> purrr::map_dbl(identity)
}
# The lhs may be a QUOTED name — `base` is not reserved, but backticks are legal on any
# identifier, and a reader that does not unquote publishes the literal "`glue`", a name
# no package has.
`glue`::glue(x)