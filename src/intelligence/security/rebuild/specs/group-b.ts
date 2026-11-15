// M72 — specs owned by the `specs-b` lane (18 executable code languages).
// Each entry is a LanguageSecuritySpec imported from its own file; this file is
// the lane's aggregation point only. Do not edit files outside this lane's
// language list. `tsx` resolves through the TypeScript spec's aliases and has no
// separate module.
import type { LanguageSecuritySpec } from "../spec-types"
import { spec as matlabSpec } from "./matlab"
import { spec as nimSpec } from "./nim"
import { spec as objectiveCSpec } from "./objective-c"
import { spec as perlSpec } from "./perl"
import { spec as phpSpec } from "./php"
import { spec as powershellSpec } from "./powershell"
import { spec as pythonSpec } from "./python"
import { spec as rSpec } from "./r"
import { spec as rubySpec } from "./ruby"
import { spec as rustSpec } from "./rust"
import { spec as scalaSpec } from "./scala"
import { spec as soliditySpec } from "./solidity"
import { spec as swiftSpec } from "./swift"
import { spec as typescriptSpec } from "./typescript"
import { spec as vbSpec } from "./vb"
import { spec as vbaSpec } from "./vba"
import { spec as zigSpec } from "./zig"

/** Lane B specs, one per language (tsx is an alias of typescript). */
export const groupBSpecs: LanguageSecuritySpec[] = [
  matlabSpec,
  nimSpec,
  objectiveCSpec,
  perlSpec,
  phpSpec,
  powershellSpec,
  pythonSpec,
  rSpec,
  rubySpec,
  rustSpec,
  scalaSpec,
  soliditySpec,
  swiftSpec,
  typescriptSpec,
  vbSpec,
  vbaSpec,
  zigSpec,
]
