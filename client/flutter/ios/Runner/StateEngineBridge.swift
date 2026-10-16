import CryptoKit
import Foundation
import Flutter
import JavaScriptCore

/// Each owned context lives and dies on this serial queue. JSValue never crosses to Flutter.
final class StateEngineBridge: NSObject, FlutterPlugin {
  private let queue = DispatchQueue(label: "world.ai.state-engine")
  private var engines: [String: StateEngineVM] = [:]

  static func register(with registrar: FlutterPluginRegistrar) {
    let instance = StateEngineBridge()
    registrar.addMethodCallDelegate(instance, channel: FlutterMethodChannel(
      name: "world.ai/state-engine", binaryMessenger: registrar.messenger()))
  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let arguments = call.arguments as? [String: Any] ?? [:]
    queue.async {
      do {
        let response: Any?
        switch call.method {
        case "storageRoot":
          let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true).appendingPathComponent("ai-world", isDirectory: true)
          try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
          response = root.path
        case "create":
          guard self.engines.count < 4,
                let session = arguments["session"] as? String, !session.isEmpty, session.count <= 256,
                let bytes = arguments["source"] as? FlutterStandardTypedData,
                bytes.data.count <= 8 * 1024 * 1024,
                let digest = arguments["bundleSha256"] as? String,
                SHA256.hash(data: bytes.data).map({ String(format: "%02x", $0) }).joined() == digest,
                let source = String(data: bytes.data, encoding: .utf8) else {
            throw StateEngineFailure("Invalid or corrupted bundled engine")
          }
          let savedHero = arguments["savedHero"] as? String
          guard savedHero == nil || savedHero!.utf8.count <= 1024 * 1024 else {
            throw StateEngineFailure("Saved hero too large")
          }
          let engine = try StateEngineVM(source: source, session: session, savedHero: savedHero)
          let token = UUID().uuidString
          self.engines[token] = engine
          response = token
        case "request":
          guard let token = arguments["token"] as? String, let engine = self.engines[token],
                let request = arguments["request"] as? String, request.utf8.count <= 1024 * 1024 else {
            throw StateEngineFailure("Engine retired or request too large")
          }
          response = try engine.request(request)
        case "dispose":
          guard let token = arguments["token"] as? String else { throw StateEngineFailure("Missing engine token") }
          // Removing on the owner queue releases the context and all its functions on that queue.
          self.engines.removeValue(forKey: token)
          response = nil
        default:
          DispatchQueue.main.async { result(FlutterMethodNotImplemented) }
          return
        }
        DispatchQueue.main.async { result(response) }
      } catch {
        let message = String(describing: error)
        DispatchQueue.main.async { result(FlutterError(code: "state-engine", message: message, details: nil)) }
      }
    }
  }

  func detachFromEngine(for registrar: FlutterPluginRegistrar) {
    queue.async { self.engines.removeAll() }
  }
}

struct StateEngineFailure: Error, CustomStringConvertible {
  let description: String
  init(_ message: String) { description = message }
}

final class StateEngineVM {
  private let context: JSContext
  private let engine: JSValue

  init(source: String, session: String, savedHero: String? = nil) throws {
    guard let context = JSContext(virtualMachine: JSVirtualMachine()) else { throw StateEngineFailure("Cannot create VM") }
    self.context = context
    // Separate VMs provide separate globals; a retired session cannot mutate its successor.
    let uuid: @convention(block) () -> String = { UUID().uuidString.lowercased() }
    context.setObject(uuid, forKeyedSubscript: "__nativeUuid" as NSString)
    context.evaluateScript("globalThis.crypto = { randomUUID: () => __nativeUuid() };")
    context.evaluateScript(source, withSourceURL: URL(string: "ai-world-bundle://engine.js"))
    if let error = context.exception { throw StateEngineFailure(error.toString() ?? "Bundle exception") }
    guard let module = context.objectForKeyedSubscript("AiWorldStateEngine"),
          let engine = module.invokeMethod("create", withArguments: [session, savedHero as Any? ?? NSNull()]), !engine.isUndefined else {
      throw StateEngineFailure(context.exception?.toString() ?? "Missing bundled engine entry")
    }
    if let error = context.exception { throw StateEngineFailure(error.toString() ?? "Engine initialization exception") }
    self.engine = engine
  }

  func request(_ text: String) throws -> String {
    context.exception = nil
    guard let value = engine.invokeMethod("request", withArguments: [text]),
          context.exception == nil, let response = value.toString(), response.utf8.count <= 1024 * 1024 else {
      throw StateEngineFailure(context.exception?.toString() ?? "Invalid engine response")
    }
    return response
  }
}
