import SwiftUI

/// Écran d'attente pendant la lecture des pages.
///
/// La double lecture prend quelques secondes par page : on montre exactement
/// où on en est plutôt qu'un indicateur générique, pour que l'opérateur sache
/// s'il a le temps de préparer le carton.
struct ProcessingView: View {
    let progress: OCRPipeline.Progress?
    let doubleCheck: Bool

    var body: some View {
        VStack(spacing: 28) {
            Spacer()

            ZStack {
                Circle()
                    .stroke(Color(.tertiarySystemFill), lineWidth: 8)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(Theme.accent, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 0.35), value: fraction)

                VStack(spacing: 2) {
                    Text("\(min(progress?.pageIndex ?? 0, pageCount))")
                        .font(.system(size: 40, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                    Text("sur \(pageCount)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 160, height: 160)

            VStack(spacing: 8) {
                Text(progress?.stage ?? "Lecture en cours…")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .contentTransition(.opacity)

                Text(doubleCheck
                     ? "Chaque page est lue par deux moteurs indépendants, puis les résultats sont comparés."
                     : "Lecture simple activée : aucune vérification croisée.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }

            Spacer()
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }

    private var pageCount: Int { max(progress?.pageCount ?? 1, 1) }

    private var fraction: CGFloat {
        guard let progress, progress.pageCount > 0 else { return 0 }
        return CGFloat(progress.pageIndex) / CGFloat(progress.pageCount)
    }
}
