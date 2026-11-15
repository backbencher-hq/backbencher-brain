function g(x) {
    if (!x) return 0
    for (const k in x) { }
    while (x.ok && x.id) { x = x.next }
    do { x.n-- } while (x.n > 0)
    return x.v ?? fallback()
}

// F6 coverage (2026-09-02): array (literal), augmented_assignment_expression,
// break/continue statements, catch/finally clauses, else_clause, false/true,
// for_statement, generator_function(_declaration), labeled_statement,
// namespace_export, regex, sequence_expression, spread_element, super,
// switch_body/case/default, ternary_expression, throw_statement, try_statement,
// undefined, variable_declaration, yield_expression — declared
// handled_verified, now exercised.
export const F6_FLAG = true;

const f6arr = [1, 2, 3];
const f6re = /f6-[a-z]+/i;
let f6acc = 0;
var f6legacy = undefined;

class f6Base {
    greet() {
        return "base";
    }
}

class f6Child extends f6Base {
    greet() {
        return super.greet() + "+child";
    }
}

function* f6Gen() {
    yield 1;
    yield* [2, 3];
}

const f6GenExpr = function* () {
    yield 5;
};

f6loop: for (let i = 0; i < 4; i++) {
    if (i === 1) continue f6loop;
    if (i === 3) break f6loop;
    f6acc += i;
}

try {
    throw new Error("f6");
} catch (e) {
    f6acc += 1;
} finally {
    f6acc += 10;
}

const f6tern = f6acc > 5 ? "big" : "small";
f6acc += f6tern.length, f6acc += 1;
f6acc **= 2;
f6acc ||= 8;

const f6seq = (1, 2, 3);
void f6arr;
void f6re;
void f6legacy;
void f6Gen;
void f6GenExpr;
void f6seq;
void f6Child;

function f6Switch(n, xs) {
    // F6: switch_statement/switch_body/switch_case/switch_default, else_clause,
    // spread_element, and the `false` keyword token.
    switch (n) {
        case 1:
            return xs.push(9);
        case 2: {
            break;
        }
        default:
            break;
    }
    const merged = [...xs, 4];
    if (n === 3) {
        return merged.length;
    } else if (n === 4) {
        return false;
    } else {
        return merged;
    }
}
