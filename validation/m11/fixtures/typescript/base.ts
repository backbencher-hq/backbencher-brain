export interface Repository<T> {
  save(value: T): Promise<T>
}

export abstract class BaseService {
  protected prefix = "base"

  abstract format(value: string): string
}

export const helper = (value: string): string => value.trim()
