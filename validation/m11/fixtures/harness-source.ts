export class BaseService {
  protected prefix = "user"
}

export class UserService extends BaseService {
  save(name: string): string {
    return `${this.prefix}:${name}`
  }
}

export function run(): string {
  const service = new UserService()
  return service.save("Ada")
}

export function invokeDynamic(target: Record<string, () => string>, key: string): string {
  return target[key]?.() ?? "missing"
}
