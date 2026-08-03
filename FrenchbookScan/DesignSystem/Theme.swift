import SwiftUI

/// Vocabulaire visuel de l'app. On reste volontairement sur les couleurs
/// système : elles suivent le mode sombre, le contraste élevé et le Dynamic
/// Type sans travail supplémentaire.
enum Theme {
    static let ok = Color.green
    static let warning = Color.orange
    static let danger = Color.red
    static let accent = Color.accentColor

    /// Rayon d'arrondi standard des cartes, aligné sur les réglages iOS.
    static let corner: CGFloat = 16

    /// Hauteur minimale d'une cible tactile utilisable avec des gants.
    static let touchTarget: CGFloat = 56
}

extension View {
    /// Carte de contenu standard.
    func cardStyle() -> some View {
        self
            .padding(16)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }

    /// Applique une couleur d'état à un fond translucide léger.
    func statusTint(_ color: Color) -> some View {
        self
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
            .font(.caption.weight(.semibold))
    }
}

/// Bouton d'action principal, plein largeur, dimensionné pour l'entrepôt.
struct PrimaryButtonStyle: ButtonStyle {
    var tint: Color = Theme.accent

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: Theme.touchTarget)
            .background(tint.opacity(configuration.isPressed ? 0.75 : 1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Bouton secondaire discret.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Theme.accent)
            .frame(maxWidth: .infinity, minHeight: Theme.touchTarget)
            .background(Color(.tertiarySystemFill).opacity(configuration.isPressed ? 0.6 : 1),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
