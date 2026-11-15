// Two Apple idioms that a plausible-looking grammar gets wrong, and that a fixture written
// without them would never catch.
//
// 1. `typedef NS_ENUM(Underlying, Name) { ... };` — the name is inside the macro's arguments
//    and there is NO trailing declarator, which is the opposite of every other typedef the
//    grammar already handled. Apple's own headers are written this way.
//
// 2. A bare macro line above an `@interface`, INSIDE a `#if`. tree-sitter-c builds a
//    file-scope `preproc_if` body from `_block_item`, not `_top_level_item`, so a rule
//    registered only in `_top_level_item` is unreachable inside every conditional. sdwebimage
//    wraps most of its headers in `#if SD_UIKIT || SD_MAC`, so this is not an exotic shape —
//    and the failure was not a small one: the ERROR node it produced ran 101 lines to the next
//    `@end` and deleted the whole class, replacing its properties with phantoms named after
//    the property ATTRIBUTES (`variable:strong`, `variable:copy`, `variable:assign`,
//    `variable:readonly`).
//
// Both are pinned here by SYMBOL, not by "no error": a grammar that swallows a class emits
// fewer errors than one that reads it correctly if the reader is careless, and the phantom
// property-attribute symbols are the specific wrongness that has to stay forbidden.
#import <Foundation/Foundation.h>

NS_SWIFT_UI_ACTOR
@interface MacroGuardedView : UIView
@property (nonatomic, strong, readonly) NSString *identifier;
@end

#if SD_UIKIT || SD_MAC

typedef NS_ENUM(NSInteger, GuardedMode) {
    GuardedModeAutomatic,
    GuardedModeManual,
};

typedef NS_OPTIONS(NSUInteger, GuardedTraits) {
    GuardedTraitNone  = 0,
    GuardedTraitCache = 1 << 0,
    GuardedTraitDisk  = 1 << 1,
};

@interface GuardedController : NSObject
@property (nonatomic, assign) GuardedMode mode;
@property (nonatomic, assign) GuardedTraits traits;
@end

#endif

// An availability annotation is a MACRO CALL with nested parens, commas and a string, and it
// trails the last parameter of a method declaration. C's macro_type_specifier covers
// `MACRO(type)` and attribute_specifier covers `[[...]]`, so neither reached this shape, and
// the ERROR node it produced swallowed the ENCLOSING @protocol — 83 lines, one protocol,
// deleted. That protocol is pinned here by its method names, because a swallowed protocol
// yields a file with no methods in it and no error a reader would attribute to it.
@protocol GuardedStore <NSObject>
- (void)removeImageForKey:(nullable NSString *)key
                    options:(GuardedTraits)traits
    API_DEPRECATED_WITH_REPLACEMENT("use removeImageForKey:options:", macos(10.10, API_TO_BE_DEPRECATED), ios(8.0, API_TO_BE_DEPRECATED), tvos(9.0, API_TO_BE_DEPRECATED));
- (void)flushPendingWrites AF_API_UNAVAILABLE(macos);
@end
