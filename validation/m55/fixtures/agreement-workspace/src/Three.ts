import { target } from "./plain.js";

export function target(): number {
  return 1;
}

export function ThreeCaller(): number {
  return target();
}
