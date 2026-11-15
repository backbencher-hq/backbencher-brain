external <- function(value) {
  local <- value
  local$field <- value
  callback <- function(x) x + 1
  ExternalClass$new(value)
  list(value)
}

anonymous_value <- identity(function(x) x)
