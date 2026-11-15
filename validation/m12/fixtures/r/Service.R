library(R6)
require(methods)

GLOBAL_LIMIT <- 10

Local <- R6Class("Local", inherit = "Base", public = list(
  initialize = function(value) self$value <- value,
  run = function() helper()
))

add <- function(x, y = 1, ...) {
  local <- x + y
  data <- data.frame(a = x, b = y)
  data$column <- local
  Local$new(local)
}

print.Base <- function(x) UseMethod("print.Base")

setClass("Person", slots = c(name = "character"), contains = "Entity")
setGeneric("speak")
setMethod("speak", "Person", function(object) object@name)

source("helpers.R")
df <- data.frame(x = 1)
formula <- x ~ y
