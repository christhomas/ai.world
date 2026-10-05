# Host-supplied world transport

Refs #560, #563, #564, #565, #579.

`Online` now requires its world-link factory. It does not import browser socket or worker code at
runtime. `main.ts` supplies `browserWorldLink` through `MultiplayerContext`, preserving the existing
choice of private worker for an empty URL and socket for a shared world. `portable-online.ts` exports
the production protocol client, event types and transport contract for other hosts.

A factory hands back its owned `Link` before announcing open. Each connection attempt carries a
generation fence. Disconnect, replacement, connection loss and construction failure retire that
generation before closing its link, so late open, text, binary and close callbacks cannot alter the
next world. Null or throwing factories enter the same timed retry backoff as ordinary disconnects.
A factory that reports failure before returning its resource has that resource closed immediately.

Hosted regressions retain the existing reconnect/private-authority cases and add stale callback,
binary parcel, reentrant close, factory failure and real shared-authority save/rejoin cases. The
native runtime spike executes the production protocol client with a bounded wire transcript and
compares its ownership result across iOS JSC, iOS QuickJS and Android QuickJS. That transcript does
not prove a device network connection or installed gameplay.

The installed host still must connect its private authority and native WebSocket bridge to this
factory, supply the existing UUID host bridge, and compose protocol events with the game session's
world, presentation and save services. Flutter currently does not perform that composition. This
change does not complete crossplay, physical-device acceptance, signing or the full offline loop.
