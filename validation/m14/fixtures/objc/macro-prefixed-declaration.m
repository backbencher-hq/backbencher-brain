// #743's class, objective-c half: a BARE macro invocation at file scope
// immediately before an Objective-C declaration.
//
// Measured over the two pinned corpora (sdwebimage + afnetworking, 322
// objc-routed files) under the previous grammar: 11 headers lost their surface
// and 122 real symbols went with it — AFHTTPSessionManager.h published 0 of its
// 37 declared symbols. The cause is that the bare macro is read as the FIRST
// TOKEN of a declaration which then cannot continue (`@interface` is neither a
// declarator nor a type), so the parser swallows the following lines into an
// ERROR INSIDE that declaration. What survived was minted from the wreckage:
// `variable NSObject` for the lost superclass, `variable void` for a method's
// return type, `variable provider` for a parameter name.
//
// Both halves are pinned here: the RECOVERY (the class with its owned methods
// and properties, the protocol, the forward declaration) and the PHANTOMS'
// absence.
//
// The macros are deliberately NOT defined — the identifiers stay plain tokens,
// which is the shape of the corpus before the preprocessor has run. The last
// section is the control: the same declarations with no macro prologue, the
// shape that always parsed, so a future rule that costs this one is caught.

#define API_EXPORT
#define PROTOCOL_MACRO
#define CLASS_MACRO

API_EXPORT
@interface DecoratedPool : NSObject
@property (nonatomic, assign) NSUInteger maxBufferCount;
- (void)registerProvider:(id)provider;
- (instancetype)initWithBaseURL:(NSURL *)url;
@end

NS_ASSUME_NONNULL_BEGIN
@interface Annotated : NSString
- (void)prefetchFrameAtIndex:(NSUInteger)index;
@end
NS_ASSUME_NONNULL_END

PROTOCOL_MACRO
@protocol Provider <NSObject>
- (void)provide;
@end

CLASS_MACRO
@class Forwarded;

// Control — no macro prologue above this one.
@interface Plain : NSObject
- (void)work;
@end
