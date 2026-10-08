import PhotosUI
import SwiftUI
import VisionKit

extension View {
  /// Photograph the disc's own front cover and store it on the server:
  /// VisionKit's document camera finds the cover's edges, captures it, and
  /// flattens the perspective; the scan is squared off to the format's
  /// printed proportions, previewed, then uploaded. `onCover` gets the
  /// stored cover's relative URL — if it throws, the error shows and the
  /// preview stays up.
  ///
  /// Where the document camera isn't supported (the simulator), a picked
  /// photo is centre-cropped to the proportions instead.
  func filmCoverScanner(
    isPresented: Binding<Bool>, format: String,
    onCover: @escaping (String) async throws -> Void
  ) -> some View {
    fullScreenCover(isPresented: isPresented) {
      FilmCoverScanFlow(format: format, onCover: onCover)
    }
  }
}

/// Capture, preview (Use cover / Rescan), upload.
private struct FilmCoverScanFlow: View {
  let format: String
  let onCover: (String) async throws -> Void

  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @Environment(\.dismiss) private var dismiss
  @State private var cover: UIImage?
  @State private var processing = false
  @State private var uploading = false
  @State private var pickedItem: PhotosPickerItem?

  private let usesScanner = VNDocumentCameraViewController.isSupported

  var body: some View {
    Group {
      if let cover {
        preview(cover)
      } else if usesScanner {
        FilmDocumentCamera(onScan: scanned, onCancel: { dismiss() }, onFailure: failed)
          .ignoresSafeArea()
          .overlay {
            if processing { ProgressView().controlSize(.large) }
          }
      } else {
        photoPicker
      }
    }
    .interactiveDismissDisabled(uploading)
  }

  // MARK: Capture

  private func scanned(_ image: UIImage) {
    processing = true
    Task {
      // Flattened to the cover's edges already: stretch to square it off.
      cover = await PhotoEncoding.cover(from: image, format: format, cropping: false)
      processing = false
    }
  }

  private func failed(_ error: Error) {
    toasts.error("The scanner stopped: \(error.localizedDescription)")
    dismiss()
  }

  /// The simulator's stand-in for the document camera.
  private var photoPicker: some View {
    NavigationStack {
      PhotosPicker(selection: $pickedItem, matching: .images, preferredItemEncoding: .current) {
        Text("Choose a photo")
      }
      .photosPickerStyle(.inline)
      .photosPickerDisabledCapabilities(.selectionActions)
      .photosPickerAccessoryVisibility(.hidden, edges: .bottom)
      .ignoresSafeArea(edges: .bottom)
      .safeAreaInset(edge: .top, spacing: 0) {
        Text(
          "This device can’t scan documents, so choose a photo of the front cover. It’s cropped to the \(format) case’s proportions."
        )
        .font(.footnote)
        .foregroundStyle(.spineMutedForeground)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
      }
      .overlay {
        if processing {
          ProgressView()
            .controlSize(.large)
            .padding(24)
            .glassEffect(.regular, in: .rect(cornerRadius: 18))
        }
      }
      .navigationTitle("Choose a cover photo")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
        }
      }
      .background(Color.spineBackground.ignoresSafeArea())
    }
    .onChange(of: pickedItem) { _, item in
      if let item { load(item) }
    }
  }

  private func load(_ item: PhotosPickerItem) {
    processing = true
    Task {
      defer {
        processing = false
        pickedItem = nil
      }
      guard let data = try? await item.loadTransferable(type: Data.self),
        let image = await PhotoEncoding.cover(from: data, format: format)
      else {
        toasts.error("Couldn’t open that photo")
        return
      }
      cover = image
    }
  }

  // MARK: Preview

  private func preview(_ cover: UIImage) -> some View {
    NavigationStack {
      VStack(spacing: 14) {
        Image(uiImage: cover)
          .resizable()
          .aspectRatio(contentMode: .fit)
          .clipShape(.rect(cornerRadius: 8))
          .overlay {
            RoundedRectangle(cornerRadius: 8).strokeBorder(.spineBorder, lineWidth: 1)
          }
          .shadow(color: .black.opacity(0.5), radius: 24, y: 12)
          .frame(maxWidth: 380)
          .accessibilityLabel("The scanned cover")
        Text(
          "\(format) cover · \(String(Int(cover.size.width))) × \(String(Int(cover.size.height))) px"
        )
        .font(.footnote.monospacedDigit())
        .foregroundStyle(.spineMutedForeground)
      }
      .padding(.horizontal, 32)
      .padding(.top, 12)
      .padding(.bottom, 20)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color.spineBackground.ignoresSafeArea())
      .navigationTitle("New cover")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
            .disabled(uploading)
        }
      }
      .safeAreaBar(edge: .bottom) {
        GlassEffectContainer(spacing: 12) {
          HStack(spacing: 12) {
            Button {
              self.cover = nil
            } label: {
              Text(usesScanner ? "Rescan" : "Choose another")
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.glass)
            .disabled(uploading)

            Button {
              use(cover)
            } label: {
              HStack(spacing: 8) {
                if uploading { ProgressView().tint(.onAccent) }
                Text("Use cover")
              }
              .font(.headline)
              .foregroundStyle(.onAccent)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 6)
            }
            .buttonStyle(.glassProminent)
            .tint(.lbGreen)
            .disabled(uploading)
          }
        }
        .frame(maxWidth: 560)
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
      }
    }
  }

  private func use(_ cover: UIImage) {
    guard !uploading else { return }
    uploading = true
    Task {
      defer { uploading = false }
      do {
        guard let image = await PhotoEncoding.coverUpload(cover) else {
          throw APIError.rejected("Couldn’t prepare the cover image.")
        }
        let uploaded = try await library.api.uploadCover(image: image).get()
        try await onCover(uploaded.url)
        dismiss()
      } catch {
        toasts.filmFailure(error, fallback: "Could not save the cover")
      }
    }
  }
}

/// VisionKit's document camera: live edge detection, auto-capture, and
/// perspective correction. Reports the first page.
private struct FilmDocumentCamera: UIViewControllerRepresentable {
  let onScan: (UIImage) -> Void
  let onCancel: () -> Void
  let onFailure: (Error) -> Void

  func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
    let camera = VNDocumentCameraViewController()
    camera.delegate = context.coordinator
    return camera
  }

  func updateUIViewController(_ camera: VNDocumentCameraViewController, context: Context) {
    context.coordinator.parent = self
  }

  func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

  final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
    var parent: FilmDocumentCamera

    init(parent: FilmDocumentCamera) { self.parent = parent }

    func documentCameraViewController(
      _ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan
    ) {
      guard scan.pageCount > 0 else {
        parent.onCancel()
        return
      }
      parent.onScan(scan.imageOfPage(at: 0))
    }

    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
      parent.onCancel()
    }

    func documentCameraViewController(
      _ controller: VNDocumentCameraViewController, didFailWithError error: Error
    ) {
      parent.onFailure(error)
    }
  }
}
