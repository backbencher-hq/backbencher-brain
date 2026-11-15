// M37.19 (#612) family deep differential — the cpp lane's first .cpp-inclusive
// full extent (fmt, 73 files) reported 7 reads that BOTH sides agreed on and
// that are, on both sides, wrong: the DECLARED NAME of a template-wrapped
// declarator read as a use of itself. Every shape below is taken from a measured
// corpus site:
//
//   include/fmt/format.h:411   template <> constexpr auto num_bits<native_int128>() -> int { return 128; }
//   include/fmt/printf.h:62    template <> auto find<...>(...) -> ...
//   test/fuzzing/one-arg.cc:15 template <> auto from_repr<...>(...) -> ...
//
// The declared name sits inside `template_function`, so the leftmost-declarator
// rule (which gates on the node's DIRECT parent) classified it as a read:
//
//   identifier(bits_of) < template_function < function_declarator < function_definition
//
// The rule that fixes it — `templateWrappedDeclaratorName`, exported by the
// analyzer and imported by the F5 oracle so both sides read ONE definition — is
// deliberately narrow, and the controls below are what keep it narrow:
//
//   1. the specialization's own name is NOT a read (and NOT a self-use);
//   2. a genuine CALL of the template stays a CALL (the callee leaf belongs to
//      the calls branch) — fmt format.h:426 `result = (result << num_bits<unsigned short>()) | …`;
//   3. a genuine VALUE READ in an array-size expression survives — the shape the
//      first cut of this rule over-suppressed on the corpus (a SHA1 array-size
//      argument reading a file-scope constant).

namespace detail
{

// The primary template: the name is a plain identifier under the declarator, so
// the generic declaration-position rule already covers it.
template <typename T> constexpr auto bits_of() -> int
{
  return (int)sizeof(T) * 8;
}

// The measured shape: an explicit specialization, whose declarator IS the
// template wrapper.
template <> constexpr auto bits_of<long>() -> int
{
  return 64;
}

// A second specialization of the same template, so the rule is pinned on the
// repeated shape and not on one site.
template <> constexpr auto bits_of<char>() -> int
{
  return 8;
}

const int kBufferSize = 8;
int shared_counter;

// Control 2: a call of the template. The callee leaf belongs to the calls
// branch, and no `uses` edge may be minted for it either.
int use_bits()
{
  return bits_of<short>();
}

// Control 3: a genuine read in an array-size expression (the shape the rule must
// NOT swallow) plus a bare value read.
int read_through_size()
{
  char buffer[kBufferSize];
  return buffer[0] + shared_counter;
}

} // namespace detail
