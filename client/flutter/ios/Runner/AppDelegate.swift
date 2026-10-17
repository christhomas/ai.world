import AVFoundation
import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "StateEngineBridge") {
      StateEngineBridge.register(with: registrar)
    }
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "WorldRendererBridge") {
      WorldRendererBridge.register(with: registrar)
    }
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "SoundBridge") {
      SoundBridge.register(with: registrar)
    }
  }
}

/// The game's sounds (#578). Dart makes each one, as 16-bit mono samples, from what the game says it
/// is made of; this plays it on a player node of its own, in an ambient session so it mixes with
/// whatever else is playing and keeps quiet for the silent switch, and lets the node go once it has
/// played. A sound that cannot be played is dropped.
final class SoundBridge: NSObject, FlutterPlugin {
  private let engine = AVAudioEngine()
  private var ready = false

  static func register(with registrar: FlutterPluginRegistrar) {
    let instance = SoundBridge()
    registrar.addMethodCallDelegate(instance, channel: FlutterMethodChannel(
      name: "world.ai/sound", binaryMessenger: registrar.messenger()))
  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard call.method == "play" else { result(FlutterMethodNotImplemented); return }
    guard let args = call.arguments as? [String: Any],
          let pcm = args["pcm"] as? FlutterStandardTypedData,
          let rate = args["rate"] as? Int, pcm.data.count >= 2, (8000...96000).contains(rate) else {
      result(FlutterError(code: "bad-sound", message: "A sound needs 16-bit samples and a rate", details: nil))
      return
    }
    do {
      try play(pcm.data, rate: Double(rate))
      result(nil)
    } catch {
      result(FlutterError(code: "sound-failed", message: "\(error)", details: nil))
    }
  }

  private func play(_ pcm: Data, rate: Double) throws {
    guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false) else { return }
    let frames = AVAudioFrameCount(pcm.count / 2)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
          let out = buffer.floatChannelData?[0] else { return }
    buffer.frameLength = frames
    pcm.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      for i in 0..<Int(frames) {
        let sample = Int16(bitPattern: UInt16(raw[2 * i]) | UInt16(raw[2 * i + 1]) << 8)
        out[i] = Float(sample) / 32768
      }
    }
    if !ready {
      try AVAudioSession.sharedInstance().setCategory(.ambient)
      try AVAudioSession.sharedInstance().setActive(true)
      ready = true
    }
    let player = AVAudioPlayerNode()
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: format)
    if !engine.isRunning { try engine.start() }
    player.scheduleBuffer(buffer) { [weak self] in
      DispatchQueue.main.async { self?.engine.detach(player) }
    }
    player.play()
  }
}
