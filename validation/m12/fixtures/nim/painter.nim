type
  Painter* = ref object of RootObj
    canvas*: string

method paint*(p: Painter): string {.base.} =
  p.canvas
