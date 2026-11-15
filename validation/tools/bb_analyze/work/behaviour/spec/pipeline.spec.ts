import { Pipeline } from "../src/core/pipeline"
import { jest } from "jest"
test("pipeline", () => { const p = new Pipeline(); expect(p.execute("x")).toBeGreaterThan(0) })
