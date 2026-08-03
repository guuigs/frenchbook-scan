import SwiftUI

/// Contrôle du bon de commande lu.
///
/// Le tri est délibéré : les lignes à vérifier remontent en tête. L'opérateur
/// travaille de haut en bas jusqu'à ce que le bandeau passe au vert, sans avoir
/// à relire les lignes que les deux moteurs ont lues à l'identique.
struct OrderReviewView: View {
    @EnvironmentObject private var coordinator: CartonCoordinator

    @State private var editingLine: OrderLine?
    @State private var showAbandonConfirmation = false
    @State private var showValidationConfirmation = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    statusBanner
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .listRowBackground(Color.clear)
                }

                if !pendingLines.isEmpty {
                    Section {
                        ForEach(pendingLines) { line in
                            Button { editingLine = line } label: {
                                OrderLineRow(line: line)
                            }
                            .buttonStyle(.plain)
                        }
                        .onDelete { offsets in
                            offsets.map { pendingLines[$0].id }.forEach(coordinator.deleteLine)
                        }
                    } header: {
                        Text("À vérifier — \(pendingLines.count)")
                    } footer: {
                        Text("Touchez une ligne pour trancher entre les deux lectures ou corriger la valeur.")
                    }
                }

                if !confirmedLines.isEmpty {
                    Section {
                        ForEach(confirmedLines) { line in
                            Button { editingLine = line } label: {
                                OrderLineRow(line: line)
                            }
                            .buttonStyle(.plain)
                        }
                        .onDelete { offsets in
                            offsets.map { confirmedLines[$0].id }.forEach(coordinator.deleteLine)
                        }
                    } header: {
                        Text("Lecture concordante — \(confirmedLines.count)")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Bon de commande")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Abandonner", role: .destructive) { showAbandonConfirmation = true }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        editingLine = coordinator.addManualLine()
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Ajouter une ligne manquante")
                }
            }
            .safeAreaInset(edge: .bottom) {
                validationBar
            }
            .sheet(item: $editingLine) { line in
                LineEditorView(line: line) { updated in
                    coordinator.resolveIssues(for: line.id, with: updated)
                    editingLine = nil
                }
            }
            .confirmationDialog(
                "Abandonner ce carton ?",
                isPresented: $showAbandonConfirmation,
                titleVisibility: .visible
            ) {
                Button("Abandonner et tout effacer", role: .destructive) {
                    coordinator.abandonCarton()
                }
                Button("Continuer le contrôle", role: .cancel) {}
            } message: {
                Text("Le bon de commande lu et ses photos seront définitivement supprimés.")
            }
            .confirmationDialog(
                "Valider le bon de commande ?",
                isPresented: $showValidationConfirmation,
                titleVisibility: .visible
            ) {
                Button("Valider et scanner les livres") { coordinator.validateOrder() }
                Button("Revoir", role: .cancel) {}
            } message: {
                Text("\(coordinator.session.lines.count) titre(s), \(coordinator.session.totalExpected) exemplaire(s) attendus. Le tableau ne sera plus modifiable ligne par ligne après validation.")
            }
        }
    }

    // MARK: - Sous-vues

    private var pendingLines: [OrderLine] { coordinator.session.lines.filter(\.needsReview) }
    private var confirmedLines: [OrderLine] { coordinator.session.lines.filter { !$0.needsReview } }

    private var statusBanner: some View {
        let isClean = coordinator.session.isReviewComplete
        return HStack(spacing: 14) {
            Image(systemName: isClean ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                .font(.title2)
                .foregroundStyle(isClean ? Theme.ok : Theme.warning)

            VStack(alignment: .leading, spacing: 3) {
                Text(isClean ? "Lecture vérifiée" : "\(pendingLines.count) ligne(s) à vérifier")
                    .font(.subheadline.weight(.semibold))
                Text(isClean
                     ? "Toutes les lignes concordent entre les deux lectures."
                     : "Les deux lectures divergent ou une clé ISBN est invalide.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background((isClean ? Theme.ok : Theme.warning).opacity(0.12),
                    in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }

    private var validationBar: some View {
        VStack(spacing: 10) {
            HStack {
                summaryChip("\(coordinator.session.lines.count)", "titres")
                summaryChip("\(coordinator.session.totalExpected)", "exemplaires")
                if coordinator.session.backorderedLines.isEmpty == false {
                    summaryChip("\(coordinator.session.backorderedLines.count)", "en reliquat")
                }
                Spacer()
            }
            .font(.caption)

            Button {
                showValidationConfirmation = true
            } label: {
                Label("Valider et passer au scan", systemImage: "barcode.viewfinder")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!coordinator.session.isReviewComplete || coordinator.session.lines.isEmpty)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.bar)
    }

    private func summaryChip(_ value: String, _ label: String) -> some View {
        HStack(spacing: 4) {
            Text(value).fontWeight(.semibold).monospacedDigit()
            Text(label).foregroundStyle(.secondary)
        }
    }
}

/// Une ligne du tableau dans la liste de contrôle.
struct OrderLineRow: View {
    let line: OrderLine

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: line.needsReview ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                .foregroundStyle(line.needsReview ? Theme.warning : Theme.ok)
                .font(.title3)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 4) {
                Text(line.title.isEmpty ? "Titre manquant" : line.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(line.title.isEmpty ? Theme.danger : .primary)
                    .lineLimit(2)

                Text(line.displayAuthor)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Text(line.isbn.isEmpty ? "ISBN manquant" : ISBN.formatted(line.isbn))
                        .font(.caption.monospaced())
                        .foregroundStyle(line.isbn.isEmpty ? Theme.danger : .secondary)

                    Text("cdé \(line.quantityOrdered) · livré \(line.quantityDelivered)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }

                if line.needsReview {
                    FlowRow(spacing: 6) {
                        ForEach(uniqueIssueKinds, id: \.self) { kind in
                            Text(kind.label).statusTint(Theme.warning)
                        }
                    }
                    .padding(.top, 2)
                }
            }

            Spacer(minLength: 0)

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
                .padding(.top, 4)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    private var uniqueIssueKinds: [IssueKind] {
        var seen: [IssueKind] = []
        for issue in line.issues where !seen.contains(issue.kind) {
            seen.append(issue.kind)
        }
        return seen
    }
}

/// Disposition en lignes qui passent à la ligne — utilisée pour les pastilles
/// d'anomalie dont le nombre varie.
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                totalHeight += rowHeight + spacing
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += rowWidth > 0 ? spacing + size.width : size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        return CGSize(width: maxWidth == .infinity ? rowWidth : maxWidth, height: totalHeight + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
