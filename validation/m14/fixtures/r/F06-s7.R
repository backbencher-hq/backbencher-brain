# S7: new_class with parent and properties, and method registration.
Temperature <- S7::new_class("Temperature",
  parent = Measurement,
  properties = list(celsius = class_double, scale = class_character)
)
S7::method(format, Temperature) <- function(object, ...) {
  paste0(object@celsius, "C")
  helper_format()
}
# S7 dispatches on a SET of classes. The owner must come from the FIRST named
# class in that list, and must be a named argument so a positionally-indexed
# list is not mistaken for one.
S7::method(format, list(Reading, Writing)) <- function(object, ...) {
  paste(as.character(object), collapse = "")
}
S7::method(show, list(Reading, Writing)) <- function(object) invisible(NULL)
