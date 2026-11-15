# Every VALID way R binds a top-level name. Each form was checked by running
# R 4.4.3, not by reading the grammar. The invalid rightward forms live in
# F13-invalid-r.R, where the analyzer must publish nothing.
left_arrow <- 1
equals <- 2
super_left <<- 3
5 -> right_from_value
8 ->> super_b
fn_left <- function() 1
# A declaration whose NAME is written BELOW the first line of its own range: the
# edge that names it must point at the name, not at the start of the expression.
some_helper_call(
  first_arg
) -> deferred_name
