import Foundation
import Combine

/// Réglages de l'app. La clé API vit dans le Trousseau, le reste dans les
/// préférences utilisateur (aucune donnée de commande n'y est stockée).
@MainActor
final class AppSettings: ObservableObject {

    private enum Keys {
        static let apiKey = "mistral.api.key"
        static let ocrModel = "mistral.ocr.model"
        static let visionModel = "mistral.vision.model"
        static let doubleCheck = "ocr.double.check"
        static let soundEnabled = "scan.sound"
    }

    static let defaultOCRModel = "mistral-ocr-latest"
    static let defaultVisionModel = "mistral-medium-latest"

    @Published var apiKey: String {
        didSet { Keychain.set(apiKey, for: Keys.apiKey) }
    }

    @Published var ocrModel: String {
        didSet { UserDefaults.standard.set(ocrModel, forKey: Keys.ocrModel) }
    }

    @Published var visionModel: String {
        didSet { UserDefaults.standard.set(visionModel, forKey: Keys.visionModel) }
    }

    /// Double lecture croisée. Désactivable pour dépanner ou réduire les coûts,
    /// mais l'app affiche alors un avertissement : plus aucun filet de sécurité.
    @Published var doubleCheckEnabled: Bool {
        didSet { UserDefaults.standard.set(doubleCheckEnabled, forKey: Keys.doubleCheck) }
    }

    @Published var soundEnabled: Bool {
        didSet { UserDefaults.standard.set(soundEnabled, forKey: Keys.soundEnabled) }
    }

    init() {
        let defaults = UserDefaults.standard
        defaults.register(defaults: [
            Keys.doubleCheck: true,
            Keys.soundEnabled: true
        ])
        apiKey = Keychain.get(Keys.apiKey) ?? ""
        ocrModel = defaults.string(forKey: Keys.ocrModel) ?? Self.defaultOCRModel
        visionModel = defaults.string(forKey: Keys.visionModel) ?? Self.defaultVisionModel
        doubleCheckEnabled = defaults.bool(forKey: Keys.doubleCheck)
        soundEnabled = defaults.bool(forKey: Keys.soundEnabled)
    }

    var isConfigured: Bool { !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var maskedKey: String {
        guard apiKey.count > 8 else { return "••••••••" }
        return String(repeating: "•", count: 8) + apiKey.suffix(4)
    }

    func makeClient() -> MistralClient {
        MistralClient(
            apiKey: apiKey.trimmingCharacters(in: .whitespacesAndNewlines),
            ocrModel: ocrModel,
            visionModel: visionModel
        )
    }
}
