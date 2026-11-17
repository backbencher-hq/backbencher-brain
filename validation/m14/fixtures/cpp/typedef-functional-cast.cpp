#include <cstdint>
#include <cstddef>

// A STANDARD TYPEDEF IS A TYPE, NOT A CALLEE. `int32_t(x)`, `std::uint64_t(0)` and the C-style
// `(int_fast32_t)(expr)` are FUNCTIONAL CASTS / cast expressions, not calls: the language
// guarantees these names denote integer/value types ([cstdint], [cstddef]), so no function can
// carry them and no `calls` edge may name them. The same guard already exists on the `instantiates`
// path (`new uint8_t[5]` published `instantiates -> uint8_t` and is declined by
// CPP_NON_CLASS_STANDARD_TYPES) — it was simply NEVER applied to the calls path, and the D1
// keyword funnel cannot see this class because `size_t x;` is a legal declaration.
//
// Measured: 4 residual `calls` rows over the reconstruction corpus (wall W8
// "non-class-standard-type"), one per shape below:
//   Rcpp/src/date.cpp:1290           `seconds = (int_fast32_t)(tdays * SECSPERDAY);`
//   duckdb/third_party/ska_sort:119 `static_cast<std::uint32_t>(-std::int32_t(...))`
//   nlohmann-json/docs/.../value__return_type.cpp:12  `std::uint64_t(0)`
// The CONTROL is the last line: a real function call must still emit its edge.

int helper();

int32_t take_int32(int32_t x) { return (int32_t)(x); }                 // cast, not a call
uint64_t take_uint64() { return std::uint64_t(0); }                    // functional cast, not a call
int_fast32_t take_fast(int_fast32_t v) { return int_fast32_t(v * 2); } // functional cast, not a call
size_t take_size() { return size_t(4); }                               // functional cast, not a call

int real_call() { return helper(); }                                   // THE CONTROL: a real call
