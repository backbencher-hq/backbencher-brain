Base <- R6Class("Base", public = list(
  initialize = function(value) {
    self$value <- value
  },
  run = function() {
    helper()
  }
))
