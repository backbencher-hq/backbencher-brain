export function helper(x) {
  return x * 2;
}
export default class DefaultThing {
  run() {}
}

// F6: namespace_export — `export * as ns from "..."` shape.
export * as f6ns from "./f6-virtual.js";
