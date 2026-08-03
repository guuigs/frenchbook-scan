import SwiftUI

/// Aiguillage entre les phases du poste de réception.
///
/// Une phase à l'écran à la fois : l'opérateur ne peut pas scanner pendant
/// qu'il contrôle un bon, ni contrôler pendant qu'il scanne. C'est ce qui rend
/// le comptage traçable.
struct RootView: View {
    @EnvironmentObject private var coordinator: CartonCoordinator
    @EnvironmentObject private var settings: AppSettings

    var body: some View {
        Group {
            switch coordinator.phase {
            case .idle:
                HomeView()

            case .processing:
                ProcessingView(
                    progress: coordinator.progress,
                    doubleCheck: settings.doubleCheckEnabled
                )

            case .review:
                OrderReviewView()

            case .scanning:
                ScanView()

            case .summary:
                CartonSummaryView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: coordinator.phase)
        // L'écran ne doit pas s'éteindre pendant un comptage : l'opérateur a
        // les mains prises et ne peut pas rallumer toutes les 30 secondes.
        .onChange(of: coordinator.phase) { _, phase in
            UIApplication.shared.isIdleTimerDisabled = (phase == .scanning)
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }
}
