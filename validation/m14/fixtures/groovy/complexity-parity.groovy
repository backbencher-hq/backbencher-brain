def f(x) {
    if (x > 0) { return 1 } else { return 2 }
    for (i in 0..2) { }
    return (x > 1 && x < 5) ? 3 : 4
}

// F6 coverage (2026-09-02): catch_clause, constant_declaration, do_statement,
// enum_constant, enum_declaration, for_statement, lambda_expression, resource,
// resource_specification, static_initializer, switch_rule,
// try_with_resources_statement, while_statement — declared handled_verified
// but not previously exercised by any groovy fixture.
enum Mood {
    HAPPY, GLOOMY

    Mood flip() { this == HAPPY ? GLOOMY : HAPPY }
}

// F6: constant_declaration — interface constants (probe-verified clean parse;
// the same form inside a plain class body is an error in this grammar).
interface Codes {
    int OK = 0
    int ERR = 1
}

class Guarded {
    static final int LIMIT = 3
    static { println "init" }

    int poll(List<String> items) {
        int i = 0
        while (i < LIMIT) { i++ }
        do { i-- } while (i > 0)
        for (i = 0; i < LIMIT; i++) { i += 1 } // F6: classic for_statement (untyped init — the typed Java form does not parse in this grammar)
        switch (i) {
            case 0 -> 1
            default -> 2
        }
        try (FileInputStream f = new FileInputStream("x")) {
            return f.available()
        } catch (IOException e) {
            return -1
        }
    }

    def run = { int n -> n + 1 }
}
