import SwiftUI

/// Consultation de l'avancement pendant le scan, sans quitter le carton.
///
/// Utile pour retrouver un titre précis dans un gros carton : l'opérateur voit
/// ce qu'il lui reste à trouver au lieu de fouiller au hasard.
struct ScanChecklistView: View {
    @EnvironmentObject private var coordinator: CartonCoordinator
    @Environment(\.dismiss) private var dismiss

    @State private var search = ""

    var body: some View {
        NavigationStack {
            List {
                if !remaining.isEmpty {
                    Section("Restant à trouver — \(remaining.count)") {
                        ForEach(remaining) { line in
                            ChecklistRow(line: line)
                        }
                    }
                }

                if !done.isEmpty {
                    Section("Comptés — \(done.count)") {
                        ForEach(done) { line in
                            ChecklistRow(line: line)
                        }
                    }
                }

                if !coordinator.session.extras.isEmpty {
                    Section("Hors bon de commande") {
                        ForEach(coordinator.session.extras) { extra in
                            HStack {
                                Text(ISBN.formatted(extra.isbn))
                                    .font(.subheadline.monospaced())
                                Spacer()
                                Text("×\(extra.counted)")
                                    .font(.subheadline.weight(.semibold))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.warning)
                            }
                        }
                        .onDelete { offsets in
                            offsets.map { coordinator.session.extras[$0].id }.forEach(coordinator.removeExtra)
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: "Titre, auteur ou ISBN")
            .navigationTitle("Avancement")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Reprendre le scan") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
    }

    private var filtered: [OrderLine] {
        let query = Reconciler.normalizedText(search)
        guard !query.isEmpty else { return coordinator.session.lines }
        return coordinator.session.lines.filter { line in
            Reconciler.normalizedText(line.title).contains(query)
                || Reconciler.normalizedText(line.author).contains(query)
                || line.isbn.contains(search.filter(\.isNumber))
        }
    }

    private var remaining: [OrderLine] { filtered.filter { !$0.isComplete } }
    private var done: [OrderLine] { filtered.filter(\.isComplete) }
}

struct ChecklistRow: View {
    let line: OrderLine

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: line.isComplete ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(line.isComplete ? Theme.ok : Color(.tertiaryLabel))
                .font(.title3)

            VStack(alignment: .leading, spacing: 2) {
                Text(line.title)
                    .font(.subheadline)
                    .lineLimit(1)
                Text(ISBN.formatted(line.isbn))
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                Text("\(line.counted)/\(line.expected)")
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(countColor)
                if line.damaged > 0 {
                    Text("\(line.damaged) abîmé(s)")
                        .font(.caption2)
                        .foregroundStyle(Theme.warning)
                }
            }
        }
    }

    private var countColor: Color {
        if line.surplus > 0 { return Theme.warning }
        if line.isComplete { return Theme.ok }
        return .secondary
    }
}
