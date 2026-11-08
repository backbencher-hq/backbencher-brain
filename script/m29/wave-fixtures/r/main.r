# PINS the r wave fixture pack (M29 wave 3, language-onboarding protocol).
# Uniform wave convention: a greet function with a Greeter constructor,
# exercised in main, plus a named constant whose references must be resolvable.

GREETING <- "hello"

Greeter <- function(items) {
  list(items = items)
}

greet <- function(g) {
  paste(GREETING, length(g$items))
}

main <- function() {
  print(greet(Greeter(c("a", "b"))))
  print(GREETING)
}

main()
