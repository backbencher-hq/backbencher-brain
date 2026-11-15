export function leaf(): number { return 1 }
export class Service {
  run(): void { leaf() }
  other(): void {}
}
