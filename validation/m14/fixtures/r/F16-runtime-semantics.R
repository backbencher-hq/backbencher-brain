# Names R binds only if the file actually RUNS. Every expectation here was taken from R
# EXECUTING the file, not from reading the analyzer -- which is the point: a fixture written
# by reading the analyzer cannot catch the analyzer's own blind spots.
#
# Found by a red-team cross-check that evaluated each corpus file and asked R's environment
# what it held. Three classes, all found that way.

# 1. A QUOTED assignment target. R binds the name; the analyzer required an `identifier`
#    node and published nothing. ggplot2/R/theme-current.R:130 writes `"%+replace%" <-`.
"%+replace%" <- function(e1, e2) e1
"plain quoted" <- 42
`backticked` <- 1
bare <- 2

# 2. A statically dead branch declares nothing. `if (FALSE)` never executes, so R binds
#    nothing inside it -- but both the analyzer and the R-oracle's walk descended in.
#    The else branch of a dead condition DOES run, and must be collected.
if (FALSE) {
  dead_one <- 1
  dead_two <- 2
} else {
  live_alt <- 9
}
if (F) dead_three <- 3

# 3. A top-level `rm()` UNBINDS. A helper defined, used to register methods, and removed is
#    ordinary practice; Matrix does it in at least eight files.
removed_helper <- function(x) x
uses_the_helper <- removed_helper(1)
rm(removed_helper)

# Still bound: defined after the rm, and inside a function (a local, so not a binding).
after_rm <- 5
f <- function() { inside_fn <- 6; inside_fn }
