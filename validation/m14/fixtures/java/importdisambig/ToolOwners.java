/**
 * The ambiguity SOURCE: declares `Filter` TWICE (nested here, and nested inside
 * Other). Together with the top-level `Filter`, the project declares that simple name
 * three times, so a bare reference cannot be resolved by name alone. That is the
 * precondition the disambiguation rule checks - it must never fire on a name the
 * project declares exactly once, because then re-spelling could only lose the
 * spelling the source wrote.
 */
public class ToolOwners {
    static class Filter {
        void nestedA() {
        }
    }

    static class Other {
        static class Filter {
            void nestedB() {
            }
        }
    }
}
