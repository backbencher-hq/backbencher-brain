// OC-E: bare-identifier value reads. Parameters, body locals, same-file
// ivars/properties and file globals are resolvable read targets; everything
// else (keywords, selectors, callees, declaration names, assignment writes,
// @synthesize/@selector names, self/super/nil/YES) is a name, not a read.
@interface Cache
@property (nonatomic) int level;
@end

static int gTotal = 0;
static NSString * gLabel = @"cache";
static NSArray * gItems;

@implementation Cache {
  id store;
  int _count;
}

- (id)objectForKey:(id)k {
  int depth = self.level + 1;
  id hit = [store objectForKey:k];
  id retain = [hit retain];
  gTotal = depth;
  NSError *err;
  err = [self fetch:depth error:&err];
  for (id x in gItems) {
    [self use:x];
  }
  void (^blk)(int) = ^(int n) {
    [self use:n];
  };
  blk(depth);
  self.level = depth;
  _count = _count + 1;
  return hit;
}

- (void)tick {
  self.count++;
}

@end

int bumpLimit(int limit) {
  int r = limit * 2 + gTotal;
  return r;
}

// M60 (2026-09-25): a block-pointer PARAMETER's declared name is a DECLARATION,
// never a read — the declaration is not an execution site. Pre-fix the line
// `handler` is declared on was published as `uses runBlock -> handler` with no
// read anywhere in the function (and the deriveObjcEdges oracle mirrored it);
// C parity settles it: `void h(void (*cb)(int)) { int x = 0; }` publishes
// nothing at all, and the function-pointer/block parameter's only edge is the
// CALL where it is invoked.
void runBlock(void (^handler)(NSString *)) {
  NSString *tag = @"t";
  handler(tag);
}

// OC-B: a category is not a top-level resolvable unit (swift precedent:
// extension symbols exist but never export) — NSString must not export.
@interface NSString (Trim)
- (NSString *)trimmed;
@end

// OC-D: C type inventory parity (holy-c waves) — the pinned objc wasm
// shares the C node shapes exactly. References for type uses are
// deliberately NOT emitted (every signature mentions Foundation types).
typedef int Counter;

struct Point {
  int x;
  int y;
  struct Node *next;
};

enum Color {
  Red,
  Green = 3,
  Blue
};

typedef struct {
  int w;
} Size;

union Value {
  int i;
  float f;
};

@interface Holder
@end

@implementation Holder {
  id _label;
}
@synthesize label = _label;
- (SEL)maker {
  id fire = @"x";
  SEL s = @selector(fire:);
  id v = _label;
  return s;
}
@end
