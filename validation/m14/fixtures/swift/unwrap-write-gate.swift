// #939 (swift lane, full extent): the pinned grammar wraps a force unwrap in a
// `postfix_expression`:
//
//   assignment
//     directly_assignable_expression
//       navigation_expression            <- outer (.total)
//         postfix_expression             <- box.value!
//           navigation_expression        <- inner (.value)
//             simple_identifier "box"
//             navigation_suffix . simple_identifier "value"
//           bang "!"
//         navigation_suffix . simple_identifier "total"
//
// The SCD1 climb walked only (directly_assignable_expression |
// navigation_expression | navigation_suffix), so from the INNER navigation the
// first parent (`postfix_expression`) stopped the walk, the LHS-span test never
// ran, and a WRITE was published as a read: `uses -> value` on the 554-file
// swift-nio draw (FileInfoTests.swift, 21 identical sibling lines).
//
// Every segment of an assignment LHS under the wrapper is a write — `total`
// (outer) and `value` (inner) both. The same wrapper in a VALUE position is a
// genuine read, which `readThroughUnwrap` pins so the gate cannot be widened
// into a blanket suppression.

final class Box {
    var value: Inner?
    var total: Int = 0
}

final class Inner {
    var total: Int = 0
    var surface: Int = 0
}

final class Holder {
    var box: Box

    init(box: Box) {
        self.box = box
    }

    func bumpThroughUnwrap() {
        box.value!.total += 1
    }

    func writeThroughUnwrap() {
        box.value!.total = 0
    }

    func readThroughUnwrap() -> Int {
        return box.value!.total
    }

    func readOuterThroughUnwrap() -> Int {
        return box.value!.surface
    }

    // #939's OTHER row: the FLAT form, where the unwrap IS the whole LHS
    // (`x.a! = 1`). Both sides used to publish it as a read, because the climb
    // stopped at the wrapper before the LHS-span test could run — the same wall
    // as the nested form, one segment shorter. Appended at the END of the class
    // so the read pins above keep their lines.
    func writeFlatThroughUnwrap() {
        box.value! = Inner()
    }
}
