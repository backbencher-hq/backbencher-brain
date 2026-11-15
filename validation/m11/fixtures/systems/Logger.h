// validation/m11/fixtures/systems/Logger.h
// M11.10 Objective-C fixture: class interfaces, protocols, categories,
// properties, method declarations, imports.

#import <Foundation/Foundation.h>

@protocol LoggerDelegate <NSObject>
- (void)loggerDidLog:(NSString *)message;
@end

@interface Logger : NSObject

@property (nonatomic, copy) NSString *prefix;
@property (nonatomic, weak) id<LoggerDelegate> delegate;

- (instancetype)initWithPrefix:(NSString *)prefix;
- (void)log:(NSString *)message;
- (NSString *)formattedMessage:(NSString *)message;
+ (Logger *)sharedLogger;

@end

@interface Logger (Formatting)
- (NSString *)uppercaseMessage:(NSString *)message;
@end
