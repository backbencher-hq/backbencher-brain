import { formatName } from "../util/format"
import { helper } from "../util/index"
import { MAX_RETRIES } from "../consts"

export function run(input: string): string {
  let out = ""
  for (let i = 0; i < MAX_RETRIES; i++) out = helper(formatName(input))
  return out
}

export function hub(a: number, b: number): number {
  return run(String(a)) .length + b
}
