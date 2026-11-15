import ./painter

type
  GlossPainter* = ref object of Painter
    sheen*: int

method paint*(g: GlossPainter): string =
  $paint(g) & "!" & $g.sheen
