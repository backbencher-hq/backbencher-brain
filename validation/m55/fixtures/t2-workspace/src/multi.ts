import { deep } from "./deep.js";

export function many(): number {
  const first = deep();
  const second = deep();
  return first + second;
}
