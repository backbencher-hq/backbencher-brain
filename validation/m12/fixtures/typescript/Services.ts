export namespace Example.Service {
  export interface ILogger {
    log(message: string): void
  }

  export interface IRepository {
    get(id: string): Promise<string | undefined>
    set(id: string, value: string): Promise<void>
  }

  export class FileLogger implements ILogger {
    log(message: string): void {
      console.log(`[file] ${message}`)
    }
  }

  export class CompositeLogger implements ILogger {
    private readonly loggers: ILogger[]

    constructor(loggers: ILogger[]) {
      this.loggers = loggers
    }

    log(message: string): void {
      for (const logger of this.loggers) {
        logger.log(message)
      }
    }
  }

  export class Service implements IRepository {
    constructor(private readonly logger: ILogger) {}

    async get(id: string): Promise<string | undefined> {
      this.logger.log(`get:${id}`)
      return undefined
    }

    async set(id: string, value: string): Promise<void> {
      this.logger.log(`set:${id}`)
    }
  }
}
