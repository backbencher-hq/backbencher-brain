// validation/m12/fixtures/objective-c/UserService.m
// M12.19 Objective-C fixture: method implementations, ivars, message sends,
// alloc/init instantiation, category implementation.

#import "UserService.h"

@implementation UserService {
  NSString *_activeUserId;
  NSMutableArray *_savedUsers;
}

- (instancetype)initWithName:(NSString *)name {
  self = [super init];
  if (self) {
    _serviceName = name;
    _savedUsers = [[NSMutableArray alloc] init];
  }
  return self;
}

- (BOOL)saveUser:(NSString *)userId {
  _activeUserId = userId;
  [_savedUsers addObject:userId];
  return YES;
}

- (NSString *)findUser:(NSString *)userId {
  if ([_savedUsers containsObject:userId]) {
    return [_savedUsers objectAtIndex:0];
  }
  return nil;
}

- (BOOL)registerUser:(NSString *)userId {
  return [self saveUser:userId];
}

+ (UserService *)sharedService {
  static UserService *shared = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    shared = [[UserService alloc] initWithName:@"default"];
  });
  return shared;
}

@end

@implementation UserService (Validation)

- (BOOL)isValidUserId:(NSString *)userId {
  return [userId length] > 0;
}

@end
