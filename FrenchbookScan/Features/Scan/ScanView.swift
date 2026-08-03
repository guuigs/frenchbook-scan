import SwiftUI

/// Poste de scan : la caméra ne s'arrête jamais.
///
/// L'écran est pensé pour un opérateur debout devant un carton, l'iPhone dans
/// une main, un livre dans l'autre. Tout ce qui demande une action est en bas,
/// à portée du pouce ; l'information de contexte reste en haut, hors de la
/// zone de visée.
struct ScanView: View {
    @EnvironmentObject private var coordinator: CartonCoordinator
    @EnvironmentObject private var settings: AppSettings

    @StateObject private var camera = BarcodeCameraController()

    /// Ce qui est affiché par-dessus la caméra après une lecture.
    @State private var pendingQuantity: OrderLine?
    @State private var flash: FlashState?
    @State private var unknownCode: String?
    @State private var showChecklist = false
    @State private var flashTask: Task<Void, Never>?

    struct FlashState: Identifiable, Equatable {
        var id = UUID()
        var title: String
        var subtitle: String
        var counter: String
        var color: Color
    }

    var body: some View {
        ZStack {
            captureLayer

            VStack(spacing: 0) {
                topBar
                Spacer()
                bottomBar
            }

            if let flash {
                FlashConfirmationView(state: flash)
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
                    .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.18), value: flash)
        .statusBarHidden(false)
        .onAppear {
            Feedback.prepare()
            #if !targetEnvironment(simulator)
            camera.onCode = handle
            camera.start()
            #endif
        }
        .onDisappear {
            flashTask?.cancel()
            camera.stop()
        }
        .sheet(item: $pendingQuantity) { line in
            QuantitySheet(line: line) { counted, damaged in
                coordinator.setCount(counted, damaged: damaged, for: line.id)
                pendingQuantity = nil
                resumeCamera()
                showFlash(
                    title: line.title,
                    subtitle: damaged > 0 ? "\(damaged) abîmé(s) signalé(s)" : "Quantité enregistrée",
                    counter: "\(counted)/\(line.expected)",
                    color: counted == line.expected ? Theme.ok : Theme.warning
                )
            } onCancel: {
                pendingQuantity = nil
                resumeCamera()
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.hidden)
            .interactiveDismissDisabled()
        }
        .sheet(item: unknownBinding) { wrapper in
            UnknownCodeSheet(code: wrapper.code) {
                coordinator.recordExtra(isbn: wrapper.code)
                unknownCode = nil
                resumeCamera()
                showFlash(
                    title: "Hors bon de commande",
                    subtitle: ISBN.formatted(wrapper.code),
                    counter: "+1",
                    color: Theme.warning
                )
            } onIgnore: {
                unknownCode = nil
                resumeCamera()
            }
            .presentationDetents([.height(340)])
            .interactiveDismissDisabled()
        }
        .sheet(isPresented: $showChecklist, onDismiss: resumeCamera) {
            ScanChecklistView()
        }
    }

    /// Aperçu caméra sur appareil, panneau d'injection dans le simulateur.
    private var captureLayer: some View {
        ZStack {
            #if targetEnvironment(simulator)
            SimulatedScannerPanel(lines: coordinator.session.lines, onScan: handle)
                .padding(.top, 130)
                .padding(.bottom, 70)
            #else
            if camera.permissionDenied {
                permissionDeniedView
            } else {
                CameraPreview(captureSession: camera.captureSession)
                    .ignoresSafeArea()
                targetingReticle
            }
            #endif
        }
    }

    // MARK: - Traitement d'un code lu

    private func handle(_ code: String) {
        switch coordinator.handleScan(code) {
        case .autoConfirmed(let line):
            Feedback.success(sound: settings.soundEnabled)
            showFlash(title: line.title, subtitle: line.displayAuthor, counter: "1/1", color: Theme.ok)

        case .needsQuantity(let line):
            Feedback.attention(sound: settings.soundEnabled)
            camera.isPaused = true
            pendingQuantity = line

        case .alreadyComplete(let line):
            Feedback.attention(sound: settings.soundEnabled)
            camera.isPaused = true
            pendingQuantity = line

        case .unknown(let code):
            Feedback.failure(sound: settings.soundEnabled)
            camera.isPaused = true
            unknownCode = code
        }
    }

    private func resumeCamera() {
        camera.isPaused = false
        camera.clearDebounce()
    }

    /// Confirmation courte et non bloquante : elle s'efface toute seule pour
    /// que l'opérateur enchaîne sans toucher l'écran.
    private func showFlash(title: String, subtitle: String, counter: String, color: Color) {
        flashTask?.cancel()
        flash = FlashState(title: title, subtitle: subtitle, counter: counter, color: color)
        flashTask = Task {
            try? await Task.sleep(for: .milliseconds(1400))
            guard !Task.isCancelled else { return }
            flash = nil
        }
    }

    // MARK: - Habillage

    private var topBar: some View {
        VStack(spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(coordinator.session.displayTitle)
                        .font(.subheadline.weight(.semibold))
                    if !coordinator.session.reference.isEmpty {
                        Text(coordinator.session.reference)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button {
                    camera.toggleTorch()
                } label: {
                    Image(systemName: camera.isTorchOn ? "bolt.fill" : "bolt.slash")
                        .font(.headline)
                        .frame(width: 40, height: 40)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .accessibilityLabel(camera.isTorchOn ? "Éteindre la torche" : "Allumer la torche")
            }

            VStack(spacing: 6) {
                HStack {
                    Text("\(coordinator.session.totalCounted) / \(coordinator.session.totalExpected) exemplaires")
                        .font(.footnote.weight(.medium))
                        .monospacedDigit()
                    Spacer()
                    Text("\(remainingTitles) titre(s) restant(s)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ProgressView(value: coordinator.session.progress)
                    .tint(Theme.ok)
            }
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    private var remainingTitles: Int {
        coordinator.session.lines.filter { !$0.isComplete }.count
    }

    /// Repère de visée : un simple cadre, sans masque assombri, pour laisser
    /// l'opérateur voir ce qu'il tient.
    private var targetingReticle: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .stroke(.white.opacity(0.55), style: StrokeStyle(lineWidth: 2, dash: [10, 8]))
            .frame(width: 260, height: 160)
            .allowsHitTesting(false)
    }

    private var bottomBar: some View {
        HStack {
            Button {
                camera.isPaused = true
                showChecklist = true
            } label: {
                Label("Liste", systemImage: "list.bullet")
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 14)
                    .frame(height: 44)
                    .background(.ultraThinMaterial, in: Capsule())
            }

            Spacer()

            Button {
                Feedback.bump()
                coordinator.requestSummary()
            } label: {
                Label("Fin du carton", systemImage: "checkmark.circle")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(.ultraThinMaterial, in: Capsule())
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    private var permissionDeniedView: some View {
        VStack(spacing: 16) {
            Image(systemName: "camera.metering.unknown")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Accès caméra refusé")
                .font(.headline)
            Text("Autorisez l'accès à la caméra dans Réglages › FrenchbookScan pour scanner les livres.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Ouvrir Réglages") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(SecondaryButtonStyle())
        }
        .padding(32)
    }

    /// Adaptateur : `sheet(item:)` exige un `Identifiable`.
    private var unknownBinding: Binding<UnknownCode?> {
        Binding(
            get: { unknownCode.map(UnknownCode.init) },
            set: { unknownCode = $0?.code }
        )
    }

    struct UnknownCode: Identifiable {
        let code: String
        var id: String { code }
    }
}

/// Confirmation flash après un scan validé d'office.
struct FlashConfirmationView: View {
    let state: ScanView.FlashState

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark")
                .font(.system(size: 44, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 88, height: 88)
                .background(state.color, in: Circle())

            Text(state.counter)
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .monospacedDigit()

            VStack(spacing: 4) {
                Text(state.title)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                Text(state.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(28)
        .frame(maxWidth: 320)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(radius: 20, y: 8)
        .allowsHitTesting(false)
    }
}
