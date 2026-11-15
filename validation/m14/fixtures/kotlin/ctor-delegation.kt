class Base(val x: Int)

class Derived(x: Int) : Base(x) {
    constructor() : super(0) {}

    constructor(s: String) : this(0) {}
}

/**
 * A `companion object` may declare its own secondary constructor, and that
 * constructor's delegation belongs to the COMPANION — not to the class the
 * companion is written inside. `kotlinConstructorOwnerName` walks up and stops
 * at the first `class_declaration | object_declaration | companion_object`, and
 * this file is what makes that ordering observable: if the walk skipped past the
 * companion, both delegation edges would read `Outer` and the forbid on
 * `Outer -> super` would fire.
 */
class Outer {
    companion object Factory {
        constructor(tag: String) : super(0)
    }
}