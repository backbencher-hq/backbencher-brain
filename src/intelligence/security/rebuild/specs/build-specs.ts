// M72 Phase 2c — build-tooling specs.
//
// Make recipes are shell commands, not configuration: the production parser emits
// a `function` symbol per recipe whose body is the recipe text. Declaring `make`
// non-executable would be a false coverage gap, so it gets a real spec.
import type { LanguageSecuritySpec } from "../spec-types"
import { spec as makeSpec } from "./make"

export const buildSpecs: LanguageSecuritySpec[] = [makeSpec]
