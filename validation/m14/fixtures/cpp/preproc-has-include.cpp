// #743b: a HEADER NAME as a preprocessor argument — `__has_include(<vector>)`,
// `__has_include("meta")`, and the wrapper form real headers use,
// `FMT_HAS_INCLUDE(<string_view>)`.
//
// Every one of these shapes was an ERROR node before the rule landed (`<` had to
// be read as a binary operator with a missing left operand), and the class reaches
// 16 files across the two cpp corpora — it is the guard of every portable header.
//
// THE LAST TWO BLOCKS ARE THE POINT OF THIS FIXTURE. They are comparisons and must
// stay comparisons: the rule is scoped to the ARGUMENT position precisely because
// `<` cannot begin a preprocessor expression, so no `<` token competes with the
// header-name token there. A version that added `<...>` anywhere in
// `_preproc_expression` instead would read `< B && C >` as a header name and turn
// these two lines into something else — so they are pinned.

#if __has_include(<string_view>)
#endif

#if __has_include("meta")
#endif

#if FMT_HAS_INCLUDE(<string_view>)
#endif

#if FMT_HAS_INCLUDE(<string_view>) && \
    (FMT_CPLUSPLUS >= 201703L || defined(_LIBCPP_VERSION))
#endif

#if defined(__cpp_impl_reflection) && __has_include(<meta>)
#endif

#if FMT_CPLUSPLUS > 201703L && FMT_HAS_INCLUDE(<ranges>)
#endif

// Comparisons, not header names (see the header comment).
#if MAX(A < B, C > D)
#endif

#if A < B && C > D
#endif
