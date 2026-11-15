// M37.19 (#612) family deep differential — the cpp lane's first .cpp-inclusive
// full extent (nlohmann-json, 496 files) found the analyzer's DECLARED-NAME
// extraction reading the wrong node, and with it three separate defects that all
// trace to one rule. Every shape below is taken from a measured corpus site:
//
//   tests/thirdparty/Fuzzer/FuzzerUtilDarwin.cpp:21  extern "C" char **environ;
//   tests/thirdparty/Fuzzer/FuzzerUtilDarwin.cpp:98  char **Environ = environ;
//   include/nlohmann/json.hpp:3259                   basic_json&& key = ...;
//
// 1. `int *p = g;` — the name was read with a SHALLOW, document-order lookup over
//    the init_declarator's children, whose first identifier is the INITIALIZER. So
//    the local was bound as `g`, which deleted every read of the real `g` (the
//    corpus edge `uses → environ`) and published the symbol under the wrong name.
// 2. `char **environ;` / `int counts[4];` — a declarator wrapped in more than one
//    pointer level, or an array, published NO symbol at all.
// 3. `int &alias = other;` — the same lookup published `other`: the name of the
//    thing the reference BINDS TO, not the reference.
//
// And the guard that keeps a function's name out of that path: a function
// declaration names a FUNCTION, never a value; a function POINTER is still a value.

extern "C" char **environ;

char **buffers;
int counts[4];
int *single;
int backing;
int &alias = backing;

static const int kLimit = 4;

// The declaration behind the reference must not be read as a use of `alias`, and
// the read of `environ` inside a local pointer's initializer must survive.
int firstBuffer(void)
{
  char **Environ = environ;
  return Environ ? 1 : 0;
}

// A pointer local's initializer reads the global: the local is `local`, the read
// is of `single`.
int readThroughLocal(void)
{
  int *local = single;
  return local ? *local : 0;
}

int useArray(void)
{
  return counts[0];
}

// Function declaration vs function pointer: the first names a FUNCTION (no value
// symbol), the second declares a VALUE.
void declaredNotDefined(int arg);
int (*handler)(int);

// A parameter with a default value that shadows a file-scope enumerator: the read
// of `strPolicy` is the PARAMETER, never the enum member.
enum class policy_t { strict, loose };
class Reader
{
public:
  bool parse(bool strict = true)
  {
    return strict;
  }
};

// Control: the same read with nothing to shadow it stays silent either way.
class Quiet
{
public:
  bool accept(bool arg)
  {
    return arg;
  }
};

// CPPD17/CPPD18 — the FUNCTION path's version of the same wrapper problem, and
// the half of it that costs a SCOPE. `getFunctionDetails` found the declared name
// by scanning the function_declarator's DIRECT named children, so both wrappings
// below made the method invisible to it: no method symbol was published, and
// because the caller pushes the function scope out of that same result, the
// function had NO SCOPE — so its parameter's reads had no local roster to consult
// and resolved OUTWARD, to the file-scope `policy_t::strict`.
//
// (a) the NAME parenthesized:
//       function_declarator[declarator: parenthesized_declarator[field_identifier]]
// (b) a macro between the return type and the name: the grammar recovers the
//     macro's parens as a parenthesized_declarator wrapping the WHOLE
//     function_declarator, with an ERROR node holding the macro's own argument
//     and the return type:
//       function_definition > declarator: parenthesized_declarator[
//         ERROR[number_literal, primitive_type], function_declarator]
//
//     This is the CORPUS spelling, taken from
//     include/nlohmann/json_v3_10_5.hpp:8265 (`JSON_HEDLEY_NON_NULL(3)` on its own
//     line, parameter list continued across lines). Reproducing it needed the
//     same two ingredients: a macro line of its own AND a multi-line parameter
//     list — with both on one line the macro falls to the macro-recovery path and
//     the method is published anyway, which is why the accepted-looking spelling
//     is NOT the pin. Measured on that one corpus file: 14 method symbols were
//     missing at HEAD and the lane's last unexplained edge came from it
//     (`uses binary_reader -> strict @8299`).
class WrappedNames
{
public:
  bool (acceptParenthesized)(bool strict = true)
  {
    return strict;
  }

  JSON_HEDLEY_NON_NULL(3)
  bool acceptMacroDecorated(json_sax_t* sink,
                            const bool strict = true)
  {
    return strict && sink != nullptr;
  }
};
