# Negatives: nothing below is a declaration.
# commented_out <- function() 1
#' roxygen for nothing
txt1 <- "R6Class <- function() library(evil)"
txt2 <- 'a <- b %>% c()'
txt3 <- "setClass(\"Fake\", slots = c(z = \"numeric\"))"
txt4 <- "pkg::not_a_real_import()"
# library(NotReal)
still_a_var <- 1
`backtick name` <- 2
`%op%` <- function(a, b) a
callback <- function(x) {
  local_only <- x + 1
  local_only
}
