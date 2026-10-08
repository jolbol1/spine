import Foundation
import Observation
import PhotosUI
import SwiftUI
import UIKit

/// The shelf check's photos and their readings. Photos are read one at a
/// time, in the order they were added — each takes the server 20–90 s —
/// and a photo that fails keeps its error without holding up the rest.
@Observable
final class ShelfCheckModel {
  struct Photo: Identifiable {
    enum Phase: Equatable {
      case waiting
      case reading(since: Date)
      case read
      case failed(String)
    }

    let id = UUID()
    let upload: PhotoEncoding.ShelfPhoto
    var phase: Phase = .waiting
    var spines: [ShelfSpine] = []
  }

  /// How the last reading went, for the haptic.
  struct Finish: Equatable {
    var count: Int
    var succeeded: Bool
  }

  /// How the photographed discs sit, so the server reads them in the
  /// shelf's direction; nil reads them as they come.
  var arrangement: ShelfOrientation?
  private(set) var photos: [Photo] = []
  /// Photos still being decoded and compressed.
  private(set) var preparing = 0
  private(set) var lastFinish = Finish(count: 0, succeeded: true)
  private var reader: Task<Void, Never>?

  isolated deinit {
    reader?.cancel()
  }

  /// Every disc read so far, each once.
  var entries: [ShelfCheckResults.Entry] {
    ShelfCheckResults.merge(photos.map(\.spines))
  }

  /// Every spine read, photo by photo in reading order, for the shelf
  /// order check — an uncatalogued spine the previous photo already showed
  /// dropped (the check itself drops repeated catalogued discs).
  var readSpines: [ShelfSpine] {
    ShelfCheckResults.joinPhotos(photos.filter { $0.phase == .read }.map(\.spines))
  }

  /// The photo being read: its position, and since when.
  var reading: (number: Int, since: Date)? {
    for (index, photo) in photos.enumerated() {
      if case .reading(let since) = photo.phase { return (index + 1, since) }
    }
    return nil
  }

  var isEmpty: Bool { photos.isEmpty && preparing == 0 }
  /// Nothing left to read or prepare.
  var isIdle: Bool { reader == nil && preparing == 0 }

  // MARK: Adding photos

  /// Photos picked from the library, in the order picked.
  func add(_ items: [PhotosPickerItem], api: APIClient, toasts: Toasts) {
    preparing += items.count
    Task {
      var unreadable = 0
      for item in items {
        let data = try? await item.loadTransferable(type: Data.self)
        if let data, let photo = await PhotoEncoding.shelfPhoto(from: data) {
          append(photo, api: api)
        } else {
          unreadable += 1
        }
        preparing -= 1
      }
      if unreadable > 0 {
        toasts.error(
          unreadable == 1 ? "Couldn’t open one of those photos" : "Couldn’t open \(unreadable) of those photos")
      }
    }
  }

  /// A photo just taken with the camera.
  func add(_ image: UIImage, api: APIClient, toasts: Toasts) {
    preparing += 1
    Task {
      if let photo = await PhotoEncoding.shelfPhoto(from: image) {
        append(photo, api: api)
      } else {
        toasts.error("Couldn’t use that photo")
      }
      preparing -= 1
    }
  }

  private func append(_ upload: PhotoEncoding.ShelfPhoto, api: APIClient) {
    photos.append(Photo(upload: upload))
    readQueue(api: api)
  }

  // MARK: Managing photos

  func retry(_ id: Photo.ID, api: APIClient) {
    guard let index = photos.firstIndex(where: { $0.id == id }) else { return }
    photos[index].phase = .waiting
    readQueue(api: api)
  }

  func remove(_ id: Photo.ID, api: APIClient) {
    guard let index = photos.firstIndex(where: { $0.id == id }) else { return }
    if case .reading = photos[index].phase {
      // Stop reading it; the queue moves on to the next.
      reader?.cancel()
      reader = nil
    }
    photos.remove(at: index)
    readQueue(api: api)
  }

  func removeAll() {
    reader?.cancel()
    reader = nil
    photos = []
  }

  // MARK: Reading

  /// Read waiting photos one at a time until none are left.
  private func readQueue(api: APIClient) {
    guard reader == nil else { return }
    reader = Task { [weak self] in
      while let next = self?.beginNext() {
        let result = await ShelfCheckModel.read(next.upload, arrangement: next.arrangement, api: api)
        // Removed or started over meanwhile: this run is finished.
        if Task.isCancelled { return }
        self?.finish(next.id, result)
      }
      self?.reader = nil
    }
  }

  private func beginNext() -> (
    id: Photo.ID, upload: PhotoEncoding.ShelfPhoto, arrangement: ShelfOrientation?
  )? {
    guard let index = photos.firstIndex(where: { $0.phase == .waiting }) else { return nil }
    photos[index].phase = .reading(since: .now)
    return (photos[index].id, photos[index].upload, arrangement)
  }

  private func finish(_ id: Photo.ID, _ result: Result<[ShelfSpine], ReadFailure>) {
    guard let index = photos.firstIndex(where: { $0.id == id }) else { return }
    switch result {
    case .success(let spines):
      photos[index].spines = spines
      photos[index].phase = .read
    case .failure(let failure):
      photos[index].spines = []
      photos[index].phase = .failed(failure.message)
    }
    lastFinish = Finish(count: lastFinish.count + 1, succeeded: (try? result.get()) != nil)
  }

  struct ReadFailure: Error {
    let message: String
  }

  private nonisolated static func read(
    _ upload: PhotoEncoding.ShelfPhoto, arrangement: ShelfOrientation?, api: APIClient
  ) async -> Result<[ShelfSpine], ReadFailure> {
    do {
      let reading = try await api.scanShelfPhoto(
        image: upload.base64, mediaType: upload.mediaType, arrangement: arrangement
      ).get()
      return .success(reading.spines)
    } catch {
      return .failure(ReadFailure(message: error.userMessage))
    }
  }
}
