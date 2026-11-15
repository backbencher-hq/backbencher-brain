// Edge-case fixture (objective-c wave #267, deep-verify pass). Pins the rare
// shapes the grammar audit probed: category detection (Extension + class-
// owned methods), protocol-only classes (implements, never extends), class
// methods (+), nested [[Foo alloc] init] message expressions, block literals
// (no symbol), C functions at file scope, ivars, @interface without
// @implementation, PROTOCOL INHERITANCE (extends via protocol_reference_list),
// category-declared protocol conformance (implements), and member READS
// (uses for dot-syntax property reads; writes excluded).
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

@protocol Renderable <NSObject>
- (void)render;
@end

@protocol Animatable <Renderable>
- (void)animate;
@end

@interface UIView (RoundedCorner) <Animatable>
- (void)applyRoundedCornerRadius:(CGFloat)radius;
@end

@implementation UIView (RoundedCorner)
- (void)applyRoundedCornerRadius:(CGFloat)radius {
    [self.layer setCornerRadius:radius];
    self.clipsToBounds = YES;
}
- (void)animate {
    UIView *superview = self.superview;   // member read
    if (superview && superview.hidden) {  // member reads in condition
        [superview setHidden:NO];
    }
    self.clipsToBounds = YES;             // write — NOT a uses edge
}
@end

@interface CustomView : UIView <Renderable>
@end

@implementation CustomView
- (void)render {
    UIView *box = [[UIView alloc] initWithFrame:CGRectZero];
    [box addSubview:self];
    void (^flashBlock)(void) = ^{ [box setHidden:NO]; };
    flashBlock();
}
+ (CustomView *)makeWithView:(UIView *)view {
    CustomView *cv = [CustomView new];
    [cv addSubview:view];
    return cv;
}
@end

static void Log(const char *msg) {
    printf("%s", msg);
}

void renderAll(NSArray *views) {
    for (UIView *v in views) {
        Log("rendering");
        [v render];
    }
}

// F6 coverage (2026-09-02): case_statement / while_statement / do_statement
// control flow + instance_variable ivar reads were declared handled_verified
// but no fixture exercised them. Adds a switch, while, do-while, and direct
// ivar access inside an @implementation.
static NSInteger renderCount = 0;

@interface Counter : NSObject {
    NSInteger _count;
}
- (NSInteger)countAll:(NSArray *)items;
@end

@implementation Counter
- (NSInteger)countAll:(NSArray *)items {
    for (UIView *v in items) { _count += 1; }
    NSInteger i = 0;
    while (i < 3) {
        _count += i;
        i += 1;
    }
    do {
        _count -= 1;
    } while (_count > 10);
    switch (_count) {
        case 0:
            Log("zero");
            break;
        case 1:
        case 2:
            Log("few");
            break;
        default:
            Log("many");
            break;
    }
    return _count;
}
@end
