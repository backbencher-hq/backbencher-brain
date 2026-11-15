#if __has_include(<string_view>)
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

#if FMT_CPLUSPLUS >= 201703L
#endif

#if __has_include("meta")
#endif

#if defined(A) && __has_include(<b>)
#endif

#if MAX(A < B, C > D)
#endif

#if A < B && C > D
#endif
