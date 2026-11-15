# `local({ ... })` evaluates in a NEW environment, so nothing inside it is a
# file-level binding. Verified on R 4.4.3: `local({ x <- 1 })` leaves `ls()` empty.
inside_local <- local({
  trapped_by_local <- 1
  trapped_by_local
})
# A plain `{ ... }` block inside a call is a DIFFERENT thing: R evaluates it in the
# CALLING frame, so the binding really is global. Verified on R 4.4.3.
in_a_plain_block <- {
  bound_in_block <- 2
  bound_in_block
}
# An assignment nested as a call argument, inside parentheses, and inside a subset
# index all bind at file level in R. Verified on R 4.4.3 for each shape.
wrap <- function(x) x
bound_as_argument <- wrap(bound_via_argument <- 1)
(bound_via_parens <- 2)
vec <- 1:3
vec[bound_via_subset <- 1] <- 4
