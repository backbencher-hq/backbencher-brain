# R fixture — the `uses` surface: a member read of a value.
#
# Authored from R's own semantics, not from analyzer output. Every line here is a
# fact about what R evaluates, and each of the four gates the `uses` rule applies is
# pinned by at least one line that MUST produce no edge. A gate that no line
# exercises is not a gate; it is a comment.
#
# The measured motivation is in `probe-surfaces.ts`: over 1,890 real R files the
# corpus holds 16,621 `extract_operator` nodes and 2,891 `[[` subscripts, of which
# 14,307 and 547 respectively are NOT the callee of a call. Before this surface
# existed, every one of those produced nothing.
#
# Naming rule used throughout: the edge TARGET is the MEMBER NAME alone, never
# `receiver$member`. That is the name an R6/R5/S4/S7 property symbol is published
# under, so a `uses` edge joins to a real symbol instead of to a string that exists
# nowhere in the graph. The receiver rides in metadata.

# ---------------------------------------------------------------- 1. plain reads
# `obj$member` reads a member. It is not a call and not a package dependency, so it
# is a `uses` edge. `$` and `@` are the same surface: `@` is S4 SLOT access and a
# slot is a member.
read_two_members <- function(obj) {
  first <- obj$alpha
  second <- obj@beta
  list(first, second)
}

# ---------------------------------------------------------------- 2. the callee gate
# A member access that is the CALLEE of a call is already a `calls` edge whose
# target is the qualified form. A second edge to the bare member name would put one
# fact under two labels, which is the `uses`/`calls` confusion the ontology
# workstream names as its labelling question. NO `uses` edge from this function --
# not for `$`, not for `@`, and not for the `pkg::obj$fn` shape where the
# `namespace_operator` holds the call's function field and the `extract_operator` is
# its `rhs`.
read_via_call <- function(obj) {
  obj$compute(1)
  obj@render(2)
  pkg::obj$compute(3)
  list()
}

# ---------------------------------------------------------------- 3. the write gate
# A member access on the LEFT of an assignment is a WRITE: `obj$field <- v` stores
# into the member and does not read it. All three left-binding operators are
# exercised. `taken <- obj$field` on the last line is the SAME member in the VALUE
# position and MUST produce an edge, so this section fails if the rule is inverted
# as well as if it is missing.
write_member <- function(obj, v) {
  obj$writtenByArrow <- v
  obj$writtenBySuperArrow <<- v
  obj$writtenByEquals = v
  taken <- obj$field
  taken
}

# ---------------------------------------------------------------- 4. the nameability gate
# `[[` with a COMPUTED index names no member. `obj[[i]]` and `obj[[paste0(...)]]` must
# publish nothing, because naming a member here would be a guess, and a guess in an
# edge target is the fabrication the workstream calls its most expensive mistake.
computed_index <- function(obj, i) {
  obj[[i]]
  obj[[paste0("col", i)]]
  list()
}

# ---------------------------------------------------------------- 5. the `[` vs `[[` asymmetry
# In R the two subscripts are NOT interchangeable: `obj["name"]` is a character
# subset -- on a plain list it evaluates to NULL -- while `obj[["name"]]` is the
# member lookup. Two DIFFERENT member names, so that an edge to the `[` one cannot
# be satisfied by the `[[` one. With one shared name this section would pass
# whichever way the rule went, which is the "fixture that cannot fail" shape the
# workstream warns about.
bracket_one_is_not_a_member_read <- function(obj) {
  byOneBracket <- obj["viaOneBracket"]
  byTwoBrackets <- obj[["viaTwoBrackets"]]
  list(byOneBracket, byTwoBrackets)
}

# ---------------------------------------------------------------- 6. backticked
# A backticked member name is still a name. The grammar reports it as an `identifier`
# whose text carries the backticks, so the rule strips one pair -- the same
# normalisation every other name in this analyzer goes through. An unstripped target
# would be the literal string "`odd name`", which no symbol carries.
backticked_member <- function(obj) {
  obj$`odd name`
}

# ---------------------------------------------------------------- 7. chained
# `a$b$c` reads member `b` off `a`, then member `c` off the result. When the chain is
# NOT invoked both are reads, so both are edges. When the same chain IS invoked the
# outer access is the callee -- already a `calls` edge to `a$b$c` -- and only `b` is a
# read: the receiver of a call is traversal, not a use.
chained_read <- function(a) a$b$c
chained_call <- function(a) a$b$c()

# ---------------------------------------------------------------- 8. attribution
# A read inside an anonymous function is attributed to the nearest enclosing NAMED
# symbol at 0.7 with a reason code -- the same attribution rule `calls` uses, so the
# two surfaces cannot disagree about who owns a body. A read with NO enclosing named
# symbol is counted in `metadata.callAttribution.memberReadsUnresolvedScope` and
# given no edge: `read_at_file_scope` below is exactly that case, and 55.6% of R's
# call sites are at file scope, so the case is common rather than exotic.
read_in_closure <- function(v) {
  lapply(v, function(e) e$inner)
}
read_at_file_scope <- structure(list())$orphan

# ---------------------------------------------------------------- 9. real R6 shape
# The surface as tidyverse code writes it: an R6 object read inside its own methods,
# and a list element read by `[[`. R6 members are published as `method`/`property`
# symbols, so these targets are exactly the names an R6 member carries.
Counter <- R6::R6Class("Counter",
  public = list(
    value = 0,
    read_state = function() {
      self$value
    },
    bump = function(by) {
      self$value <- self$value + by
      invisible(self)
    },
    read_via_bracket = function() {
      self[["value"]]
    }
  )
)
