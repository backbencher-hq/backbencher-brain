// D5 (#961): C++ HAS NO NESTED FUNCTION DEFINITION. Not as an extension, not
// under any condition. So a `function_definition` node whose enclosing scope is a
// function body is ill-formed, and what it is instead is the one thing that shape
// genuinely is: a LOCAL VARIABLE written with direct-initialization parentheses.
//
//   std::string contents(ReadEntireFile(flagfile));
//   AutoHandle parent_process_handle(::OpenProcess(…));
//   const FloatingPoint<RawType> lhs(val1), rhs(val2);
//
// `T name(args);` and `T name(args) { }` are genuinely ambiguous to a parser with
// no symbol table. tree-sitter-cpp resolves toward the function reading, so each
// of those variables became a FUNCTION symbol owned by the enclosing function —
// 619 of them over 554 real C++ files, and the graph's answer to "what does this
// function contain" was a set of sibling functions.
//
// This is the THIRD guard of a family whose other two were already present: the
// field/variable branch already refuses to publish inside a function
// (`insideFunction`), and `isMacroFunctionShape` already refuses an untyped
// heading at file scope. Neither reaches a node the grammar calls a
// `function_definition` that sits inside a body, and that is exactly where the
// class lives.
//
// The second half of D5 is the CGD20 parity gap: a block-scoped `using X = Y;`
// (or `typedef Y X;`) is an execution artifact, and the C lane says so in as many
// words — "CGD20: function-local typedefs are execution artifacts (C-D1)". C++ has
// the identical construct and the C++ lane had no such guard: 173 aliases became
// `Type` symbols owned by the enclosing function, half of them owned by a
// macro-heading function whose name is the literal heading text.
//
// A local CLASS is deliberately still published, because it has members and they
// need an owner. That asymmetry is why the rule sits on the alias and is not a
// blanket "nothing inside a function" — `local_type` below pins it.

#include <string>
#include <vector>

static int counter = 0;

struct Handle {
    Handle(int) {}
    ~Handle() {}
};

int compute(int seed) {
    // D5a: each of these is a local VARIABLE. Published as a `function` symbol
    // before the fix, owned by `compute`.
    std::string contents("a string built with parens");
    std::vector<int> raw_stack(16);
    Handle parent_handle(7);
    const std::string joined(contents, contents);

    // D5b: the multi-declarator spelling, which is the shape that produced
    // `function "lhs"` on the corpora (gmock-gtest-all.cc:3109).
    int left(1), right(2);

    // D5c: THE CONTROL. A real function CALL statement must still be a call edge —
    // the gate is on the DECLARATION, never on the callee.
    int doubled = compute(seed);

    // D5d: a local class is still published, with its members owned by it.
    struct local_type {
        int field;
        int get() const { return field; }
    };
    local_type lt{5};

    // D5e: a block-scoped alias is NOT published (CGD20 parity).
    using local_alias = std::vector<int>;
    typedef std::string local_typedef;

    local_alias la(3);
    local_typedef lt2("x");

    counter += (int)raw_stack.size() + left + right + doubled + lt.get()
             + (int)la.size() + (int)lt2.size() + (joined.empty() ? 0 : 1)
             + (parent_handle ? 1 : 0);
    return counter;
}
