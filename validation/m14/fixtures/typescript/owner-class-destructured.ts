// owner-class-destructured — C2 DESTRUCTURED ELEMENT TYPE FROM A TYPED SOURCE.
// `const { worker } = cfg` where `cfg: Settings`: the binding's type is the MEMBER's declared type.
export interface Settings { worker: Worker }
export class Worker { run(): void {} }
export function useDestructured(cfg: Settings): void {
  const { worker } = cfg
  worker.run()
}
export function negativeDestructured(cfg: unknown): void {
  const { missing } = cfg as any
  missing.never()
}
