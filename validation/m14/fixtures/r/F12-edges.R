#' Exported function
#' @export
public_fn <- function() 1

#' Exported constant
#' @export
PUBLIC_CONST <- 5

# not exported
private_fn <- function() 2

Base2 <- R6Class("Base2", public = list(render = function() base_impl()))
Child2 <- R6Class("Child2", inherit = Base2, public = list(render = function() child_impl()))
Other2 <- R6Class("Other2", public = list(render = function() other_impl()))
