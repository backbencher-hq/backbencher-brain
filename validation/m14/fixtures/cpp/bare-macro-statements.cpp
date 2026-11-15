// #915: a bare top-level macro must not become a symbol.
//
// Both shapes below are taken verbatim from the measured fmt sites: a run of
// bare macros at file scope just before a conditional closes (`include/fmt/os.h`
// 416-417, `include/fmt/base.h` 2952-2953). The grammar recovers that run as a
// `declaration` whose "type" is itself a macro and whose terminator is MISSING,
// and the declaration branch then names a symbol after the last macro.
//
// `Widget`/`size_`/`helper` are the control: a real declaration inside the same
// conditional must keep its real symbol, so a fix that simply dropped
// declarations inside error-recovered regions would fail here.

#define FMT_BEGIN_EXPORT
#define FMT_END_EXPORT
#define FMT_END_NAMESPACE

#if FMT_HEADER_ONLY

FMT_BEGIN_EXPORT

struct Widget {
  int size_;
};

int helper(void) { Widget w; return w.size_; }

FMT_END_EXPORT
FMT_END_NAMESPACE

#endif  // FMT_HEADER_ONLY

int after_macros(void) { Widget w; return w.size_; }
