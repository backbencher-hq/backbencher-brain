import { target } from "./plain.js";

export function twice(): number {
  const a = target();
  const b = target();
  return a + b;
}
