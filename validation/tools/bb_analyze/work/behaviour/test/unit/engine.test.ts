import { run, hub } from "../../src/core/engine"
describe("engine", () => {
  it("runs", () => { expect(run("a")).toBe("a") })
  it.each([1, 2])("hub %i", (n) => { try { expect(hub(n, n)).toBeGreaterThan(0) } catch (e) { throw e } })
})
