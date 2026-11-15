import { target } from "./plain.js";

export function BridgeCaller(): number {
  const api = { run: target };
  return api.run();
}
