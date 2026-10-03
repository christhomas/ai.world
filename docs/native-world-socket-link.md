# Native shared-world transport

Refs #565. Stacked on #588's host contract. This adapter carries the existing
`src/net/link.ts` text-or-binary parcels through `dart:io` WebSocket. It does not
consume scene-feed JSON, decode gzip, create player identities, negotiate a new
protocol or implement game authority. The shared Online engine still sends the
version-25 join, retains returning identity, selects the named world, validates
JSON/chunks and reconciles server answers.

## Runtime host API

Import `package:ai_world_flutter/src/network/world_socket_link.dart` and create
`NativeWorldSocketLink` with `WorldSocketConfig` and these callbacks:

- `onOpen()` tells the shared engine the link can send its original join.
- `onMessage(Object)` delivers either the original String or an owned Uint8List in
  socket order. The host converts the latter to the runtime's ArrayBuffer port.
- `onClose(String)` supplies a player-facing transport reason to Online.
- `onStatus(WorldTransportStatus)` exposes connecting, ready, retrying and offline
  transport states, with the next retry delay where applicable.

`start()` begins a session, `ready` reports socket readiness, `send(Object)` accepts
String/Uint8List only, and `close()` fences old callbacks immediately and disables
reconnect. `generation` identifies the transport lifetime. Send returns a Future
that reports acceptance by the socket sink, not server acknowledgement; the host
must observe errors and must not retry an economic action automatically.

Production endpoints are configurable WSS URIs. Cleartext WS is permitted only
with `allowInsecureDevelopment: true` for loopback, private IP ranges or `.local`
LAN hosts. URI userinfo is rejected. No portal/operator secrets or login flow are
part of this adapter.

`automaticReconnect` defaults false because shared Online already owns intent,
the six-second quiet-world check and reconnect. When a runtime host deliberately
uses native reconnect instead, the adapter backs off from one second to thirty,
times out each handshake after six seconds and rejects all unsent parcels when a
session ends. `admitted()` resets backoff only when the engine accepts its join;
an open TCP socket alone does not reset a flapping connection. WebSocket ping/pong
also detects transport silence. Never enable both retry owners.

Outgoing application buffering is bounded by parcel count and byte count. Writes
to an unready link, oversized parcels and a full queue fail rather than waiting
for another session. Incoming parcels have a configurable byte limit and otherwise
remain uninterpreted, including malformed JSON and truncated ground buffers, so
the shared engine remains the protocol validator. Late handshakes and callbacks
from abandoned sessions close or disappear before reaching the engine.

## Verification and remaining acceptance

Six Flutter tests use real Dart HttpServer/WebSocket loopback sockets for ordered
text/binary parcel preservation, handshake rejection/backoff, dropped connections,
manual leave, stale delayed handshake fencing and bounded outgoing buffering.
The binary case supplies a version-2 chunk with nonzero height, proves decoding
before transmission, compares every received byte and decodes the received chunk.
Malformed text and truncated binary are deliberately preserved for downstream
validation. These servers are transport fixtures, not the AI World server.

No local test, build, playtest, formatter, dependency installation or emulator was
run. `flutter test test/world_socket_link_test.dart` and the full Flutter suite must
run on GitHub through the companion #587 hosted-workflow change.

Still pending: embedding the shared Online runtime, production WSS integration
with the actual server and a web player, stable returning-player rejoin, named-world
invites/refusals/version mismatch, actual game actions and authoritative replies,
silent-world gameplay handling, and installed-player Android/iPhone captures. No
crossplay, real-server gameplay or installed acceptance is claimed; #565 stays open.
