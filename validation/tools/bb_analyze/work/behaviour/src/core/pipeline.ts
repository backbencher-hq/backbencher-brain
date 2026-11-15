import { run, hub } from "./engine"

export class Pipeline {
  execute(input: string): number { return hub(input.length, run(input).length) }
}

export interface Stage { name: string }
export type StageId = string
