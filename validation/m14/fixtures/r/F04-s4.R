# S4: classes with slots (both idioms), generics, methods, validity, inheritance.
setClass("Vehicle", slots = c(wheels = "numeric", owner = "character"))
setClass("Car", contains = "Vehicle", slots = c(doors = "numeric"))
setClass("Legacy", representation(legacy_field = "numeric"))
setGeneric("speed", function(vehicle) standardGeneric("speed"))
setMethod("speed", "Vehicle", function(vehicle) {
  compute_speed(vehicle)
  1
})
setMethod("show", signature("Vehicle", "missing"), function(object) cat("v"))
setValidity("Vehicle", function(object) object@wheels >= 0)
