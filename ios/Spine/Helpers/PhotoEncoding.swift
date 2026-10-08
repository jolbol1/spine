import ImageIO
import UIKit

/// Photos prepared for the server: shelf photos scaled to the model's full
/// resolution and compressed under the upload budget, and front covers
/// squared off to the printed insert's proportions (src/lib/covers.ts).
/// The `@concurrent` entry points do the pixel work off the main actor.
nonisolated enum PhotoEncoding {
  // MARK: Shelf photos

  /// Claude reads images at up to 2576 px on the long edge; more is wasted.
  static let shelfPhotoMaxPixels: CGFloat = 2576
  /// Keep each upload's base64 around 1.5 MB.
  static let shelfPhotoMaxBase64 = 1_500_000

  /// A shelf photo ready to send: base64 JPEG and a small thumbnail.
  struct ShelfPhoto: Sendable {
    let base64: String
    let mediaType = "image/jpeg"
    let thumbnail: UIImage
  }

  /// A picked photo's raw bytes (HEIC, JPEG, …) as a shelf photo.
  @concurrent
  static func shelfPhoto(from data: Data) async -> ShelfPhoto? {
    guard let image = downsample(data, maxPixelSize: shelfPhotoMaxPixels) else { return nil }
    return shelfPhoto(image)
  }

  /// A camera capture as a shelf photo.
  @concurrent
  static func shelfPhoto(from image: UIImage) async -> ShelfPhoto? {
    shelfPhoto(scaled(image, maxPixelSize: shelfPhotoMaxPixels))
  }

  private static func shelfPhoto(_ image: UIImage) -> ShelfPhoto? {
    guard let base64 = jpegBase64(image, maxBase64Length: shelfPhotoMaxBase64) else { return nil }
    return ShelfPhoto(base64: base64, thumbnail: scaled(image, maxPixelSize: 320))
  }

  // MARK: Covers

  /// The pixel size a scanned cover is saved at: 1200 px tall, as wide as
  /// the format's front insert — DVD 129.5 × 183 mm (849 × 1200), Blu-ray
  /// and 4K UHD 131.5 × 150 mm (1052 × 1200).
  static func coverPixelSize(for format: String) -> CGSize {
    let aspect: CGFloat = format == "DVD" ? 129.5 / 183 : 131.5 / 150
    return CGSize(width: (1200 * aspect).rounded(), height: 1200)
  }

  /// A cover at exactly the format's pixel size. A document-camera scan is
  /// already flattened to the cover's edges, so it's stretched to square
  /// off the proportions; an ordinary photo is centre-cropped instead.
  @concurrent
  static func cover(from image: UIImage, format: String, cropping: Bool) async -> UIImage {
    let size = coverPixelSize(for: format)
    let source = CGRect(origin: .zero, size: image.size)
    let crop = cropping ? centredRect(in: source, aspect: size.width / size.height) : source
    return draw(image, cropping: crop, into: size)
  }

  /// A picked photo's raw bytes as a cover, centre-cropped.
  @concurrent
  static func cover(from data: Data, format: String) async -> UIImage? {
    guard let image = downsample(data, maxPixelSize: 2400) else { return nil }
    return await cover(from: image, format: format, cropping: true)
  }

  /// The JPEG to upload for a cover, base64.
  @concurrent
  static func coverUpload(_ cover: UIImage) async -> String? {
    cover.jpegData(compressionQuality: 0.85)?.base64EncodedString()
  }

  // MARK: Pixels

  /// Decode at most `maxPixelSize` on the long edge, upright, without
  /// holding the full-size bitmap.
  static func downsample(_ data: Data, maxPixelSize: CGFloat) -> UIImage? {
    let options = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let source = CGImageSourceCreateWithData(data as CFData, options) else { return nil }
    let thumbnail =
      [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceShouldCacheImmediately: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
      ] as CFDictionary
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnail) else { return nil }
    return UIImage(cgImage: image)
  }

  /// `image` scaled down so its long edge is at most `maxPixelSize`.
  static func scaled(_ image: UIImage, maxPixelSize: CGFloat) -> UIImage {
    let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
    let factor = min(1, maxPixelSize / max(pixels.width, pixels.height))
    guard factor < 1 || image.scale != 1 || image.imageOrientation != .up else { return image }
    let size = CGSize(
      width: (pixels.width * factor).rounded(), height: (pixels.height * factor).rounded())
    return draw(image, cropping: CGRect(origin: .zero, size: image.size), into: size)
  }

  /// The largest rect with `aspect` (width ÷ height) centred in `rect`.
  static func centredRect(in rect: CGRect, aspect: CGFloat) -> CGRect {
    if rect.width / rect.height > aspect {
      let width = rect.height * aspect
      return CGRect(x: rect.midX - width / 2, y: rect.minY, width: width, height: rect.height)
    } else {
      let height = rect.width / aspect
      return CGRect(x: rect.minX, y: rect.midY - height / 2, width: rect.width, height: height)
    }
  }

  /// The `crop` part of `image` (in points, upright) drawn to fill exactly
  /// `size` pixels — orientation applied, opaque, scale 1.
  private static func draw(_ image: UIImage, cropping crop: CGRect, into size: CGSize) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let sx = size.width / crop.width
    let sy = size.height / crop.height
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(
        in: CGRect(
          x: -crop.minX * sx, y: -crop.minY * sy,
          width: image.size.width * sx, height: image.size.height * sy))
    }
  }

  /// JPEG at the best quality whose base64 fits `maxBase64Length`, scaling
  /// down when even low quality doesn't.
  static func jpegBase64(_ image: UIImage, maxBase64Length: Int) -> String? {
    var image = image
    for _ in 0..<4 {
      for quality in stride(from: 0.8, through: 0.35, by: -0.15) {
        guard let data = image.jpegData(compressionQuality: quality) else { return nil }
        // Base64 is 4 characters per 3 bytes.
        if (data.count + 2) / 3 * 4 <= maxBase64Length { return data.base64EncodedString() }
      }
      image = scaled(image, maxPixelSize: max(image.size.width, image.size.height) * image.scale * 0.75)
    }
    return nil
  }
}
