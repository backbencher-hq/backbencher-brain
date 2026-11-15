# `:::` reaches another package's internals. The R6 constructor reached through
# `:::` must still be recognised as a class declaration.
Hidden <- R6:::R6Class("Hidden",
  public = list(go = function() do_work())
)
Plain <- R6::R6Class("Plain",
  public = list(go = function() do_other())
)
# An UNNAMED list element that happens to be a function is not a member and must
# not become a method named after its own source text.
Odd <- R6Class("Odd", public = list(1, function(x) x, real = function() 1))
use_it <- function(n) {
  a <- Hidden$new()
  b <- Plain$new()
  c <- NotDeclaredAnywhere$new()
  d <- new("Hidden")
  list(a, b, c, d)
}
