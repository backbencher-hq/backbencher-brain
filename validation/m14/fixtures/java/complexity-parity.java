public class F {
    public int f(int x) {
        if (x > 0) { return 1; } else { return 2; }
        for (int i = 0; i < 3; i++) { }
        return x > 1 && x < 5 ? 3 : 4;
    }
}

// F6 coverage (2026-09-02): annotation_type_declaration +
// annotation_type_element_declaration, constant_declaration (interface
// constants), receiver_parameter, method_reference, cast_expression,
// class_literal, array_creation_expression, switch_expression + switch_rule +
// switch_block_statement_group, do_statement, enhanced_for_statement, pattern +
// type_pattern, annotated_type — declared handled_verified, now exercised.
@interface Route {
    String path() default "/";

    int weight() default 1;
}

interface Codes {
    int OK = 0;
    int ERR = 1;
}

class Polymorph {
    // F6: receiver_parameter (explicit `A this` receiver).
    int weigh(Polymorph this, Object o) {
        int total = 0;
        do {
            total += 1;
        } while (total < 3);
        for (String s : new String[] { "a", "b" }) {
            total += s.length();
        }
        // F6: switch_statement (classic colon form) — switch_block_statement_group.
        switch (total) {
            case 1:
                total += 10;
                break;
            default:
                total += 20;
                break;
        }
        if (o instanceof String t) {
            total += t.length();
        }
        var parts = (Object[]) o;
        java.util.function.Supplier<Integer> ref = Polymorph::weigh;
        total += ref.get() instanceof Integer n ? n : 0;
        // F6: annotated_type — annotation INSIDE a generic type argument.
        java.util.List<@Deprecated String> names = new java.util.ArrayList<>();
        // F6: class_literal (A.class).
        total += Polymorph.class.getSimpleName().length();
        // F6: type_pattern with guard (case Integer i when i > 0).
        return switch (o) {
            case Integer i when i > 0 -> i + names.size();
            default -> ((Integer) total);
        };
    }
}
