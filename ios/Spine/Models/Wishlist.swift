import Foundation

/// A `wishlist_items` row (src/db/schema.ts).
nonisolated struct WishlistItem: Codable, Identifiable, Hashable, Sendable {
  let id: String
  var title: String
  var director: String?
  var year: Int?
  var format: String?
  var url: String?
  var retailer: String?
  /// Free text as scraped, e.g. "£19.99".
  var price: String?
  var coverUrl: String?
  var notes: String?
  var createdAt: Date
}

/// Input for `createWishlistItem` (`wishlistInput` in src/server/wishlist.ts).
nonisolated struct WishlistInput: Encodable, Sendable {
  var title: String
  var director: String?
  var year: Int?
  /// "4K UHD" | "Blu-ray" | "DVD", or nil.
  var format: String?
  var url: String?
  var retailer: String?
  var price: String?
  var coverUrl: String?
  var notes: String?
}

/// What the retailer scraper pulled off a product page.
nonisolated struct ScrapedProduct: Decodable, Hashable, Sendable {
  var title: String
  var price: String?
  var retailer: String
  var imageUrl: String?
  var url: String
}

/// `scrapeWishlistUrl` result. A failure can still name the retailer, so the
/// manual-entry fallback can prefill it.
nonisolated enum ScrapeResult: Decodable, Sendable {
  case success(ScrapedProduct)
  case failure(error: String, retailer: String?)

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    if try c.decode(Bool.self, forKey: .success) {
      self = .success(try c.decode(ScrapedProduct.self, forKey: .data))
    } else {
      self = .failure(
        error: try c.decodeIfPresent(String.self, forKey: .error)
          ?? "Failed to scrape the page",
        retailer: try c.decodeIfPresent(String.self, forKey: .retailer)
      )
    }
  }

  private enum Keys: String, CodingKey { case success, data, error, retailer }
}
