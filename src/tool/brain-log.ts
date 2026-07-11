// Stub — backbencher-style Log module
export function create(opts: { service: string }) {
  return {
    debug: (..._args: any[]) => {},
    info: (..._args: any[]) => {},
    warn: (..._args: any[]) => {},
    error: (..._args: any[]) => {},
  }
}
