# Calls made from inside anonymous function expressions passed as arguments.
outer <- function(items) {
  lapply(items, function(item) transform_one(item))
  vapply(items, function(item) transform_two(item), numeric(1))
  tryCatch(risky(), error = function(e) recover_from(e))
  withCallingHandlers(step(), warning = function(w) note_warning(w))
  local({
    nested()
  })
}
