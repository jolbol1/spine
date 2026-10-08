import ImageIO
import SwiftUI
import UIKit

/// Covers and headshots, downsampled on a background thread and kept in
/// memory so a scrolling grid of hundreds of posters stays smooth. Raw
/// responses also sit in a disk cache, so a relaunch doesn't refetch them.
final class ImageCache {
  static let shared = ImageCache()

  private let memory = NSCache<NSString, UIImage>()
  private var inFlight: [String: Task<UIImage?, Never>] = [:]

  private nonisolated static let session: URLSession = {
    let config = URLSessionConfiguration.default
    config.urlCache = URLCache(
      memoryCapacity: 16 * 1024 * 1024, diskCapacity: 512 * 1024 * 1024,
      directory: URL.cachesDirectory.appending(path: "images"))
    config.requestCachePolicy = .returnCacheDataElseLoad
    config.httpAdditionalHeaders = [
      // Some cover hosts refuse requests that don't look like a browser.
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
    ]
    return URLSession(configuration: config)
  }()

  private init() {
    memory.totalCostLimit = 96 * 1024 * 1024
  }

  /// The image at `url`, at most `maxPixelSize` on its long edge.
  func image(for url: URL, maxPixelSize: CGFloat) async -> UIImage? {
    let key = "\(url.absoluteString)@\(Int(maxPixelSize))"
    if let cached = memory.object(forKey: key as NSString) { return cached }
    if let pending = inFlight[key] { return await pending.value }

    let task = Task<UIImage?, Never> {
      guard let (data, response) = try? await Self.session.data(from: url),
        (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true
      else { return nil }
      return await Self.downsample(data, maxPixelSize: maxPixelSize)
    }
    inFlight[key] = task
    let image = await task.value
    inFlight[key] = nil
    if let image {
      memory.setObject(image, forKey: key as NSString, cost: image.cost)
    }
    return image
  }

  @concurrent
  private nonisolated static func downsample(_ data: Data, maxPixelSize: CGFloat) async -> UIImage? {
    let options = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let source = CGImageSourceCreateWithData(data as CFData, options) else { return nil }
    let thumbnailOptions =
      [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceShouldCacheImmediately: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
      ] as CFDictionary
    guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions)
    else { return nil }
    return UIImage(cgImage: cgImage)
  }
}

private extension UIImage {
  var cost: Int {
    guard let cgImage else { return 1 }
    return cgImage.bytesPerRow * cgImage.height
  }
}

/// A remote image that fills its frame, with a placeholder while loading or
/// when the URL is missing or broken.
struct RemoteImage<Placeholder: View>: View {
  let url: URL?
  /// Long-edge pixel budget for the decoded image.
  var maxPixelSize: CGFloat = 600
  var contentMode: ContentMode = .fill
  @ViewBuilder var placeholder: () -> Placeholder

  @State private var image: UIImage?
  @State private var loadedURL: URL?

  var body: some View {
    ZStack {
      if let image, loadedURL == url {
        Image(uiImage: image)
          .resizable()
          .aspectRatio(contentMode: contentMode)
          .transition(.opacity)
      } else {
        placeholder()
      }
    }
    .task(id: url) {
      guard let url else {
        image = nil
        return
      }
      let loaded = await ImageCache.shared.image(for: url, maxPixelSize: maxPixelSize)
      withAnimation(.easeOut(duration: 0.2)) {
        image = loaded
        loadedURL = url
      }
    }
  }
}

extension RemoteImage where Placeholder == Color {
  init(url: URL?, maxPixelSize: CGFloat = 600, contentMode: ContentMode = .fill) {
    self.init(url: url, maxPixelSize: maxPixelSize, contentMode: contentMode) {
      Color.spineSecondary
    }
  }
}
