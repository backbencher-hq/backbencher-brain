import { formatName } from "./format"
import { hub } from "../core/engine"
import { notARealModule } from "./missing-module"

export function local(): number { return formatName("X").length + hub(1, 2) + (notARealModule as any) }
