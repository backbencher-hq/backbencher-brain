/**
 * The ambiguity SOURCE: declares `Widget` TWICE (nested here, and nested inside
 * Other). With the top-level Widget that makes three project declarations of the
 * simple name, so `symbolCounts` for `Widget` exceeds one - the precondition the
 * disambiguation rule requires before it may re-spell anything.
 */
public class Owners {
    static class Widget {
        void nestedA() {
        }
    }

    static class Other {
        static class Widget {
            void nestedB() {
            }
        }
    }
}
