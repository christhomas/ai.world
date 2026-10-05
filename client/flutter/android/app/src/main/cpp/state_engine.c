#include <jni.h>
#include <android/log.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>
#include "quickjs.h"

typedef struct { JSRuntime *runtime; JSContext *context; JSValue engine; double deadline; } Engine;
static double now_ms(void) {
  struct timespec value; clock_gettime(CLOCK_MONOTONIC, &value);
  return value.tv_sec * 1000.0 + value.tv_nsec / 1e6;
}
static int interrupt(JSRuntime *runtime, void *opaque) {
  (void)runtime; return now_ms() > ((Engine *)opaque)->deadline;
}
static JSValue uuid(JSContext *context, JSValueConst self, int argc, JSValueConst *args) {
  (void)self; (void)argc; (void)args;
  unsigned char bytes[16]; size_t done = 0;
  int file = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
  if (file < 0) return JS_ThrowInternalError(context, "Cannot open UUID entropy source");
  while (done < sizeof bytes) {
    ssize_t n = read(file, bytes + done, sizeof bytes - done);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) { close(file); return JS_ThrowInternalError(context, "Cannot read UUID entropy"); }
    done += (size_t)n;
  }
  close(file); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  char text[37];
  snprintf(text, sizeof text, "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]);
  return JS_NewStringLen(context, text, 36);
}
static char *copy_bytes(JNIEnv *env, jbyteArray value, size_t limit, size_t *length) {
  if (!value) return NULL;
  jsize size = (*env)->GetArrayLength(env, value);
  if (size < 0 || (size_t)size > limit) return NULL;
  char *text = malloc((size_t)size + 1); if (!text) return NULL;
  (*env)->GetByteArrayRegion(env, value, 0, size, (jbyte *)text);
  if ((*env)->ExceptionCheck(env)) { free(text); return NULL; }
  text[size] = 0; *length = (size_t)size; return text;
}
static void release(Engine *engine) {
  if (!engine) return;
  if (engine->context) { JS_FreeValue(engine->context, engine->engine); JS_FreeContext(engine->context); }
  if (engine->runtime) JS_FreeRuntime(engine->runtime);
  free(engine);
}
static jbyteArray reply(JNIEnv *env, int failed, const char *text, size_t length) {
  if (length > 1024 * 1024) { failed = 1; text = "Engine response too large"; length = strlen(text); }
  jbyteArray out = (*env)->NewByteArray(env, (jsize)length + 1);
  if (!out) return NULL;
  jbyte flag = failed ? 1 : 0;
  (*env)->SetByteArrayRegion(env, out, 0, 1, &flag);
  (*env)->SetByteArrayRegion(env, out, 1, (jsize)length, (const jbyte *)text);
  return out;
}
static jbyteArray exception_reply(JNIEnv *env, Engine *engine) {
  JSValue error = JS_GetException(engine->context); size_t length = 0;
  const char *text = JS_ToCStringLen(engine->context, &length, error);
  jbyteArray out = reply(env, 1, text ? text : "JavaScript exception", text ? length : 20);
  JS_FreeCString(engine->context, text); JS_FreeValue(engine->context, error); return out;
}

JNIEXPORT jlong JNICALL Java_world_ai_ai_1world_1flutter_NativeStateEngine_create(
  JNIEnv *env, jobject self, jbyteArray source, jbyteArray session) {
  (void)self;
  size_t source_length = 0, session_length = 0;
  char *code = copy_bytes(env, source, 8 * 1024 * 1024, &source_length);
  char *identity = copy_bytes(env, session, 1024, &session_length);
  Engine *engine = calloc(1, sizeof *engine);
  if (!code || !identity || !engine) goto failed;
  engine->engine = JS_UNDEFINED;
  engine->runtime = JS_NewRuntime(); if (!engine->runtime) goto failed;
  JS_SetMemoryLimit(engine->runtime, 64 * 1024 * 1024);
  JS_SetMaxStackSize(engine->runtime, 1024 * 1024);
  engine->deadline = now_ms() + 5000;
  JS_SetInterruptHandler(engine->runtime, interrupt, engine);
  engine->context = JS_NewContext(engine->runtime); if (!engine->context) goto failed;
  JSValue global = JS_GetGlobalObject(engine->context), crypto = JS_NewObject(engine->context);
  JS_SetPropertyStr(engine->context, crypto, "randomUUID", JS_NewCFunction(engine->context, uuid, "randomUUID", 0));
  JS_SetPropertyStr(engine->context, global, "crypto", crypto);
  JSValue evaluated = JS_Eval(engine->context, code, source_length, "ai-world-bundle://engine.js", JS_EVAL_TYPE_GLOBAL);
  int bad = JS_IsException(evaluated); JS_FreeValue(engine->context, evaluated);
  if (!bad) {
    JSValue module = JS_GetPropertyStr(engine->context, global, "AiWorldStateEngine");
    JSValue factory = JS_GetPropertyStr(engine->context, module, "create");
    JSValue argument = JS_NewStringLen(engine->context, identity, session_length);
    engine->engine = JS_Call(engine->context, factory, module, 1, &argument);
    JS_FreeValue(engine->context, argument); JS_FreeValue(engine->context, factory); JS_FreeValue(engine->context, module);
    bad = JS_IsException(engine->engine) || !JS_IsObject(engine->engine);
  }
  JS_FreeValue(engine->context, global);
  if (bad) goto failed;
  free(code); free(identity); return (jlong)(intptr_t)engine;
failed:
  if (engine && engine->context) {
    JSValue error = JS_GetException(engine->context); const char *message = JS_ToCString(engine->context, error);
    __android_log_print(ANDROID_LOG_ERROR, "AiWorldStateEngine", "%s", message ? message : "Engine initialization failed");
    JS_FreeCString(engine->context, message); JS_FreeValue(engine->context, error);
  }
  free(code); free(identity); release(engine); return 0;
}
JNIEXPORT jbyteArray JNICALL Java_world_ai_ai_1world_1flutter_NativeStateEngine_request(
  JNIEnv *env, jobject self, jlong handle, jbyteArray input) {
  (void)self;
  Engine *engine = (Engine *)(intptr_t)handle;
  if (!engine) return reply(env, 1, "Engine retired", 14);
  size_t length = 0; char *text = copy_bytes(env, input, 1024 * 1024, &length);
  if (!text) return reply(env, 1, "Invalid request bytes", 21);
  engine->deadline = now_ms() + 5000;
  JSValue function = JS_GetPropertyStr(engine->context, engine->engine, "request");
  JSValue argument = JS_NewStringLen(engine->context, text, length); free(text);
  JSValue value = JS_Call(engine->context, function, engine->engine, 1, &argument);
  JS_FreeValue(engine->context, function); JS_FreeValue(engine->context, argument);
  if (JS_IsException(value)) { JS_FreeValue(engine->context, value); return exception_reply(env, engine); }
  if (!JS_IsString(value)) { JS_FreeValue(engine->context, value); return reply(env, 1, "Invalid engine response", 23); }
  const char *result = JS_ToCStringLen(engine->context, &length, value);
  jbyteArray out = result ? reply(env, 0, result, length) : exception_reply(env, engine);
  JS_FreeCString(engine->context, result); JS_FreeValue(engine->context, value); return out;
}
JNIEXPORT void JNICALL Java_world_ai_ai_1world_1flutter_NativeStateEngine_dispose(
  JNIEnv *env, jobject self, jlong handle) {
  (void)env; (void)self; release((Engine *)(intptr_t)handle);
}
