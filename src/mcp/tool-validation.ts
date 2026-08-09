import type { ToolDescriptor, JsonSchemaProperty } from "./tool-registry"

export function validateToolArguments(descriptor: ToolDescriptor, args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(`${descriptor.name}: arguments must be a JSON object`)
  const object = args as Record<string, unknown>
  const properties = descriptor.inputSchema.properties ?? {}
  const unknown = Object.keys(object).filter((key) => !(key in properties))
  if (unknown.length) throw new Error(`${descriptor.name}: unknown or irrelevant options: ${unknown.join(", ")}`)
  for (const required of descriptor.inputSchema.required ?? []) {
    if (!(required in object) || object[required] === undefined || object[required] === null) throw new Error(`${descriptor.name}: missing required option: ${required}`)
  }
  for (const [name, value] of Object.entries(object)) validateProperty(descriptor.name, name, value, properties[name]!)
  return object
}

function validateProperty(tool: string, name: string, value: unknown, schema: JsonSchemaProperty): void {
  if (value === null) throw new Error(`${tool}: ${name} must not be null`)
  const valid = schema.type === "string" ? typeof value === "string"
    : schema.type === "number" ? typeof value === "number" && Number.isFinite(value)
    : schema.type === "boolean" ? typeof value === "boolean"
    : schema.type === "array" ? Array.isArray(value) && (!schema.items || value.every((item) => item !== null && typeof item === schema.items!.type))
    : typeof value === "object" && !Array.isArray(value)
  if (!valid) throw new Error(`${tool}: ${name} must be ${schema.type}`)
  if (schema.enum && !schema.enum.includes(value as string)) throw new Error(`${tool}: ${name} must be one of: ${schema.enum.join(", ")}`)
  if (schema.type === "number" && (name === "limit" || name === "offset" || name === "sampleSize" || name === "maxFiles" || name === "maxNodes" || name === "maxLinks" || name === "maxTokens" || name === "lineStart") && (value as number) < 0) throw new Error(`${tool}: ${name} must be non-negative`)
  if (name === "confidenceThreshold" && ((value as number) < 0 || (value as number) > 1)) throw new Error(`${tool}: confidenceThreshold must be between 0 and 1`)
}
