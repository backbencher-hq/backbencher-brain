# `..1` is R's reference to an enclosing function's first argument and is its own
# token, but `..2dge` is ONE identifier. The comment here used to say "R 4.4.3
# accepts `..2dge <- 1; ls()`" as the evidence, and `ls()` is the WRONG ORACLE for
# it: `ls()` hides dot-prefixed names by default, so it reports nothing for a
# binding R unambiguously makes. On R 4.6.1:
#
#   e <- new.env(); eval(parse(text = "..2dge <- function(from) from"), e)
#   ls(e)                      # character(0)          <- the sloppy oracle
#   ls(e, all.names = TRUE)     # "..2dge"              <- the fact
#   exists("..2dge")            # TRUE
#
# So the analyzer publishing both names is CORRECT, and a fixture that had been
# checked with `ls()` would have "found" a defect that is not there.
..2dge <- function(from) from
..foo <- function() 1
uses_dot_one <- function(..1) ..1
