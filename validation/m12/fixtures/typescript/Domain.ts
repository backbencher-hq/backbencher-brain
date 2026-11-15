export namespace Example.Domain {
  export enum Status {
    None = 0,
    Active = 1,
    Inactive = 2,
  }

  export interface Repository<T> {
    save(value: T): Promise<T>
    findAll(): Promise<T[]>
  }

  export type UserId = string

  /** A domain customer with a stable identity. */
  export class Customer {
    constructor(public id: UserId, public name: string) {}

    /** Render a human-readable description. */
    describe(): string {
      return `${this.id}:${this.name}`
    }
  }

  export async function findById<T>(repo: Repository<T>, id: string): Promise<T | undefined> {
    const all = await repo.findAll()
    return all.find((item) => (item as any).id === id)
  }
}
