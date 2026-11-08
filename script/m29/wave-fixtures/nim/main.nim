# PINS the nim wave fixture pack (M29.R2 wave 3, wave-onboarding lane C).
# Uniform wave convention: type Greeter with proc greet, exercised in main.

type
  Greeter* = object
    items*: seq[string]

proc newGreeter*(items: seq[string]): Greeter =
  Greeter(items: items)

proc greet*(greeter: Greeter): string =
  "hello " & $greeter.items.len

when isMainModule:
  let greeter = newGreeter(@["a", "b"])
  echo greet(greeter)
