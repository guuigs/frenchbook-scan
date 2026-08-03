import SwiftUI

/// Récapitulatif de fin de carton, avant clôture définitive.
///
/// C'est le dernier point où les données existent encore : la clôture purge
/// tout. L'export est donc proposé ici, pas après.
struct CartonSummaryView: View {
    @EnvironmentObject private var coordinator: CartonCoordinator

    @State private var showCloseConfirmation = false
    @State private var hasExported = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    verdictBanner
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .listRowBackground(Color.clear)
                }

                Section("Synthèse") {
                    statRow("Titres au bon", "\(coordinator.session.lines.count)", color: .primary)
                    statRow("Exemplaires attendus", "\(coordinator.session.totalExpected)", color: .primary)
                    statRow("Exemplaires comptés", "\(coordinator.session.totalCounted)", color: .primary)
                    if totalMissing > 0 {
                        statRow("Manquants", "\(totalMissing)", color: Theme.danger)
                    }
                    if totalSurplus > 0 {
                        statRow("En surplus", "\(totalSurplus)", color: Theme.warning)
                    }
                    if coordinator.session.totalDamaged > 0 {
                        statRow("Abîmés", "\(coordinator.session.totalDamaged)", color: Theme.warning)
                    }
                    if coordinator.session.totalExtras > 0 {
                        statRow("Hors bon de commande", "\(coordinator.session.totalExtras)", color: Theme.warning)
                    }
                }

                if !coordinator.session.missingLines.isEmpty {
                    Section {
                        ForEach(coordinator.session.missingLines) { line in
                            anomalyRow(line, detail: "\(line.shortfall) manquant(s)", color: Theme.danger)
                        }
                    } header: {
                        Label("Manques", systemImage: "minus.circle")
                    } footer: {
                        Text("Ces titres n'ont pas été trouvés en totalité dans le carton.")
                    }
                }

                if !coordinator.session.surplusLines.isEmpty {
                    Section {
                        ForEach(coordinator.session.surplusLines) { line in
                            anomalyRow(line, detail: "+\(line.surplus)", color: Theme.warning)
                        }
                    } header: {
                        Label("Surplus", systemImage: "plus.circle")
                    }
                }

                if !coordinator.session.damagedLines.isEmpty {
                    Section {
                        ForEach(coordinator.session.damagedLines) { line in
                            anomalyRow(line, detail: "\(line.damaged) abîmé(s)", color: Theme.warning)
                        }
                    } header: {
                        Label("Livres abîmés", systemImage: "exclamationmark.triangle")
                    }
                }

                if !coordinator.session.extras.isEmpty {
                    Section {
                        ForEach(coordinator.session.extras) { extra in
                            HStack {
                                Text(ISBN.formatted(extra.isbn)).font(.subheadline.monospaced())
                                Spacer()
                                Text("×\(extra.counted)")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Theme.warning)
                            }
                        }
                    } header: {
                        Label("Hors bon de commande", systemImage: "questionmark.circle")
                    }
                }

                if !coordinator.session.backorderedLines.isEmpty {
                    Section {
                        ForEach(coordinator.session.backorderedLines) { line in
                            anomalyRow(line, detail: "\(line.backorder) en attente", color: .secondary)
                        }
                    } header: {
                        Label("Reliquats annoncés au bon", systemImage: "clock")
                    } footer: {
                        Text("Écart entre la quantité commandée et celle que le fournisseur déclare avoir livrée. Ce n'est pas un manque de votre côté.")
                    }
                }

                Section {
                    exportRow
                } footer: {
                    Text("Les données de ce carton — bon de commande, photos et comptage — sont effacées de l'appareil à la clôture. Exportez maintenant si vous voulez en garder une trace.")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Fin du carton")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        coordinator.returnToScanning()
                    } label: {
                        Label("Reprendre le scan", systemImage: "chevron.left")
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                closeBar
            }
            .task {
                coordinator.prepareExport()
            }
            .confirmationDialog(
                "Clôturer définitivement ce carton ?",
                isPresented: $showCloseConfirmation,
                titleVisibility: .visible
            ) {
                Button("Clôturer et effacer", role: .destructive) {
                    Feedback.success(sound: true)
                    coordinator.closeCarton()
                }
                Button("Revenir au récapitulatif", role: .cancel) {}
            } message: {
                Text(closeWarning)
            }
        }
    }

    // MARK: - Éléments

    private var totalMissing: Int { coordinator.session.missingLines.reduce(0) { $0 + $1.shortfall } }
    private var totalSurplus: Int { coordinator.session.surplusLines.reduce(0) { $0 + $1.surplus } }

    private var isConform: Bool { !coordinator.session.hasAnomalies }

    private var verdictBanner: some View {
        HStack(spacing: 14) {
            Image(systemName: isConform ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                .font(.title)
                .foregroundStyle(isConform ? Theme.ok : Theme.warning)

            VStack(alignment: .leading, spacing: 3) {
                Text(isConform ? "Carton conforme" : "Écarts constatés")
                    .font(.headline)
                Text(isConform
                     ? "Tous les exemplaires annoncés ont été comptés."
                     : "Vérifiez les écarts ci-dessous avant de clôturer.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background((isConform ? Theme.ok : Theme.warning).opacity(0.12),
                    in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }

    private func statRow(_ label: String, _ value: String, color: Color) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .font(.body.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(color)
        }
    }

    private func anomalyRow(_ line: OrderLine, detail: String, color: Color) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(line.title).font(.subheadline).lineLimit(2)
                Text(ISBN.formatted(line.isbn))
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(detail)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(color)
                Text("\(line.counted)/\(line.expected)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
    }

    @ViewBuilder
    private var exportRow: some View {
        if coordinator.exportURLs.isEmpty {
            HStack {
                ProgressView()
                Text("Préparation du récapitulatif…")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } else {
            ShareLink(items: coordinator.exportURLs) {
                Label("Exporter le récapitulatif (PDF + CSV)", systemImage: "square.and.arrow.up")
            }
            .simultaneousGesture(TapGesture().onEnded { hasExported = true })
        }
    }

    private var closeBar: some View {
        VStack(spacing: 8) {
            Button {
                showCloseConfirmation = true
            } label: {
                Label("Clôturer le carton", systemImage: "checkmark.circle.fill")
            }
            .buttonStyle(PrimaryButtonStyle(tint: isConform ? Theme.ok : Theme.warning))

            Text("Puis retour à l'attente d'un nouveau bon de commande.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.bar)
    }

    private var closeWarning: String {
        var parts: [String] = []
        if totalMissing > 0 { parts.append("\(totalMissing) exemplaire(s) manquant(s)") }
        if totalSurplus > 0 { parts.append("\(totalSurplus) en surplus") }
        if coordinator.session.totalDamaged > 0 { parts.append("\(coordinator.session.totalDamaged) abîmé(s)") }
        if coordinator.session.totalExtras > 0 { parts.append("\(coordinator.session.totalExtras) hors commande") }

        let anomalies = parts.isEmpty ? "Aucun écart constaté." : parts.joined(separator: ", ") + "."
        let export = hasExported ? "" : " Vous n'avez pas encore exporté le récapitulatif."
        return anomalies + " Toutes les données de ce carton seront supprimées de l'appareil." + export
    }
}
