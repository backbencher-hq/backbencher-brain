// validation/m12/fixtures/objective-c/user_config.h
// M12.19 Objective-C negative fixture: config header with C-family noise
// constructs — #define macros, plain typedef enum, typedef alias, static
// const, function declaration. No class-declaration markers here, so the
// shared C-family detection path parses it (same as the C++ shape_config.h
// precedent); the differential encodes exactly what the pipeline emits.
// NOTE: the modern `typedef NS_ENUM(...)` macro form is a genuine grammar gap
// (ERROR node) recorded in docs/analyzers/real-objective-c-analyzer.md.

#ifndef USER_CONFIG_H
#define USER_CONFIG_H

#import <Foundation/Foundation.h>

#define MAX_USERS 1000
#define USER_PREFIX @"usr_"

typedef enum {
  UserRoleGuest = 0,
  UserRoleMember = 1,
  UserRoleAdmin = 2,
} UserRole;

typedef NSString *UserId;

static NSString *const defaultRole = @"member";

int user_config_version(void);

#endif // USER_CONFIG_H
