import CryptoKit
import Foundation
import Flutter
import JavaScriptCore

/// One engine and the serial queue it lives and dies on, which is never another engine's (#559).
private final class OwnedEngine {
  let vm: StateEngineVM
  let queue: DispatchQueue
  init(vm: StateEngineVM, queue: DispatchQueue) { self.vm = vm; self.queue = queue }
}

/// Each owned context lives and dies on a serial queue of its own, so a game's world can run in a
/// second engine beside the game, as the page runs it in a Web Worker, without either waiting on the
/// other. JSValue never crosses to Flutter.
final class StateEngineBridge: NSObject, FlutterPlugin {
  /// For what belongs to no engine: the storage root.
  private let control = DispatchQueue(label: "world.ai.state-engine")
  private let lock = NSLock()
  private var engines: [String: OwnedEngine] = [:]

  static func register(with registrar: FlutterPluginRegistrar) {
    let instance = StateEngineBridge()
    registrar.addMethodCallDelegate(instance, channel: FlutterMethodChannel(
      name: "world.ai/state-engine", binaryMessenger: registrar.messenger()))
  }

  private func owned(_ token: String?) -> OwnedEngine? {
    guard let token else { return nil }
    lock.lock(); defer { lock.unlock() }
    return engines[token]
  }

  /// Do this on that queue, and answer Flutter on the main one.
  private func on(_ queue: DispatchQueue, _ result: @escaping FlutterResult, _ work: @escaping () throws -> Any?) {
    queue.async {
      do {
        let response = try work()
        DispatchQueue.main.async { result(response) }
      } catch {
        let message = String(describing: error)
        DispatchQueue.main.async { result(FlutterError(code: "state-engine", message: message, details: nil)) }
      }
    }
  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let arguments = call.arguments as? [String: Any] ?? [:]
    switch call.method {
    case "storageRoot":
      on(control, result) {
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
          appropriateFor: nil, create: true).appendingPathComponent("ai-world", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root.path
      }
    case "create":
      // a new engine is made on its own new queue, and stays there
      let own = DispatchQueue(label: "world.ai.state-engine.\(UUID().uuidString)")
      on(own, result) {
        self.lock.lock(); let count = self.engines.count; self.lock.unlock()
        guard count < 4,
              let session = arguments["session"] as? String, !session.isEmpty, session.count <= 256,
              let bytes = arguments["source"] as? FlutterStandardTypedData,
              bytes.data.count <= 32 * 1024 * 1024,
              let digest = arguments["bundleSha256"] as? String,
              SHA256.hash(data: bytes.data).map({ String(format: "%02x", $0) }).joined() == digest,
              let source = String(data: bytes.data, encoding: .utf8) else {
          throw StateEngineFailure("Invalid or corrupted bundled engine")
        }
        // the hero engine is handed a saved hero; the game engine its options
        let entry = arguments["entry"] as? String ?? "AiWorldStateEngine"
        guard let replyLimit = StateEngineVM.replyLimits[entry] else { throw StateEngineFailure("Unknown bundled engine \(entry)") }
        let options = arguments["options"] as? String ?? arguments["savedHero"] as? String
        guard options == nil || options!.utf8.count <= 8 * 1024 * 1024 else {
          throw StateEngineFailure("Engine options too large")
        }
        let engine = try StateEngineVM(source: source, session: session, savedHero: options, entry: entry, replyLimit: replyLimit)
        let token = UUID().uuidString
        self.lock.lock(); self.engines[token] = OwnedEngine(vm: engine, queue: own); self.lock.unlock()
        return token
      }
    case "request":
      guard let owned = owned(arguments["token"] as? String) else {
        result(FlutterError(code: "state-engine", message: "Engine retired", details: nil))
        return
      }
      on(owned.queue, result) {
        // a parcel of ground from a world engine can be large; the contract bounds it at 8 MiB
        guard let request = arguments["request"] as? String, request.utf8.count <= 16 * 1024 * 1024 else {
          throw StateEngineFailure("Request too large")
        }
        return try owned.vm.request(request)
      }
    case "dispose":
      let token = arguments["token"] as? String
      lock.lock()
      let gone = token.flatMap { engines.removeValue(forKey: $0) }
      lock.unlock()
      guard let gone else { result(nil); return }
      // released on its own queue, where it lived
      on(gone.queue, result) { _ = gone; return nil }
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  func detachFromEngine(for registrar: FlutterPluginRegistrar) {
    lock.lock()
    let all = engines.values
    engines.removeAll()
    lock.unlock()
    for owned in all { owned.queue.async { _ = owned } }
  }
}

struct StateEngineFailure: Error, CustomStringConvertible {
  let description: String
  init(_ message: String) { description = message }
}

final class StateEngineVM {
  /// How big a reply each bundled engine may give: the whole game answers with the ground it streams.
  static let replyLimits: [String: Int] = ["AiWorldStateEngine": 1024 * 1024, "AiWorldGameEngine": 32 * 1024 * 1024]
  private let context: JSContext
  private let engine: JSValue
  private let replyLimit: Int

  init(source: String, session: String, savedHero: String? = nil, entry: String = "AiWorldStateEngine",
       replyLimit: Int = 1024 * 1024) throws {
    self.replyLimit = replyLimit
    guard let context = JSContext(virtualMachine: JSVirtualMachine()) else { throw StateEngineFailure("Cannot create VM") }
    self.context = context
    // Separate VMs provide separate globals; a retired session cannot mutate its successor.
    let uuid: @convention(block) () -> String = { UUID().uuidString.lowercased() }
    context.setObject(uuid, forKeyedSubscript: "__nativeUuid" as NSString)
    context.evaluateScript("globalThis.crypto = { randomUUID: () => __nativeUuid() };")
    context.evaluateScript(source, withSourceURL: URL(string: "ai-world-bundle://engine.js"))
    if let error = context.exception { throw StateEngineFailure(error.toString() ?? "Bundle exception") }
    guard let module = context.objectForKeyedSubscript(entry),
          let engine = module.invokeMethod("create", withArguments: [session, savedHero as Any? ?? NSNull()]), !engine.isUndefined else {
      throw StateEngineFailure(context.exception?.toString() ?? "Missing bundled engine entry")
    }
    if let error = context.exception { throw StateEngineFailure(error.toString() ?? "Engine initialization exception") }
    self.engine = engine
  }

  func request(_ text: String) throws -> String {
    context.exception = nil
    guard let value = engine.invokeMethod("request", withArguments: [text]),
          context.exception == nil, let response = value.toString(), response.utf8.count <= replyLimit else {
      throw StateEngineFailure(context.exception?.toString() ?? "Invalid engine response")
    }
    return response
  }
}
