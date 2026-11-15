# S3: methods registered by the generic.class naming convention.
print.myclass <- function(x, ...) {
  cat("mine")
  invisible(x)
}
summary.myclass <- function(object, ...) {
  helper_one()
  NULL
}
not_a_method <- function() 1
`[.myclass` <- function(x, i) x
