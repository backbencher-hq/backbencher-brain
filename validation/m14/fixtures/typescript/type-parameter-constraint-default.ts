interface HasId {
  id: number
}

class Repo<T extends HasId = HasId, U extends string = "a"> {
  get(key: U): T | undefined {
    return undefined
  }
}

function pick<T extends object = {}>(input: T): T {
  return input
}

type Mapper<In extends object = {}, Out = string> = (input: In) => Out
