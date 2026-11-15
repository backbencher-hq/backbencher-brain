// M37.16 objc selector-identity fixture (OBJCD7 + OBJCD8, 2026-09).
//
// OBJCD7 — full-selector method identity: distinct ObjC selectors that share
// a first keyword are DIFFERENT methods and must stay distinct symbols.
// Leaf naming merged them into one (`initWithNamespace` collapsed
// initWithNamespace / initWithNamespace:diskCacheDirectory: /
// initWithNamespace:diskCacheDirectory:config: -> ONE symbol, silently losing
// 2 of 3). Corpus: 225 colliding method occurrences across 35 owners in
// sdwebimage + afnetworking (SDImageCache alone lost 14 of 59 selectors).
//   - expectSymbolCount: initWithNamespace: == 1, initWithNamespace:diskCacheDirectory: == 1
//   - forbidSymbols: leaf names ("initWithNamespace", "setValue") never exist
// OBJCD8 — override machinery (M37.10 implicit-override family model): a
// subclass method whose in-file superclass declares the SAME FULL SELECTOR is
// a verified override @0.95. ObjC was the only inheritance family member with
// zero overrides (dead classifyEvidenceTier branch). Also pins the external-base
// first-parent guess @0.5 below threshold (SDTestCase not declared in this
// file -> StoreCache.overrideable: and StoreCache.init: guess toward it), and
// the universal-root exclusion (StoreCache : NSObject/NSProxy extends target
// is NOT a guess source — no per-method noise toward the root).

@class SDTestCase;

@interface StoreCache : NSObject
- (instancetype)initWithNamespace:(NSString *)ns;
- (instancetype)initWithNamespace:(NSString *)ns diskCacheDirectory:(NSString *)dir;
- (instancetype)initWithNamespace:(NSString *)ns diskCacheDirectory:(NSString *)dir config:(id)config;
- (void)setValue:(id)value;
- (void)setValue:(id)value forKey:(NSString *)key;
- (void)storeImage:(id)image forKey:(NSString *)key;
- (id)imageFromCacheForKey:(NSString *)key options:(unsigned long)opts;
- (void)overrideable;
@end

@implementation StoreCache
- (instancetype)initWithNamespace:(NSString *)ns {
    self = [super init];
    return self;
}
- (instancetype)initWithNamespace:(NSString *)ns diskCacheDirectory:(NSString *)dir {
    self = [self initWithNamespace:ns];
    return self;
}
- (instancetype)initWithNamespace:(NSString *)ns diskCacheDirectory:(NSString *)dir config:(id)config {
    self = [self initWithNamespace:ns diskCacheDirectory:dir];
    return self;
}
- (void)setValue:(id)value { [self log:value]; }
- (void)setValue:(id)value forKey:(NSString *)key { [self log:value]; (void)key; }
- (void)storeImage:(id)image forKey:(NSString *)key { (void)image; (void)key; }
- (id)imageFromCacheForKey:(NSString *)key options:(unsigned long)opts { return key; }
- (void)overrideable { NSLog(@"base"); }
- (void)log:(id)value { (void)value; }
@end

// In-file superclass declaring the SAME full selector -> verified override.
@interface EvictingCache : StoreCache
- (void)overrideable;
- (void)purge;
@end

@implementation EvictingCache
- (void)overrideable {
    [self purge];
}
- (void)purge { NSLog(@"purge"); }
@end

// External base (SDTestCase lives elsewhere) -> first-parent guess @0.5.
@interface StoreCacheTests : SDTestCase
- (void)testInitWithNamespace;
- (void)testStore;
@end

@implementation StoreCacheTests
- (void)testInitWithNamespace {
    StoreCache *c = [[StoreCache alloc] initWithNamespace:@"a" diskCacheDirectory:@"b"];
    [c imageFromCacheForKey:@"k" options:0];
}
- (void)testStore {
    StoreCache *c = [StoreCache new];
    [c setValue:@1 forKey:@"k"];
    [c storeImage:nil forKey:@"k"];
}
@end
