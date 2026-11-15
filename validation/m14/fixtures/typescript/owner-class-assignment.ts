// owner-class-assignment — C1 ASSIGNMENT-PROVEN LOCAL TYPE: `late = new Worker()` then `late.run()`.
// The declaration states nothing; the ASSIGNMENT states the type. The annotation-authoritative rule
// is pinned by the second half: `let base: Base; base = new Derived()` keeps Base, never Derived.
export class Worker { run(): void {} }
export class Base { baseOnly(): void {} }
export class Derived extends Base { derivedOnly(): void {} }
declare let late: unknown
late = new Worker()
export function useAssignment(): void {
  late.run()
  let base: Base
  base = new Derived()
  base.baseOnly()
}
