# NIM negative fixture — the SUPPRESSION contract. Everything here is legal Nim
# (accepted by Nim 2.2.12 `nim check`), and every declaration below must
# SUPPRESS a symbol, a call, or a relationship. This is the half of the contract
# that catches phantoms: a positive fixture alone passes for an analyzer that
# emits everything.
import strutils
import ./extmod

const TopConst = 1
let TopLet = 2
var TopVar = 3

type
  Host = object
    field: int

proc suppressed*(a: int, b: string): Host =
  # parameters are NOT symbols
  let localOne = a
  var localTwo = 2
  const localThree = 3
  for idx in 0 ..< b.len:
    discard idx
  try:
    discard localOne
  except ValueError as err:
    discard err
  defer:
    discard localTwo
  block:
    discard localThree
  let anon = proc (q: int): int = q
  discard anon(1)
  echo "builtins echo/discard/inc are never calls"
  inc TopVar
  return Host(field: localOne)

method dispatchOnHost(h: Host): int =
  h.field

proc usesExternal() =
  # `externalHelper` is declared in ANOTHER file (extmod.nim). It is legal Nim
  # and it must produce a `calls` edge with evidenceClass import_based — the
  # analyzer cannot drop a call just because the target is not in this file.
  let v = externalHelper(1)
  discard v
