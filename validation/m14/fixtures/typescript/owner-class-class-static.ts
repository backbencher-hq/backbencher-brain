// owner-class-class-static — C8 CLASS-STATIC RECEIVERS.
// `Widget.create()` names the class's own declared member; a class without that member is NOT
// claimed (precision over coverage).
export class Widget {
  static create(): Widget {
    return new Widget()
  }
  run(): void {}
}
export class Other { unrelated(): void {} }
export function useClassStatic(): void {
  Widget.create()
  Other.notDeclared()
}
