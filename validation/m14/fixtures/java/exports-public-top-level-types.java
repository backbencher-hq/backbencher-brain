package com.example.exports;

/**
 * EXPORTS-JAVA2 fixture: the public top-level-type export surface.
 *
 * Every shape the confidence tier depends on is present on purpose:
 *
 *   Api          public top-level CLASS          -> exports edge at 1.0
 *   Helper       public top-level INTERFACE     -> exports edge at 1.0
 *   Color        public top-level ENUM          -> exports edge at 1.0
 *   Point        public top-level RECORD        -> exports edge at 1.0
 *   Marker       public top-level @interface    -> exports edge at 1.0
 *   internal     NO visibility modifier        -> 0.6 edge with a reasonCode,
 *                                                NOT 1.0 (package-private:
 *                                                bindable only inside its own
 *                                                package, JLS 6.5.5.1/7.6)
 *   Nested       a MEMBER type                  -> NO export edge at all; membership
 *                                                rides `contains` (M49 JVM-closure
 *                                                exports-family ruling)
 *   aMethod      a member method                -> NO export edge, same ruling
 *
 * The `public` keywords on Helper/Color/Point/Marker are load-bearing, not
 * decoration: a top-level type with no modifier is package-private, so writing
 * them bare would make four 0.6 rows instead of four 1.0 rows and the fixture
 * would assert the wrong contract.
 */
public class Api {
    /** A member type is not an importable unit. */
    public static class Nested {
        public int size() { return 0; }
    }

    public void aMethod() {}
}

/** No visibility modifier: package-private, so not importable from outside.
 *  TOP-LEVEL on purpose — a nested `static class internal` would be excluded
 *  from the export set altogether by the `!ownerName` guard, and the 0.6 tier
 *  would never be exercised. */
class internal {}

public interface Helper {
    void help();
}

public enum Color { RED, GREEN }

public record Point(int x, int y) {}

public @interface Marker {}