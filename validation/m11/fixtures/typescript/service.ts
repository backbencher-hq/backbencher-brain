import { BaseService, helper, type Repository } from "./base"

export { helper as normalize } from "./base"

export type User = { id: string; name: string }
export enum Role { Admin, User }

export namespace Models {
  export interface Audited { updatedAt: Date }
}

function sealed<T extends new (...args: any[]) => object>(target: T): T {
  return target
}

@sealed
export class UserService extends BaseService implements Repository<User> {
  private readonly pattern = /^user:/

  constructor(private readonly store: Map<string, User>) {
    super()
  }

  override format(value: string): string {
    return `${this.prefix}:${helper(value)}`
  }

  save(value: User): Promise<User>
  save(value: User): Promise<User> {
    this.store.set(value.id, value)
    return Promise.resolve(value)
  }

  matches(value: string): boolean {
    return this.pattern.test(value)
  }
}

export function createService(): UserService {
  const store = new Map<string, User>()
  return new UserService(store)
}
