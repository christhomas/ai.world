# Native texture ownership during viewport changes

`NativeWorldView` now owns one asynchronous create/resize sequence. A layout or
device pixel ratio change records the latest physical target; it cannot start a
second native renderer while creation is pending. After creation or resize
completes, the owner applies the latest target and skips intermediate layouts.
Physical dimensions are acknowledged only after a successful native call.

Leaving the view retires that owner. A create result arriving afterward is
disposed without mounting a texture or calling `onCreated`. Leaving during the
initialization callback disposes the owned texture and prevents later queued
resizes. Native failures are reported through Flutter's error handler; a later
viewport change can retry sizing without an automatic error loop.

`native_world_view_test.dart` exercises the production widget and method channel
with delayed native replies. It covers creation overlap, resize overlap,
coalescing, exit during creation and initialization, pixel ratio changes, and
failed creation/resize bookkeeping. GitHub runs these regressions, the complete
Flutter suite, and the hosted GLES/Metal renderer replay workflows.

This is partial lifecycle work for #579 and the renderer host used by #563.
Method-channel tests and renderer replay do not prove a complete installed game,
offline simulation, save/terminate/continue, physical-device behavior, or signing.
