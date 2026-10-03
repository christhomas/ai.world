#define _POSIX_C_SOURCE 200809L
#include "quickjs.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/resource.h>
static double deadline;
static unsigned identity;
static int reported;
static double now_ms(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1000.0 + t.tv_nsec / 1e6; }
static int interrupt(JSRuntime *rt, void *opaque) { (void)rt; (void)opaque; return now_ms() > deadline; }
static JSValue now(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) { (void)self; (void)argc; (void)argv; return JS_NewFloat64(ctx, now_ms()); }
static JSValue uuid(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) { (void)self; (void)argc; (void)argv; char text[64]; snprintf(text, sizeof text, "00000000-0000-4000-8000-%012u", identity++); return JS_NewString(ctx, text); }
static JSValue echo(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  (void)self; if (argc != 1) return JS_ThrowTypeError(ctx, "expected buffer");
  size_t size; uint8_t *bytes = JS_GetArrayBuffer(ctx, &size, argv[0]);
  if (!bytes || size > 16 * 1024 * 1024) return JS_ThrowTypeError(ctx, "invalid buffer");
  return JS_NewArrayBufferCopy(ctx, bytes, size);
}
static JSValue report(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  (void)self; if (argc != 1) return JS_ThrowTypeError(ctx, "expected report");
  const char *text = JS_ToCString(ctx, argv[0]); if (!text) return JS_EXCEPTION;
  puts(text); JS_FreeCString(ctx, text); reported = 1; return JS_UNDEFINED;
}
static int exception(JSContext *ctx) { JSValue e = JS_GetException(ctx); const char *text = JS_ToCString(ctx, e); fprintf(stderr, "%s\n", text ? text : "JS exception"); JS_FreeCString(ctx, text); JS_FreeValue(ctx, e); return 1; }
int main(int argc, char **argv) {
  if (argc != 2) return 2;
  FILE *file = fopen(argv[1], "rb"); if (!file) return 2;
  fseek(file, 0, SEEK_END); long length = ftell(file); rewind(file);
  if (length < 0 || length > 32 * 1024 * 1024) return 2;
  char *source = malloc((size_t)length + 1); if (!source) return 2;
  if (fread(source, 1, length, file) != (size_t)length) return 2; fclose(file); source[length] = 0;
  JSRuntime *rt = JS_NewRuntime(); JS_SetMemoryLimit(rt, 128 * 1024 * 1024); JS_SetMaxStackSize(rt, 1024 * 1024);
  JSContext *ctx = JS_NewContext(rt); deadline = now_ms() + 30000; JS_SetInterruptHandler(rt, interrupt, NULL);
  JSValue global = JS_GetGlobalObject(ctx), host = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, host, "now", JS_NewCFunction(ctx, now, "now", 0));
  JS_SetPropertyStr(ctx, host, "uuid", JS_NewCFunction(ctx, uuid, "uuid", 0));
  JS_SetPropertyStr(ctx, host, "echo", JS_NewCFunction(ctx, echo, "echo", 1));
  JS_SetPropertyStr(ctx, host, "report", JS_NewCFunction(ctx, report, "report", 1));
  JS_SetPropertyStr(ctx, global, "host", host); JS_FreeValue(ctx, global);
  JSValue value = JS_Eval(ctx, source, length, "bundled-workload.js", JS_EVAL_TYPE_GLOBAL); free(source);
  if (JS_IsException(value)) return exception(ctx); JS_FreeValue(ctx, value);
  const char *invoke = "MobileSpike.run().then(r=>host.report(JSON.stringify(r)),e=>{throw e})";
  value = JS_Eval(ctx, invoke, strlen(invoke), "invoke.js", JS_EVAL_TYPE_GLOBAL);
  if (JS_IsException(value)) return exception(ctx); JS_FreeValue(ctx, value);
  JSContext *job; int status; while ((status = JS_ExecutePendingJob(rt, &job)) > 0) {}
  if (status < 0) return exception(job); if (!reported) return 3;
  // A genuinely stuck script must interrupt, then this same engine must recover.
  deadline = now_ms() + 10;
  value = JS_Eval(ctx, "while(true){}", 13, "budget-probe.js", JS_EVAL_TYPE_GLOBAL);
  if (!JS_IsException(value)) return 4; JS_FreeValue(ctx, value);
  value = JS_GetException(ctx); JS_FreeValue(ctx, value); deadline = now_ms() + 1000;
  value = JS_Eval(ctx, "1+1", 3, "recover.js", JS_EVAL_TYPE_GLOBAL);
  int answer = 0; if (JS_IsException(value) || JS_ToInt32(ctx, &answer, value) || answer != 2) return 5;
  JS_FreeValue(ctx, value); JSMemoryUsage memory; JS_ComputeMemoryUsage(rt, &memory);
  struct rusage usage; getrusage(RUSAGE_SELF, &usage);
  fprintf(stderr, "quickjs=2026-06-04 heap_bytes=%lld peak_rss_kib=%ld budget_recovered=true\n", (long long)memory.memory_used_size, usage.ru_maxrss);
  JS_FreeContext(ctx); JS_FreeRuntime(rt); return 0;
}
