import AVFoundation
import SwiftUI
import Vision
import VisionKit

/// Scan a disc's UPC/EAN barcode with the camera — the web's
/// `BarcodeScanDialog`. Hands the first hit to `onDetected` and closes.
/// Where the camera can't scan (the simulator, a denied permission) the
/// barcode can be typed instead, so the lookup chain still works.
struct FilmBarcodeScanSheet: View {
  let onDetected: (String) -> Void

  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var camera: CameraState = .checking
  @State private var typing = false
  /// Set once the viewfinder is on screen — the scanner starts then.
  @State private var scannerVisible = false
  @State private var manualCode = ""
  @FocusState private var manualFocused: Bool

  private enum CameraState { case checking, ready, unsupported, denied }

  var body: some View {
    NavigationStack {
      Group {
        switch camera {
        case .checking:
          ProgressView()
            .controlSize(.large)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready where !typing:
          scanner
        default:
          manualEntry
        }
      }
      .navigationTitle("Scan a barcode")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
        }
        if camera == .ready {
          ToolbarItem(placement: .primaryAction) {
            Button {
              typing.toggle()
            } label: {
              Label(
                typing ? "Use the camera" : "Type the barcode",
                systemImage: typing ? "camera" : "keyboard")
            }
          }
        }
      }
      .spineScreenBackground()
    }
    .task { camera = await Self.cameraState() }
  }

  // MARK: Camera

  private var scanner: some View {
    FilmDataScanner(
      isActive: scannerVisible,
      onDetected: detected,
      // The camera went away mid-scan (permission revoked, in use
      // elsewhere): fall back to typing.
      onUnavailable: { camera = .denied }
    )
    .ignoresSafeArea()
    .onAppear { scannerVisible = true }
    .onDisappear { scannerVisible = false }
    .overlay {
      // The web's aiming box over the viewfinder.
      RoundedRectangle(cornerRadius: 14)
        .strokeBorder(Color.lbGreen.opacity(0.85), lineWidth: 2.5)
        .frame(height: 110)
        .padding(.horizontal, 40)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
    .overlay(alignment: .bottom) {
      Text(
        "Point the camera at the disc's UPC/EAN barcode. Matches are looked up on Blu-ray.com, then CEX, then the web."
      )
      .font(.footnote)
      .foregroundStyle(.spineForeground)
      .multilineTextAlignment(.center)
      .padding(.horizontal, 18)
      .padding(.vertical, 12)
      .glassEffect(.regular, in: .rect(cornerRadius: 18))
      .padding(.horizontal, 20)
      .padding(.bottom, 12)
    }
  }

  // MARK: Typing it in

  private var manualEntry: some View {
    Form {
      if camera != .ready {
        Section {
          VStack(spacing: 10) {
            Image(systemName: camera == .denied ? "camera.badge.ellipsis" : "barcode.viewfinder")
              .font(.system(size: 44, weight: .light))
              .foregroundStyle(.lbGreen)
              .accessibilityHidden(true)
            Text("Camera unavailable")
              .font(.headline)
              .foregroundStyle(.spineForeground)
            Text(
              camera == .denied
                ? "Camera access is off, or the camera is busy. Allow it in Settings, or type the barcode instead."
                : "This device can't scan with its camera. Type the barcode instead."
            )
            .font(.subheadline)
            .foregroundStyle(.spineMutedForeground)
            .multilineTextAlignment(.center)
          }
          .frame(maxWidth: .infinity)
          .padding(.vertical, 8)
          .accessibilityElement(children: .combine)
        }
        .listRowBackground(Color.clear)
      }

      Section {
        TextField("Barcode (UPC/EAN)", text: $manualCode, prompt: Text("Barcode (UPC/EAN)"))
          .keyboardType(.numberPad)
          .font(.title3.monospacedDigit())
          .focused($manualFocused)
          .onChange(of: manualCode) { _, new in
            let digits = new.filter(\.isASCII).filter(\.isNumber)
            if digits != new { manualCode = digits }
          }
      } footer: {
        Text(
          "The 8–13 digits printed under the barcode. Matches are looked up on Blu-ray.com, then CEX, then the web."
        )
      }
      .listRowBackground(Color.spineCard)

      Section {
        Button {
          detected(manualCode)
        } label: {
          Label("Look up barcode", systemImage: "magnifyingglass")
            .font(.headline)
            .foregroundStyle(manualCode.count < 8 ? Color.spineMutedForeground : Color.onAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
        }
        .buttonStyle(.glassProminent)
        .tint(.lbGreen)
        .disabled(manualCode.count < 8)
        .listRowInsets(EdgeInsets())
      }
      .listRowBackground(Color.clear)

      if camera == .denied {
        Section {
          Button("Open Settings", systemImage: "gear") {
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
          }
        }
        .listRowBackground(Color.spineCard)
      }
    }
    .onAppear {
      // No camera to aim: go straight to the keyboard.
      if camera != .ready || typing { manualFocused = true }
    }
  }

  private func detected(_ code: String) {
    dismiss()
    onDetected(code)
  }

  /// Whether the camera can scan: VisionKit's data scanner needs supported
  /// hardware (never the simulator) and camera permission, asked for here
  /// the first time.
  private static func cameraState() async -> CameraState {
    guard DataScannerViewController.isSupported else { return .unsupported }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .notDetermined:
      guard await AVCaptureDevice.requestAccess(for: .video) else { return .denied }
    case .denied, .restricted:
      return .denied
    default:
      break
    }
    return DataScannerViewController.isAvailable ? .ready : .denied
  }
}

/// VisionKit's live barcode scanner, reporting the first EAN/UPC it reads.
private struct FilmDataScanner: UIViewControllerRepresentable {
  /// Scanning starts once the view is on screen, as Apple's sample does —
  /// starting before it's in a window can fail.
  let isActive: Bool
  let onDetected: (String) -> Void
  let onUnavailable: () -> Void

  func makeUIViewController(context: Context) -> DataScannerViewController {
    // Vision reads UPC-A as EAN-13 (with a leading zero), so these three
    // cover EAN-13, EAN-8, UPC-A, and UPC-E.
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: [.ean13, .ean8, .upce])],
      qualityLevel: .balanced,
      recognizesMultipleItems: false,
      isHighFrameRateTrackingEnabled: false,
      isPinchToZoomEnabled: true,
      isGuidanceEnabled: true,
      isHighlightingEnabled: true)
    scanner.delegate = context.coordinator
    return scanner
  }

  func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
    // A parent re-render hands over a fresh closure; the running camera
    // keeps going (the web's "keep the camera running" fix).
    context.coordinator.onDetected = onDetected
    context.coordinator.onUnavailable = onUnavailable
    if isActive, !scanner.isScanning, !context.coordinator.hasDetected {
      do {
        try scanner.startScanning()
      } catch {
        // Not during the view update itself.
        Task { onUnavailable() }
      }
    } else if !isActive, scanner.isScanning {
      scanner.stopScanning()
    }
  }

  static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
    scanner.stopScanning()
  }

  func makeCoordinator() -> Coordinator {
    Coordinator(onDetected: onDetected, onUnavailable: onUnavailable)
  }

  final class Coordinator: NSObject, DataScannerViewControllerDelegate {
    var onDetected: (String) -> Void
    var onUnavailable: () -> Void
    private(set) var hasDetected = false

    init(onDetected: @escaping (String) -> Void, onUnavailable: @escaping () -> Void) {
      self.onDetected = onDetected
      self.onUnavailable = onUnavailable
    }

    func dataScanner(
      _ dataScanner: DataScannerViewController,
      becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable
    ) {
      onUnavailable()
    }

    func dataScanner(
      _ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem],
      allItems: [RecognizedItem]
    ) {
      guard !hasDetected else { return }
      for item in addedItems {
        guard case .barcode(let barcode) = item, let payload = barcode.payloadStringValue
        else { continue }
        let code = Self.normalized(payload, symbology: barcode.observation.symbology)
        // Same filter as the web: a real UPC/EAN has at least 8 digits.
        guard code.count >= 8 else { continue }
        hasDetected = true
        dataScanner.stopScanning()
        onDetected(code)
        return
      }
    }

    /// A 13-digit EAN starting with 0 is a UPC-A; report its 12 digits, as
    /// the web's detector does.
    private static func normalized(_ payload: String, symbology: VNBarcodeSymbology) -> String {
      if symbology == .ean13, payload.count == 13, payload.hasPrefix("0") {
        return String(payload.dropFirst())
      }
      return payload
    }
  }
}
