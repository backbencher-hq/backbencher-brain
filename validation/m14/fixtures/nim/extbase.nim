type ExtBase* = ref object of RootObj
  label*: string

method render*(b: ExtBase): string {.base.} =
  b.label
