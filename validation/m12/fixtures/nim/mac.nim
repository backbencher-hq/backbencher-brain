import std/macros

macro retTrue*(): untyped =
  ## A macro declaration is what the fixture pins (the analyzer must read
  ## `macro_declaration` as a Macro symbol); the body just has to be legal Nim.
  result = newLit(true)
