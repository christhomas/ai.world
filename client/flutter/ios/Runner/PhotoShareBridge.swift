import Flutter
import UIKit

/// Dart supplies the native renderer's frame as a PNG; UIKit owns where the player sends it.
final class PhotoShareBridge: NSObject, FlutterPlugin {
  private let presenting: () -> UIViewController?
  private var active: PhotoShare?

  init(presenting: @escaping () -> UIViewController?) {
    self.presenting = presenting
    super.init()
  }

  static func register(with registrar: FlutterPluginRegistrar) {
    let instance = PhotoShareBridge(presenting: { registrar.viewController })
    registrar.addMethodCallDelegate(instance, channel: FlutterMethodChannel(
      name: "world.ai/photo", binaryMessenger: registrar.messenger()))
  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard call.method == "share" else { result(FlutterMethodNotImplemented); return }
    guard active == nil else {
      result(FlutterError(code: "share-busy", message: "A photo is already being shared", details: nil))
      return
    }
    guard let args = call.arguments as? [String: Any], let png = args["png"] as? FlutterStandardTypedData else {
      result(FlutterError(code: "bad-photo", message: "A photo needs PNG bytes", details: nil))
      return
    }
    guard let presenter = presenting(), let window = presenter.viewIfLoaded?.window,
          window.windowScene?.activationState == .foregroundActive,
          presenter.presentedViewController == nil else {
      result(FlutterError(code: "share-unavailable", message: "The game is not ready to share a photo", details: nil))
      return
    }
    do {
      let share = try PhotoShare(png: png.data, directory: FileManager.default.temporaryDirectory
        .appendingPathComponent("shared-photos", isDirectory: true), presenter: presenter) { [weak self] outcome in
        self?.active = nil
        result(outcome)
      }
      active = share
      presenter.present(share.controller, animated: true)
    } catch {
      result(FlutterError(code: "share-failed", message: "\(error)", details: nil))
    }
  }
}

/// Keeps the file through the share, then lets it go on success, cancellation or an extension error.
final class PhotoShare {
  let controller: UIActivityViewController
  let file: URL
  private var completion: FlutterResult?

  init(png: Data, directory: URL, presenter: UIViewController, completion: @escaping FlutterResult) throws {
    guard png.starts(with: [137, 80, 78, 71, 13, 10, 26, 10]) else {
      throw NSError(domain: "world.ai/photo", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "A photo needs PNG bytes"])
    }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = directory.appendingPathComponent("ai-world-\(UUID().uuidString).png")
    try png.write(to: url, options: .atomic)
    file = url
    self.completion = completion
    controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
    // The app shares a file and never asks for access to the photo library.
    controller.excludedActivityTypes = [.saveToCameraRoll]
    if let popover = controller.popoverPresentationController {
      popover.sourceView = presenter.view
      popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 1, width: 1, height: 1)
      popover.permittedArrowDirections = []
    }
    controller.completionWithItemsHandler = { [weak self] _, completed, _, error in
      self?.finish(completed: completed, error: error)
    }
  }

  private func finish(completed: Bool, error: Error?) {
    guard let reply = completion else { return }
    completion = nil
    try? FileManager.default.removeItem(at: file)
    if let error = error {
      reply(FlutterError(code: "share-failed", message: "\(error)", details: nil))
    } else {
      reply(completed ? "shared" : "cancelled")
    }
  }
}
