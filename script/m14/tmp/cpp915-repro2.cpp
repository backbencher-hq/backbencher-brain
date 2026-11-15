struct Widget {
  int size_;
};
#endif  // FMT_USE_FCNTL

FMT_END_EXPORT
FMT_END_NAMESPACE

void after(void) { Widget w; (void)w; }
