// bb-demo — report.ts
// A second file that calls Greeter.greet — hover on greet() shows callers
// from both main.ts and report.ts.
import { Greeter } from "./greeter";

export function describeGreeter(g: Greeter): string {
  const message = g.greet();
  return `report: ${message}`;
}

export function makeReport(): string {
  const g = new Greeter(["x", "y"]);
  return describeGreeter(g);
}
