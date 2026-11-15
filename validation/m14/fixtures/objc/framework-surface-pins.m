// M60.R8 (CONV-OC-1) — the objective-c member of the C7 framework surface.
//
// The four imports deliberately run in the OPPOSITE order to the published
// contract: Foundation and Cocoa come first, AppKit and UIKit last. The pre-fix
// analyzer built `detectedFrameworks` as `[...frameworks]`, reading a Set — so
// the emitted array was insertion order, i.e. whatever order the `#import`
// statements happened to be visited in, and the primary pick was
// `[...frameworks][0]`. On this file that is [Foundation, Cocoa, AppKit, UIKit]
// and a primary of Foundation: the base library that nearly every Objective-C
// file imports, reported as the primary framework of a UIKit view. The
// contract's order is the declared table (application frameworks most-specific
// first, the base library LAST), so the pin is [UIKit, AppKit, Cocoa,
// Foundation] with UIKit as the primary pick.
//
// A revert to insertion order therefore fails the array pin, the primary pin and
// the frameworkPatterns pin at once, and a revert that drops frameworkPatterns
// fails the pattern pin on its own — the two defects the census registered
// (missing-contract-key) and the runtime half measured on 7 of 7 detecting
// corpus files.

#import <Foundation/Foundation.h>
#import <Cocoa/Cocoa.h>
#import <AppKit/AppKit.h>
#import <UIKit/UIKit.h>

@interface PinView : UIView
@end

@implementation PinView
@end
