#if targetEnvironment(simulator)
import SwiftUI

/// Remplace l'aperçu caméra dans le simulateur.
///
/// Le simulateur iOS ne fournit aucune caméra virtuelle : `AVCaptureDevice`
/// n'y renvoie aucun périphérique. Plutôt que d'afficher un écran noir, on
/// injecte les codes à la main pour pouvoir dérouler tout le flux de comptage
/// sur Mac — feuille de quantité, surplus, code inconnu, récapitulatif.
///
/// Ce fichier n'est compilé que pour le simulateur : il ne peut pas se
/// retrouver dans un binaire distribué.
struct SimulatedScannerPanel: View {
    let lines: [OrderLine]
    let onScan: (String) -> Void

    @State private var manualCode = ""

    var body: some View {
        VStack(spacing: 0) {
            banner

            List {
                Section {
                    HStack {
                        TextField("Saisir un code-barres", text: $manualCode)
                            .font(.body.monospaced())
                            .textFieldStyle(.roundedBorder)
                        Button("Scanner") {
                            onScan(manualCode)
                            manualCode = ""
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(manualCode.filter(\.isNumber).count < 8)
                    }

                    Button {
                        // Un EAN-13 valide mais absent du bon, pour éprouver le
                        // parcours « livre hors commande ».
                        onScan("9780306406157")
                    } label: {
                        Label("Simuler un livre hors commande", systemImage: "questionmark.circle")
                    }
                } header: {
                    Text("Code arbitraire")
                }

                Section("Titres du bon — touchez pour scanner") {
                    ForEach(lines) { line in
                        Button {
                            onScan(line.isbn)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(line.title).font(.subheadline).lineLimit(1)
                                    Text(ISBN.formatted(line.isbn))
                                        .font(.caption.monospaced())
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text("\(line.counted)/\(line.expected)")
                                    .font(.subheadline.weight(.semibold))
                                    .monospacedDigit()
                                    .foregroundStyle(line.isComplete ? Theme.ok : .secondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
        .background(Color(.systemGroupedBackground))
    }

    private var banner: some View {
        HStack(spacing: 10) {
            Image(systemName: "hammer.fill")
            Text("Simulateur — caméra indisponible, scans injectés à la main")
                .font(.caption.weight(.medium))
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.indigo)
    }
}
#endif
