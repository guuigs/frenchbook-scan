import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var coordinator: CartonCoordinator
    @Environment(\.dismiss) private var dismiss

    @State private var keyDraft = ""
    @State private var isEditingKey = false
    @State private var testState: TestState = .idle

    enum TestState: Equatable {
        case idle, running, success, failure(String)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if isEditingKey || !settings.isConfigured {
                        SecureField("sk-…", text: $keyDraft)
                            .textContentType(.password)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)

                        Button("Enregistrer la clé") {
                            settings.apiKey = keyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                            keyDraft = ""
                            isEditingKey = false
                            testState = .idle
                        }
                        .disabled(keyDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    } else {
                        LabeledContent("Clé enregistrée", value: settings.maskedKey)
                        Button("Remplacer la clé") { isEditingKey = true }
                        Button("Supprimer la clé", role: .destructive) {
                            settings.apiKey = ""
                            testState = .idle
                        }
                    }
                } header: {
                    Text("Clé API Mistral")
                } footer: {
                    Text("La clé est enregistrée dans le Trousseau iOS, hors sauvegarde iCloud. Elle ne quitte l'appareil que pour appeler l'API Mistral.")
                }

                Section {
                    Button {
                        Task { await testConnection() }
                    } label: {
                        HStack {
                            Text("Tester la connexion")
                            Spacer()
                            switch testState {
                            case .idle:
                                EmptyView()
                            case .running:
                                ProgressView()
                            case .success:
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.ok)
                            case .failure:
                                Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.danger)
                            }
                        }
                    }
                    .disabled(!settings.isConfigured || testState == .running)

                    if case .failure(let message) = testState {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(Theme.danger)
                    }
                }

                Section {
                    Toggle("Double lecture croisée", isOn: $settings.doubleCheckEnabled)
                } header: {
                    Text("Fiabilité de lecture")
                } footer: {
                    Text(settings.doubleCheckEnabled
                         ? "Chaque page est lue par deux moteurs indépendants et les résultats sont comparés. Seules les divergences vous sont soumises. Recommandé."
                         : "⚠️ Lecture simple : une erreur de lecture peut passer sans être signalée. Seule la clé de contrôle ISBN reste vérifiée.")
                }

                Section {
                    Toggle("Bips de confirmation", isOn: $settings.soundEnabled)
                } header: {
                    Text("Poste de scan")
                } footer: {
                    Text("Le retour haptique reste actif dans tous les cas.")
                }

                Section {
                    LabeledContent("Moteur OCR") {
                        TextField(AppSettings.defaultOCRModel, text: $settings.ocrModel)
                            .multilineTextAlignment(.trailing)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                    }
                    LabeledContent("Moteur vision") {
                        TextField(AppSettings.defaultVisionModel, text: $settings.visionModel)
                            .multilineTextAlignment(.trailing)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                    }
                    Button("Rétablir les modèles par défaut") {
                        settings.ocrModel = AppSettings.defaultOCRModel
                        settings.visionModel = AppSettings.defaultVisionModel
                    }
                } header: {
                    Text("Modèles")
                } footer: {
                    Text("À modifier seulement si Mistral publie de nouveaux identifiants de modèle.")
                }

                Section {
                    Button("Vider le cache du carton en cours", role: .destructive) {
                        SessionStore.purge()
                    }
                } footer: {
                    Text("Supprime immédiatement le bon de commande lu, ses photos et le comptage en cours. Sans effet si aucun carton n'est ouvert.")
                }

                #if DEBUG
                Section {
                    Button {
                        coordinator.loadDemoOrder()
                        dismiss()
                    } label: {
                        Label("Charger un bon de démonstration", systemImage: "hammer")
                    }
                } header: {
                    Text("Développement")
                } footer: {
                    Text("Bon fictif de 7 titres comportant une divergence de lecture, une clé ISBN cassée et une ligne à source unique. Permet de dérouler tout le flux sans caméra ni clé API. Absent des versions de production.")
                }
                #endif
            }
            .navigationTitle("Réglages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("OK") { dismiss() }.fontWeight(.semibold)
                }
            }
        }
    }

    /// Vérifie que la clé est acceptée sans consommer d'OCR : un simple appel
    /// à la liste des modèles suffit à valider l'authentification.
    private func testConnection() async {
        testState = .running
        var request = URLRequest(url: URL(string: "https://api.mistral.ai/v1/models")!)
        request.setValue("Bearer \(settings.apiKey)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 20

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(status) {
                testState = .success
            } else if status == 401 {
                testState = .failure("Clé refusée par Mistral (401). Vérifiez qu'elle est complète et active.")
            } else {
                testState = .failure("Réponse inattendue de Mistral (\(status)).")
            }
        } catch {
            testState = .failure(error.localizedDescription)
        }
    }
}
