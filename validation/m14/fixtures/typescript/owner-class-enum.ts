// owner-class-enum — C7 ENUM-MEMBER RECEIVERS.
// `const status = Status.Active` gives the local the ENUM type, and `class Hooks { status: Status }`
// states the same for a field read through `this`.
//
// The member name is deliberately NOT a builtin (`toString`/`valueOf` are filtered as Object leaf
// methods, so no `calls` edge exists for them and the class would be unobservable): this fixture
// pins that the RECEIVER'S ENUM TYPE is stated on the edge, which is the metadata the store reads.
export enum Status { Active, Off }
export class Hooks {
  status: Status = Status.Active
  fire(): void {
    this.status.describe()
    const s = Status.Off
    s.describe()
  }
}
export function negativeEnum(value: unknown): void {
  const x = value
  x.never()
}
