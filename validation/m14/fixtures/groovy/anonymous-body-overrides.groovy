// M60 groovy lane (2026-09-25). A method declared inside an anonymous class
// body (`new TypeCodec() { ... }`) is an override of the CONSTRUCTED type's
// member, and the pass that derives it reaches a method's parent through the
// class hierarchy keyed by the owner's FQN. The anonymous body registered its
// symbol, its symbolMap key and its scope but NOT its hierarchy entry, so every
// override task inside it fell through all three tiers and emitted NOTHING —
// the only two MISSING rows on the 4,014-file grails-core groovy lane at full
// extent (`IdentityDecoder.groovy`, `SimpleDecoder.groovy`). This fixture pins
// both halves of the shape: the anonymous body's override, and the ordinary
// in-file override of a NAMED subclass that must be untouched by the fix.

interface TypeCodec {
    String bsonType()
}

abstract class BaseCodec {
    String bsonType() { return "base" }
}

class Registry extends BaseCodec {
    static final TypeCodec DEFAULT = new TypeCodec() {
        @Override
        String bsonType() { return "default" }
    }

    @Override
    String bsonType() { return "registry" }
}
