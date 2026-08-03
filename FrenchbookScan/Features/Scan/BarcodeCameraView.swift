import SwiftUI
import AVFoundation

/// Session caméra dédiée à la lecture continue des codes-barres livre.
///
/// `AVCaptureMetadataOutput` plutôt que `DataScannerViewController` : il
/// fonctionne sur tous les iPhone compatibles iOS 17 (le DataScanner exige une
/// puce A12+), il laisse le contrôle complet sur la torche et la mise au point
/// rapprochée, et il n'impose pas d'interface par-dessus la nôtre.
@MainActor
final class BarcodeCameraController: NSObject, ObservableObject, AVCaptureMetadataOutputObjectsDelegate {

    let captureSession = AVCaptureSession()

    @Published private(set) var isRunning = false
    @Published private(set) var isTorchOn = false
    @Published private(set) var permissionDenied = false

    /// Suspendu pendant qu'une feuille de confirmation est affichée : on ne
    /// veut pas empiler les lectures derrière une décision en attente.
    var isPaused = false

    var onCode: ((String) -> Void)?

    private let sessionQueue = DispatchQueue(label: "com.frenchbook.scan.camera")
    private var isConfigured = false
    private var lastCode: String?
    private var lastCodeDate = Date.distantPast

    /// Un même code lu deux fois en moins de ce délai est ignoré : la caméra
    /// voit le code-barres 20 fois par seconde tant que le livre est devant.
    private let debounceInterval: TimeInterval = 2.0

    // MARK: - Cycle de vie

    func start() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureAndRun()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                Task { @MainActor in
                    guard let self else { return }
                    if granted {
                        self.configureAndRun()
                    } else {
                        self.permissionDenied = true
                    }
                }
            }
        default:
            permissionDenied = true
        }
    }

    func stop() {
        setTorch(on: false)
        sessionQueue.async { [captureSession] in
            if captureSession.isRunning { captureSession.stopRunning() }
        }
        isRunning = false
    }

    /// Autorise à nouveau la lecture du même code immédiatement après une
    /// décision de l'opérateur (par exemple pour compter un second exemplaire).
    func clearDebounce() {
        lastCode = nil
        lastCodeDate = .distantPast
    }

    private func configureAndRun() {
        if !isConfigured {
            configure()
            isConfigured = true
        }
        // `startRunning` est bloquant : il ne doit jamais tourner sur le thread
        // principal, sous peine de figer l'écran une demi-seconde à chaque
        // retour sur la vue de scan.
        let session = captureSession
        sessionQueue.async {
            if !session.isRunning { session.startRunning() }
        }
        isRunning = true
    }

    private func configure() {
        captureSession.beginConfiguration()
        captureSession.sessionPreset = .hd1280x720

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device),
              captureSession.canAddInput(input)
        else {
            captureSession.commitConfiguration()
            return
        }
        captureSession.addInput(input)

        // Mise au point continue rapprochée : les livres sont scannés à ~15 cm.
        try? device.lockForConfiguration()
        if device.isFocusModeSupported(.continuousAutoFocus) {
            device.focusMode = .continuousAutoFocus
        }
        if device.isAutoFocusRangeRestrictionSupported {
            device.autoFocusRangeRestriction = .near
        }
        device.unlockForConfiguration()

        let output = AVCaptureMetadataOutput()
        guard captureSession.canAddOutput(output) else {
            captureSession.commitConfiguration()
            return
        }
        captureSession.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: sessionQueue)
        output.metadataObjectTypes = [.ean13, .ean8, .upce, .code128]

        captureSession.commitConfiguration()
    }

    // MARK: - Torche

    func toggleTorch() {
        setTorch(on: !isTorchOn)
    }

    private func setTorch(on: Bool) {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              device.hasTorch
        else { return }
        try? device.lockForConfiguration()
        device.torchMode = on ? .on : .off
        device.unlockForConfiguration()
        isTorchOn = on
    }

    // MARK: - Lecture

    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let value = object.stringValue
        else { return }

        Task { @MainActor in
            self.receive(value)
        }
    }

    private func receive(_ rawValue: String) {
        guard !isPaused else { return }

        let code = ISBN.normalize(rawValue)
        guard !code.isEmpty else { return }

        let now = Date()
        if code == lastCode, now.timeIntervalSince(lastCodeDate) < debounceInterval { return }
        lastCode = code
        lastCodeDate = now

        onCode?(code)
    }
}

/// Aperçu caméra plein écran.
struct CameraPreview: UIViewRepresentable {
    let captureSession: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = captureSession
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
