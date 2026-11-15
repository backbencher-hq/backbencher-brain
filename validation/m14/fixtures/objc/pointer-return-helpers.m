// M37.15 objc dual-lens fixture: pins OBJCD5 + OBJCD6 (probe-verified on
// afnetworking + sdwebimage, 2026-09).
//
//  - OBJCD5: pointer/object-return C helper functions (`static NSArray * fn`)
//    parse their defining declarator NESTED (pointer_declarator >
//    function_declarator). The pre-fix direct-child lookup dropped the
//    function symbol AND — because activeScope stayed "global" — suppressed
//    the function's entire body (calls/uses/instantiates). Corpus: 46 of 110
//    C helpers affected across afnetworking+sdwebimage.
//  - OBJCD6: macro-invocation-as-declaration inside an @implementation ivar
//    block (`LOCK_DECLARE(_lock);`) parses as a call_expression at class
//    scope; the pre-fix scope-only gate emitted a fabricated `calls` edge
//    (activeScope = class name was non-global). A real execution body
//    (method/function/block) is required for message/call/uses edges.

#define LOCK_DECLARE(l) os_unfair_lock l

// OBJCD5 pointer-return helpers — each must be a Function symbol whose body
// edges carry the function as source.
static NSArray * HelperObjects(void) {
    return [NSArray arrayWithObjects:@"a", nil];
}

static UIImage * MakeImage(NSData *data) {
    NSData *d = [data copy];
    UIImage *img = [UIImage imageWithData:d];
    return img;
}

// A plain-return helper (control): already symbolized pre-fix.
static void PlainHelper(int x) {
    printf("%d", x);
}

// OBJCD6: the macro call in the ivar block is a DECLARATION, never an edge.
@implementation Widget {
    LOCK_DECLARE(_lock);
    NSMutableArray *_items;
}

- (void)work {
    [_items addObject:@"x"];
    self.name = @"w";
    (void)self.count;
}

@end
