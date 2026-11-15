// DERIV_EXPORTS_OBJC — trailing annotation macros are NOT part of a selector.
//
// WHY THIS FIXTURE EXISTS. The grammar puts a method's trailing annotation macros
// at the method node's TOP LEVEL as bare `identifier` children with no
// `method_parameter` after them, and `fullMethodSelector` used to concatenate
// every top-level identifier. So `- (instancetype)initWithBaseURL:(NSURL *)url
// sessionConfiguration:(NSURLSessionConfiguration *)c NS_DESIGNATED_INITIALIZER;`
// published the selector `initWithBaseURL:sessionConfiguration:NS_DESIGNATED_INITIALIZER`
// — a name no class in the world declares, and an `overrides` target
// (`AFURLSessionManager.<that name>`) that resolves to nothing.
//
// Measured over the 322-file admitted universe by script/m60/objc-selector-integrity.ts
// BEFORE the fix: 79 method nodes in 29 files, and 109 fabricated `overrides`
// targets across the corpus census.
//
// The structural rule the grammar supports, and what this fixture pins: a
// selector is the chain of keywords, each an `identifier` immediately followed by
// a `method_parameter`; a zero-argument selector is exactly ONE `identifier`
// with no `method_parameter` after it; every other top-level identifier is an
// annotation and the chain ends there.
//
// All three corpus shapes are in the file, because the shape census says which
// ones exist (keywordChain 1595, singleBare 1217, bareAfterKeyword 79) and a
// fixture that only covered one of them would pass for the wrong reason.
// `bareThenKeyword` and `bareOnlyMulti` are 0 in the corpus, so no fixture
// claims them here.
//
// Every annotation below is spelled exactly as the corpus spells it
// (NS_REFINED_FOR_SWIFT x62, NS_DESIGNATED_INITIALIZER x15, NS_SWIFT_NOTHROW x2)
// so the fixture fails on the real shapes, not on invented ones.

@class AnnotatedBase;

@interface AnnotatedCache : NSObject
- (instancetype)initWithBaseURL:(NSURL *)url sessionConfiguration:(NSURLSessionConfiguration *)config NS_DESIGNATED_INITIALIZER;
- (id)objectForKey:(NSString *)key NS_SWIFT_NOTHROW;
- (void)sd_setImageWithURL:(NSURL *)url placeholderImage:(id)image options:(NSUInteger)opts NS_REFINED_FOR_SWIFT;
- (void)plain;
@end

@implementation AnnotatedCache
- (instancetype)initWithBaseURL:(NSURL *)url sessionConfiguration:(NSURLSessionConfiguration *)config {
    self = [super init];
    return self;
}
- (id)objectForKey:(NSString *)key NS_SWIFT_NOTHROW {
    return key;
}
- (void)sd_setImageWithURL:(NSURL *)url placeholderImage:(id)image options:(NSUInteger)opts NS_REFINED_FOR_SWIFT {
    (void)url;
    (void)image;
    (void)opts;
}
- (void)plain {
    NSLog(@"plain");
}
@end

// The annotation must not break the override machinery either: the subclass
// declares the SAME annotated selector, so the in-file superclass test must find
// it and publish ONE verified override whose target is the real selector.
@interface AnnotatedSubclass : AnnotatedCache
- (void)plain;
- (void)dropFirst:(NSString *)key NS_SWIFT_NOTHROW;
@end

@implementation AnnotatedSubclass
- (void)plain {
    [super plain];
}
- (void)dropFirst:(NSString *)key NS_SWIFT_NOTHROW {
    NSLog(@"%@", key);
}
@end

// A message send whose target carries an annotation on the DECLARATION side.
// The receiver's declared selector is `dropFirst:` — so the call resolves to it,
// and there is no `dropFirst:NS_SWIFT_NOTHROW` anywhere.
@interface AnnotatedCaller : NSObject
- (void)drive;
@end

@implementation AnnotatedCaller
- (void)drive {
    AnnotatedSubclass *c = [[AnnotatedSubclass alloc] init];
    [c dropFirst:@"k" NS_SWIFT_NOTHROW];
}
@end