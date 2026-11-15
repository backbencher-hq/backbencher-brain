import ./extbase

type ExtDerived* = ref object of ExtBase
  extra: int

method render*(d: ExtDerived): string =
  $render(d) & "!"
