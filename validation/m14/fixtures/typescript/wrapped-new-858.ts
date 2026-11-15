class Engine {
  constructor(public size: number) {}
}

class Router {
  constructor(public prefix: string) {}
}

function prefix(): string {
  return "/api"
}

export function build(): unknown {
  const direct = new Engine(1)
  const wrapped = new
    Router(prefix())
  return direct ?? wrapped
}
