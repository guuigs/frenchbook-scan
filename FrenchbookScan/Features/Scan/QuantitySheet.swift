import SwiftUI

/// Confirmation de quantité pour un titre attendu en plusieurs exemplaires.
///
/// La quantité attendue est proposée en grand et validable d'un seul geste :
/// c'est le cas courant. Corriger demande un geste de plus, volontairement,
/// car c'est une décision qui apparaîtra au récapitulatif.
struct QuantitySheet: View {

    /// D'où vient l'ouverture de la feuille : la quantité proposée par défaut
    /// n'est pas la même selon qu'un livre vient d'être scanné ou que
    /// l'opérateur revient corriger une ligne depuis la liste.
    enum Context {
        case scan
        case correction
    }

    let line: OrderLine
    let context: Context
    let onConfirm: (Int, Int) -> Void
    let onCancel: () -> Void

    @EnvironmentObject private var settings: AppSettings

    @State private var count: Int
    @State private var damaged: Int = 0
    @State private var isAdjusting = false

    init(
        line: OrderLine,
        context: Context = .scan,
        onConfirm: @escaping (Int, Int) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.line = line
        self.context = context
        self.onConfirm = onConfirm
        self.onCancel = onCancel

        switch context {
        case .scan:
            // On propose la quantité annoncée au bon. Si la ligne est déjà
            // soldée, c'est qu'un exemplaire de plus vient d'être scanné :
            // on propose le compte actuel + 1.
            _count = State(initialValue: line.isComplete ? line.counted + 1 : line.expected)
        case .correction:
            // On repart de ce qui a été compté, sans rien supposer.
            _count = State(initialValue: line.counted)
        }
        _damaged = State(initialValue: line.damaged)
    }

    private var isOverCount: Bool { count > line.expected }
    private var isUnderCount: Bool { count < line.expected }

    private var accentColor: Color {
        if isOverCount { return Theme.warning }
        if isUnderCount { return Theme.danger }
        return Theme.ok
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            ScrollView {
                VStack(spacing: 22) {
                    counter

                    if isAdjusting {
                        NumberPad(value: $count, maximum: 999)
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                    }

                    damagedControl

                    if context == .correction {
                        notice(
                            "Correction manuelle : \(line.counted) exemplaire(s) déjà compté(s) pour ce titre.",
                            color: .secondary
                        )
                    } else if line.isComplete {
                        notice(
                            "Ce titre était déjà complet (\(line.counted)/\(line.expected)). Toute quantité supplémentaire sera signalée en surplus.",
                            color: Theme.warning
                        )
                    } else if line.backorder > 0 {
                        notice(
                            "Le bon annonce \(line.quantityDelivered) exemplaire(s) livré(s) sur \(line.quantityOrdered) commandé(s) : \(line.backorder) en reliquat.",
                            color: .secondary
                        )
                    }
                }
                .padding(20)
            }

            actions
        }
        .background(Color(.systemGroupedBackground))
        .animation(.easeInOut(duration: 0.2), value: isAdjusting)
    }

    // MARK: - Sections

    private var header: some View {
        VStack(spacing: 6) {
            Capsule()
                .fill(Color(.tertiaryLabel))
                .frame(width: 36, height: 5)
                .padding(.top, 8)

            VStack(spacing: 4) {
                Text(line.title)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                Text(line.displayAuthor)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(ISBN.formatted(line.isbn))
                    .font(.caption.monospaced())
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 14)
        }
        .frame(maxWidth: .infinity)
        .background(Color(.secondarySystemGroupedBackground))
    }

    private var counter: some View {
        VStack(spacing: 10) {
            Text("Quantité attendue")
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)

            HStack(spacing: 22) {
                stepButton("minus", enabled: count > 0) { count -= 1 }

                Text("\(count)")
                    .font(.system(size: 76, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(accentColor)
                    .contentTransition(.numericText())
                    .animation(.snappy(duration: 0.2), value: count)
                    .frame(minWidth: 120)

                stepButton("plus", enabled: count < 999) { count += 1 }
            }

            Text("sur \(line.expected) annoncé(s) au bon")
                .font(.footnote)
                .foregroundStyle(.secondary)

            if isUnderCount {
                Text("\(line.expected - count) manquant(s)").statusTint(Theme.danger)
            } else if isOverCount {
                Text("\(count - line.expected) en surplus").statusTint(Theme.warning)
            }
        }
    }

    private func stepButton(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Feedback.tick()
            action()
        } label: {
            Image(systemName: icon)
                .font(.title2.weight(.semibold))
                .frame(width: 56, height: 56)
                .background(Color(.secondarySystemGroupedBackground), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
    }

    private var damagedControl: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Exemplaires abîmés", systemImage: "exclamationmark.triangle")
                    .font(.subheadline.weight(.medium))
                Spacer()
                Text("\(damaged)")
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(damaged > 0 ? Theme.warning : .secondary)
            }

            Stepper("", value: $damaged, in: 0...max(count, 1))
                .labelsHidden()
                .frame(maxWidth: .infinity, alignment: .leading)

            Text("Comptés dans la quantité reçue, mais signalés au récapitulatif.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .cardStyle()
    }

    private func notice(_ text: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill").foregroundStyle(color)
            Text(text).font(.footnote).foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .cardStyle()
    }

    private var confirmLabel: String {
        if context == .correction { return "Enregistrer \(count) exemplaire(s)" }
        if count == line.expected && count > 1 { return "Les \(count) sont là" }
        return "Valider \(count) exemplaire(s)"
    }

    private var actions: some View {
        VStack(spacing: 10) {
            Button {
                Feedback.success(sound: settings.soundEnabled)
                onConfirm(count, damaged)
            } label: {
                Label(confirmLabel, systemImage: "checkmark")
            }
            .buttonStyle(PrimaryButtonStyle(tint: accentColor))

            HStack(spacing: 10) {
                Button(isAdjusting ? "Masquer le clavier" : "Saisir une autre quantité") {
                    isAdjusting.toggle()
                }
                .buttonStyle(SecondaryButtonStyle())

                Button("Annuler", role: .cancel) { onCancel() }
                    .buttonStyle(SecondaryButtonStyle())
                    .frame(width: 110)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 16)
        .background(.bar)
    }
}

/// Pavé numérique tactile — plus fiable qu'un clavier système avec des gants,
/// et il ne masque pas le titre du livre en cours.
struct NumberPad: View {
    @Binding var value: Int
    var maximum: Int = 999

    private let keys: [[String]] = [
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
        ["C", "0", "⌫"]
    ]

    var body: some View {
        VStack(spacing: 10) {
            ForEach(keys, id: \.self) { row in
                HStack(spacing: 10) {
                    ForEach(row, id: \.self) { key in
                        Button {
                            Feedback.tick()
                            press(key)
                        } label: {
                            Text(key)
                                .font(.title2.weight(.medium))
                                .frame(maxWidth: .infinity, minHeight: 52)
                                .background(Color(.secondarySystemGroupedBackground),
                                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func press(_ key: String) {
        switch key {
        case "C":
            value = 0
        case "⌫":
            value /= 10
        default:
            guard let digit = Int(key) else { return }
            let candidate = value * 10 + digit
            value = min(candidate, maximum)
        }
    }
}
