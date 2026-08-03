import UIKit
import AudioToolbox

/// Retours haptiques et sonores du poste de scan.
///
/// En entrepôt, l'opérateur ne regarde pas toujours l'écran : le haptique et le
/// son sont le canal principal de confirmation. Ils sont donc distincts et
/// reconnaissables les uns des autres.
@MainActor
enum Feedback {

    private static let notification = UINotificationFeedbackGenerator()
    private static let impact = UIImpactFeedbackGenerator(style: .medium)
    private static let selection = UISelectionFeedbackGenerator()

    static func prepare() {
        notification.prepare()
        impact.prepare()
        selection.prepare()
    }

    /// Livre reconnu et compté.
    static func success(sound: Bool) {
        notification.notificationOccurred(.success)
        if sound { AudioServicesPlaySystemSound(1057) }
    }

    /// Livre reconnu mais nécessitant une décision (quantité, surplus).
    static func attention(sound: Bool) {
        notification.notificationOccurred(.warning)
        if sound { AudioServicesPlaySystemSound(1113) }
    }

    /// Code inconnu du bon de commande.
    static func failure(sound: Bool) {
        notification.notificationOccurred(.error)
        if sound { AudioServicesPlaySystemSound(1073) }
    }

    static func tick() { selection.selectionChanged() }

    static func bump() { impact.impactOccurred() }
}
