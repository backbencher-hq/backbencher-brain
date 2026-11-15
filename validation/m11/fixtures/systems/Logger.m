// validation/m11/fixtures/systems/Logger.m
// M11.10 Objective-C fixture: method implementations, instance variables,
// calls, class methods, category implementations.

#import "Logger.h"

@implementation Logger {
  NSString *_lastMessage;
}

- (instancetype)initWithPrefix:(NSString *)prefix {
  self = [super init];
  if (self) {
    _prefix = prefix;
  }
  return self;
}

- (void)log:(NSString *)message {
  _lastMessage = message;
  if ([self.delegate respondsToSelector:@selector(loggerDidLog:)]) {
    [self.delegate loggerDidLog:message];
  }
}

- (NSString *)formattedMessage:(NSString *)message {
  return [NSString stringWithFormat:@"[%@] %@", self.prefix, message];
}

+ (Logger *)sharedLogger {
  static Logger *shared = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    shared = [[Logger alloc] initWithPrefix:@"app"];
  });
  return shared;
}

@end

@implementation Logger (Formatting)

- (NSString *)uppercaseMessage:(NSString *)message {
  return [message uppercaseString];
}

@end
