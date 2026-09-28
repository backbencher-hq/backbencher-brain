// bb-demo — main.ts (entry)
// Uses the Greeter class from greeter.ts: instantiation + method calls.
import { Greeter, buildGreeter } from "./greeter";

export function main(): number {
  const g = buildGreeter();
  g.add("d");
  const hello = g.greet();
  console.log(hello);
  return g.size();
}

main();
