#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import <mach/mach.h>
static void releaseBytes(void *bytes, void *context) { (void)context; free(bytes); }
int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc != 2) return 2;
    NSError *error = nil;
    NSString *source = [NSString stringWithContentsOfFile:[NSString stringWithUTF8String:argv[1]] encoding:NSUTF8StringEncoding error:&error];
    if (!source) { NSLog(@"%@", error); return 2; }
    puts("{\"engine\":\"jsc\",\"nativeCycles\":[");
    for (unsigned nativeCycle = 0; nativeCycle < 10; nativeCycle++) { @autoreleasepool {
    double created = NSProcessInfo.processInfo.systemUptime * 1000;
    JSContext *ctx = [[JSContext alloc] init]; __block BOOL failed = NO, reported = NO; __block unsigned identity = 0;
    double contextMs = NSProcessInfo.processInfo.systemUptime * 1000 - created;
    ctx.exceptionHandler = ^(JSContext *context, JSValue *exception) { (void)context; failed = YES; NSLog(@"JS exception: %@", exception); };
    ctx[@"host"] = @{};
    ctx[@"host"][@"now"] = ^double { return NSProcessInfo.processInfo.systemUptime * 1000; };
    ctx[@"host"][@"uuid"] = ^NSString * { return [NSString stringWithFormat:@"00000000-0000-4000-8000-%012u", identity++]; };
    ctx[@"host"][@"echo"] = ^JSValue *(JSValue *value) {
      JSGlobalContextRef c = ctx.JSGlobalContextRef; JSValueRef exception = NULL;
      JSObjectRef input = JSValueToObject(c, value.JSValueRef, &exception);
      if (exception || !input) { ctx.exception = [JSValue valueWithNewErrorFromMessage:@"invalid buffer" inContext:ctx]; return [JSValue valueWithUndefinedInContext:ctx]; }
      size_t size = JSObjectGetArrayBufferByteLength(c, input, &exception);
      void *bytes = JSObjectGetArrayBufferBytesPtr(c, input, &exception);
      if (exception || !bytes || size > 16 * 1024 * 1024) { ctx.exception = [JSValue valueWithNewErrorFromMessage:@"invalid buffer" inContext:ctx]; return [JSValue valueWithUndefinedInContext:ctx]; }
      void *copy = malloc(size);
      if (!copy) { ctx.exception = [JSValue valueWithNewErrorFromMessage:@"buffer allocation failed" inContext:ctx]; return [JSValue valueWithUndefinedInContext:ctx]; }
      memcpy(copy, bytes, size);
      JSObjectRef output = JSObjectMakeArrayBufferWithBytesNoCopy(c, copy, size, releaseBytes, NULL, &exception);
      return [JSValue valueWithJSValueRef:output inContext:ctx];
    };
    __block NSString *reportText = nil;
    ctx[@"host"][@"report"] = ^(NSString *text) { reportText = [text copy]; reported = YES; };
    [ctx evaluateScript:source withSourceURL:[NSURL URLWithString:@"bundle:workload.js"]];
    [ctx evaluateScript:@"MobileSpike.run().then(r=>host.report(JSON.stringify(r)),e=>{throw e})"];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:30];
    while (!reported && !failed && [deadline timeIntervalSinceNow] > 0) [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]];
    struct mach_task_basic_info info; mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
    task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &count);
    if (!failed && reported) {
      if (nativeCycle) puts(",");
      NSData *sourceData = [source dataUsingEncoding:NSUTF8StringEncoding]; uint32_t sourceHash = 2166136261u;
      const unsigned char *sourceBytes = sourceData.bytes;
      for (NSUInteger i = 0; i < sourceData.length; i++) sourceHash = (sourceHash ^ sourceBytes[i]) * 16777619u;
      printf("{\"nativeCycle\":%u,\"phase\":\"initial\",\"sourceHash\":\"%08x\",\"workload\":%s}", nativeCycle, sourceHash, reportText.UTF8String);
      fprintf(stderr, "{\"engine\":\"jsc\",\"nativeCycle\":%u,\"contextCreateMs\":%.6f,\"cycleMs\":%.6f,\"residentBytesBeforeDispose\":%llu,\"budgetInterrupt\":\"pending\"}\n", nativeCycle, contextMs, NSProcessInfo.processInfo.systemUptime * 1000 - created, (unsigned long long)info.resident_size);
    }
    // Break native closure ownership before releasing the context.
    ctx[@"host"] = [JSValue valueWithUndefinedInContext:ctx]; ctx.exceptionHandler = nil;
    if (failed || !reported) return 3;
    }}
    puts("\n]}"); return 0;
  }
}
