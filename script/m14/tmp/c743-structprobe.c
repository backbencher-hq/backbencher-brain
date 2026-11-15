/* #743 probe: the same struct written three ways, so the loss can be
   attributed to the macro rather than to the analyzer's struct handling. */
struct Plain {
  int a;
  int b;
};

static WSD struct Wrapped {
  int c;
  int d;
};

static struct Control {
  int e;
  int f;
};

int usePlain(void) { return 0; }

static int TCLAPI wrappedFn(void) { return 1; }

static int plainFn(void) { return 2; }
