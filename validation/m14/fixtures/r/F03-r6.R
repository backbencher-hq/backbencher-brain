# R6: class with public methods, public fields, private members, active bindings.
Widget <- R6::R6Class("Widget",
  public = list(
    size = 10,
    initialize = function(start = 0) {
      self$size <- start
      private$log("init")
    },
    grow = function(by = 1) {
      self$size <- self$size + by
      invisible(self)
    }
  ),
  private = list(
    log = function(msg) NULL,
    token = "abc"
  ),
  active = list(
    doubled = function(value) self$size * 2
  ),
  inherit = BaseWidget
)
