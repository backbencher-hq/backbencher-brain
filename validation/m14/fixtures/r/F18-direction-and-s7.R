# Two defects the lane oracle found, both pinned here.
#
# 1. `overrides` ran BASE -> member. `Child2$render` is what overrides
#    `Base2$render`; the base declaration is what gets overridden. Every other
#    analyzer in this repo runs the edge the other way (real-kotlin-analyzer.ts:537,
#    real-java-analyzer.ts:1866) and script/m60/objc-line-truth.ts:77 states it:
#    "an override's line is the overriding declaration". Three classes declare
#    `render` here so the direction cannot be read off the target alone.
Base2 <- R6Class("Base2", public = list(render = function() base_impl()))
Child2 <- R6Class("Child2", inherit = Base2, public = list(render = function() child_impl()))
Other2 <- R6Class("Other2", public = list(render = function() other_impl()))
# A three-level chain: GrandChild2 overrides Child2, not Base2. Under the old
# direction this edge named Base2 and the graph claimed the ROOT of the chain was
# the override.
GrandChild2 <- R6Class("GrandChild2", inherit = Child2, public = list(render = function() grand_impl()))

# 2. `@export` on an S7 class binding named the CLASS, not the binding.
#    `class_logical <- new_base_class("logical")` binds `class_logical`; roxygen2
#    writes `export(class_logical)` and S7's own generated NAMESPACE has it at
#    line 66 with `export(logical)` appearing zero times in the file.
#' @export
class_logical <- new_base_class("logical")
#' @export
class_double <- new_base_class("double")

# 3. The shared-machinery loss. A REPLACEMENT FUNCTION is a real R name: R binds
#    `` `data<-` `` and a package exports it, and roxygen2 quotes it in NAMESPACE
#    precisely because the name is not a bare identifier — `export("S7_data<-")` is
#    S7/NAMESPACE:35. The analyzer emits both edges. Production `parseFile` deletes
#    them, at src/ast/pool-worker.ts:594, because the target's leaf contains `<`.
#' @export
#' @rdname S7_data
`S7_data<-` <- function(object, check = TRUE, value) object
# A replacement call is the same name reached from a call site.
replace_it <- function(x) {
  x[1] <- 99
  names(x) <- "only"
  x
}