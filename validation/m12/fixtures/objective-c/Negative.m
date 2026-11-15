// validation/m12/fixtures/objective-c/Negative.m
// M12.19 Objective-C negative fixture: function-local variables, blocks,
// selectors, and C function calls must NOT leak symbols; local declarations
// inside method bodies are execution artifacts (no symbols); the category
// extension name is the class name (not the category label).

#import <Foundation/Foundation.h>
#import "user_config.h"

static int module_counter = 0;   // file-scope static — variable symbol

int user_config_version(void) {
  return 2;
}

@implementation NSError (UserError)

+ (NSError *)userErrorWithCode:(NSInteger)code {
  NSError *error = [NSError errorWithDomain:@"User" code:code userInfo:nil];
  return error;
}

- (NSString *)localDescription {
  NSString *prefix = @"err";      // method-local — NO symbol
  return [prefix stringByAppendingString:@"local"];
}

@end

void register_block(void (^handler)(NSString *)) {
  handler(@"x");                  // block parameter — NO symbol, call to handler
}
