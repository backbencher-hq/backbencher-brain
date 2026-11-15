# NIM contract fixture — every construct the M12 symbol/relationship contract
# claims, in one file. This source is ACCEPTED BY THE REAL NIM 2.2.12 COMPILER
# (`nim check`, recorded in the fixture comment header of the expectation file),
# so nothing here is a construct the compiler rejects.
import std/[os, strutils]
import std/macros
import std/private/globs
import ./helpers
import ../shared

type
  Color* = enum
    Red, Green, Blue

  Shape = ref object of RootObj
    name*: string
    sides: int
    color: Color

  Rect = ref object of Shape
    w, h: int

  Registry*[T] = object
    items: seq[T]
    count: int

  Pair = tuple[x, y: int]
  Anon = (int, string)
  Meters = distinct float

const MaxItems* = 32
const Names = ["a", "b"]

let Greeting* = "hello"
var counter = 0

type
  Addable = concept x
    (x + x) is SomeNumber

proc area*(s: Rect): int {.inline.} =
  ## Area of a rectangle. Exercised as a doc comment through the real CLI.
  s.w * s.h

func double*(x: int): int =
  x * 2

proc withDefaults*(a: int, b: int = 2, c: string = "z"): string =
  $a & $b & c

method describe*(s: Shape): string {.base.} =
  s.name

method describe*(s: Rect): string =
  s.name & "/" & $area(s)

iterator countUp*(n: int): int =
  for i in 0 ..< n:
    yield i

converter toFloat*(x: int): float =
  float(x)

template twice*(x: untyped): untyped =
  (x, x)

from ./mac import retTrue

type
  Builder = object
    parts: seq[string]

  FileInfo = object
    fileStem: string
    fileSize: int

proc add*(b: var Builder, p: string) =
  b.parts.add p

var written* = 0

proc build*(b: Builder): string =
  result = b.parts.join(",")
  written = b.parts.len

proc stemOf*(path: string): string =
  let (_, fileStem, _) = splitFile(path)
  fileStem

proc makeRect*(w, h: int): Rect =
  Rect(name: "r", w: w, h: h, color: Red)

proc exercise*() =
  let r = makeRect(2, 3)
  let a = area(r)
  let d = double(a)
  var b: Builder
  b.add "x"
  let s = b.build
  for i in countUp(3):
    discard i
  try:
    discard retTrue()
  except ValueError as e:
    echo e.msg
  defer:
    counter = counter + 1
  echo s, d, Greeting, $MaxItems, join(Names, ","), r.describe,
       float(toFloat(counter)), $(1, 2)
