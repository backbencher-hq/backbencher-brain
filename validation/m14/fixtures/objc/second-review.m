// OC-F: same-file enum cases read as values (labels, comparisons,
// returns). NS_ENUM/NS_OPTIONS need macro expansion AND live in headers —
// silent by unit design on both sides.
// OC-G: @protocol(P) is a directive, never a call (@encode already silent).
// OC-H: file-scope function names are values (decay reads, recursion refs).
enum Shade {
  Light,
  Dark
};

int cfn(int x) {
  return x * 2;
}

@interface Valve
@property (nonatomic) int level;
@end

@implementation Valve
- (NSString *)shadeName:(int)s {
  switch (s) {
    case Light:
      return @"light";
    case Dark:
      return @"dark";
  }
  return nil;
}

- (int)check:(int)x {
  if (x == Light) {
    return Dark;
  }
  return x;
}

- (void)hooks {
  int (*cb)(int) = cfn;
  int v = cfn(21);
  BOOL ok = [obj conformsToProtocol:@protocol(Valve)];
  Protocol *p = @protocol(Valve);
  int total = self.level + cfn(v);
}
@end
