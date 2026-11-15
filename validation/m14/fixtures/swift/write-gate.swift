import Foundation

// SCD1 write-gate fixture: assignment LHS is a WRITE (never a read).
// - `bump`: PURE writes only — no uses edge may originate from it.
// - `read`: pure read — the `uses count` pin proves reads survive the gate.
// - `mix`:  `self.count = ...` (gated write) + `self.count` inside the RHS
//           expression (genuine read) + a call — exercises LHS-span scoping.
class Counter {
    private var count: Int = 0
    private var label: String = "n"

    func bump() {
        self.count = 0
        self.label = "z"
        count += 1
    }

    func read() -> Int {
        return self.count
    }

    func mix(step: Int) -> Int {
        self.count = self.count + step
        return stride(from: 0, to: self.count, by: 1).count
    }

    // SWD1 (glued-receiver reads): self is the TRUE base of the suffix but
    // sits one wrapper deeper than the naive receiver chain — additive
    // (`buf.readerIndex + self.count`, the swift-nio SHA1/decoder pattern)
    // and inout (`c_loop(&self.ctx, ...)`, C-interop pass-by-reference).
    // Both MUST emit uses; neither is an assignment LHS.
    private var ctx: Int = 0
    private var base: Int = 0

    func gluedAdditive(bufBase: Int) -> Int {
        let start = base + self.count
        return start
    }

    func inoutRead(_ sink: UnsafeMutableRawPointer?) {
        cInteropWrite(&self.ctx)
    }
}

func cInteropWrite(_ p: UnsafeMutableRawPointer?) {}

// SCD1 nested-chain addendum (F5 2026-09-12, swift-nio HTTPDecoder.swift
// `self.settings.pointee.on_body = …`): a nested member chain is ONE
// navigation_expression inside another, and only the OUTER node hangs off
// directly_assignable_expression — so a gate that climbed only that wrapper
// leaked a bogus `uses pointee` for the middle segment of the LHS. EVERY
// segment of a nested write chain is a write; the read in `nestedRead` proves
// the gate is still span-scoped rather than a blanket suppression.
class Settings {
    var pointee = Pointer()
    var data: Int = 0
}

class Pointer {
    var on_body: Int = 0
}

class Registry {
    private var settings = Settings()

    func nestedWrite() {
        self.settings.pointee.on_body = 1
    }

    func nestedRead() -> Int {
        return self.settings.data
    }
}
