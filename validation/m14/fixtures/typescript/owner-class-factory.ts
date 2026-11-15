// owner-class-factory — C5 FACTORY-RETURN ANNOTATION TYPING.
// `const w = makeWidget()` where `makeWidget(): Widget` is declared in the SAME file (both orders).
export class Widget { run(): void {} }
export function makeWidget(): Widget {
  return new Widget()
}
export function useFactory(): void {
  const w = makeWidget()
  w.run()
}
export function useUnannotatedFactory(): void {
  const u = makeUnannotated()
  u.never()
}
function makeUnannotated() {
  return new Widget()
}
