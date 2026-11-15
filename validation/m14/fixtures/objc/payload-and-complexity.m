// Managed-OO payload fixture (objective-c wave #267). Pins the class hierarchy
// semantics (extends superclass / implements protocols), category handling,
// property + ivar declarations, instantiates via [Foo alloc]/[Foo new], message
// calls, C function calls, imports, and per-symbol complexity.
#import <Foundation/Foundation.h>
#import "PaymentGateway.h"

@protocol PaymentGateway <NSObject>
- (BOOL)authorizeAmount:(double)amount;
@end

@protocol Refundable <NSObject>
- (BOOL)refund:(double)amount;
@end

@interface BaseService : NSObject
- (instancetype)initWithName:(NSString *)name;
@end

@interface PaymentService : BaseService <PaymentGateway, Refundable>
@property (nonatomic, strong) NSString *serviceName;
@property (nonatomic) double balance;
- (BOOL)authorizeAmount:(double)amount;
- (BOOL)refund:(double)amount;
+ (PaymentService *)sharedService;
@end

@implementation PaymentService
- (instancetype)initWithName:(NSString *)name {
    self = [super initWithName:name];
    if (self) { _serviceName = name; }
    return self;
}
- (BOOL)authorizeAmount:(double)amount {
    if (amount <= 0) { return NO; }
    if (amount > self.balance) { return NO; }
    for (int i = 0; i < 3; i++) { printf("attempt %d\n", i); }
    self.balance -= amount;
    return amount > 0 && self.balance >= 0 ? YES : NO;
}
- (BOOL)refund:(double)amount {
    self.balance += amount;
    return YES;
}
+ (PaymentService *)sharedService {
    static PaymentService *svc = nil;
    if (!svc) { svc = [[PaymentService alloc] initWithName:@"default"]; }
    return svc;
}
@end

@interface PaymentService (Audit)
- (NSString *)auditTrail;
@end

@implementation PaymentService (Audit)
- (NSString *)auditTrail {
    PaymentService *svc = [PaymentService sharedService];
    return [NSString stringWithFormat:@"balance=%.2f", svc.balance];
}
@end

@implementation BaseService
- (instancetype)initWithName:(NSString *)name {
    self = [super init];
    return self;
}
@end

static int globalCounter = 0;
