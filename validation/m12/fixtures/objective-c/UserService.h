// validation/m12/fixtures/objective-c/UserService.h
// M12.19 Objective-C fixture: class interface, protocol, properties,
// method declarations (instance + class), imports.

#import <Foundation/Foundation.h>

@protocol UserStore <NSObject>
- (BOOL)saveUser:(NSString *)userId;
- (NSString *)findUser:(NSString *)userId;
@end

@interface UserService : NSObject <UserStore>

@property (nonatomic, copy) NSString *serviceName;
@property (nonatomic, assign) NSInteger maxUsers;

- (instancetype)initWithName:(NSString *)name;
- (BOOL)registerUser:(NSString *)userId;
+ (UserService *)sharedService;

@end
