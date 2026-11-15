// M60.R8 (#838/#836) — the swift member of the C7 framework surface.
//
// The four imports deliberately run in the OPPOSITE order to the published
// contract: Foundation and UIKit come first, SwiftUI and Combine last. The
// pre-fix analyzer built `detectedFrameworks` by iterating the observation map,
// so the emitted array was whatever order the walk happened to visit triggers
// in — [Foundation, UIKit, SwiftUI, Combine] on this file. The contract's order
// is the declared table (application frameworks most-specific first, the base
// library last), so the pin is [SwiftUI, Combine, UIKit, Foundation] and the
// primary pick is SwiftUI. A revert to walk order fails the array pin, the
// primary pin, and the frameworkPatterns pin at once.
//
// `@State` and `@Published` also fire the wrapper handler, so SwiftUI and
// Combine are reachable through BOTH trigger paths, not only the imports.

import Foundation
import UIKit
import SwiftUI
import Combine

struct CounterModel {
    @Published var total: Int = 0
}

struct CounterView: View {
    @State private var model = CounterModel()

    var body: some View {
        Text("total")
    }
}

// A file that imports only the base library must still publish exactly one
// framework and pick it — the order table is consulted, not bypassed.
import struct Foundation.Date

func stamp() -> Date {
    return Date()
}
