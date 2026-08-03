import SwiftUI

/// Arbitrage d'une ligne douteuse.
///
/// L'opérateur voit la photo de la page au-dessus du formulaire : trancher
/// entre deux lectures sans pouvoir consulter l'original ne serait qu'un
/// tirage au sort. Quand les deux moteurs divergent, les deux valeurs sont
/// proposées en un geste ; sinon le champ reste librement modifiable.
struct LineEditorView: View {
    let line: OrderLine
    let onSave: (OrderLine) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var isbn: String
    @State private var title: String
    @State private var author: String
    @State private var quantityOrdered: Int
    @State private var quantityDelivered: Int
    @State private var pageImage: UIImage?
    @State private var showFullPage = false

    init(line: OrderLine, onSave: @escaping (OrderLine) -> Void) {
        self.line = line
        self.onSave = onSave
        _isbn = State(initialValue: line.isbn)
        _title = State(initialValue: line.title)
        _author = State(initialValue: line.author)
        _quantityOrdered = State(initialValue: line.quantityOrdered)
        _quantityDelivered = State(initialValue: line.quantityDelivered)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let pageImage {
                    Section {
                        Button {
                            showFullPage = true
                        } label: {
                            Image(uiImage: pageImage)
                                .resizable()
                                .scaledToFit()
                                .frame(maxHeight: 220)
                                .frame(maxWidth: .infinity)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .overlay(alignment: .bottomTrailing) {
                                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                                        .font(.caption.weight(.bold))
                                        .padding(6)
                                        .background(.ultraThinMaterial, in: Circle())
                                        .padding(8)
                                }
                        }
                        .buttonStyle(.plain)
                    } header: {
                        Text("Page \(line.pageIndex + 1) du bon")
                    } footer: {
                        Text("Touchez la photo pour l'agrandir et zoomer sur la ligne.")
                    }
                }

                Section("ISBN") {
                    TextField("ISBN / EAN", text: $isbn)
                        .keyboardType(.numbersAndPunctuation)
                        .font(.body.monospaced())
                        .autocorrectionDisabled()

                    isbnStatus
                    candidateChips(for: .isbn) { isbn = ISBN.normalize($0) }
                }

                Section("Livre") {
                    TextField("Titre", text: $title, axis: .vertical)
                        .lineLimit(1...3)
                    candidateChips(for: .title) { title = $0 }

                    TextField("Auteur", text: $author)
                    candidateChips(for: .author) { author = $0 }
                }

                Section {
                    Stepper(value: $quantityOrdered, in: 0...999) {
                        LabeledContent("Quantité commandée", value: "\(quantityOrdered)")
                    }
                    candidateChips(for: .quantityOrdered) { quantityOrdered = Int($0.filter(\.isNumber)) ?? quantityOrdered }

                    Stepper(value: $quantityDelivered, in: 0...999) {
                        LabeledContent("Quantité livrée", value: "\(quantityDelivered)")
                    }
                    candidateChips(for: .quantityDelivered) { quantityDelivered = Int($0.filter(\.isNumber)) ?? quantityDelivered }
                } header: {
                    Text("Quantités")
                } footer: {
                    if quantityDelivered < quantityOrdered {
                        Text("Reliquat de \(quantityOrdered - quantityDelivered) exemplaire(s) : le fournisseur en livre moins que commandé. Le scan attendra \(quantityDelivered) exemplaire(s).")
                    } else {
                        Text("Le scan comptera \(max(quantityDelivered, quantityOrdered)) exemplaire(s) pour ce titre.")
                    }
                }
            }
            .navigationTitle("Vérifier la ligne")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Confirmer") { save() }
                        .fontWeight(.semibold)
                        .disabled(!canSave)
                }
            }
            .task { pageImage = SessionStore.loadPage(line.pageIndex) }
            .fullScreenCover(isPresented: $showFullPage) {
                if let pageImage {
                    ZoomablePageView(image: pageImage)
                }
            }
        }
    }

    // MARK: - Contrôles

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty
            && ISBN.isValid(isbn)
            && (quantityOrdered > 0 || quantityDelivered > 0)
    }

    @ViewBuilder
    private var isbnStatus: some View {
        if isbn.isEmpty {
            statusLine("Saisissez l'ISBN relevé sur le bon.", icon: "info.circle", color: .secondary)
        } else if ISBN.isValid(isbn) {
            statusLine("Clé de contrôle valide.", icon: "checkmark.circle.fill", color: Theme.ok)
        } else {
            statusLine("Clé de contrôle invalide — au moins un chiffre est erroné.",
                       icon: "xmark.octagon.fill", color: Theme.danger)
        }
    }

    private func statusLine(_ text: String, icon: String, color: Color) -> some View {
        Label(text, systemImage: icon)
            .font(.footnote)
            .foregroundStyle(color)
    }

    private func conflict(for field: LineField) -> FieldIssue? {
        line.issues.first { $0.field == field && $0.kind == .conflict }
    }

    private func singleSource(for field: LineField) -> FieldIssue? {
        line.issues.first { $0.field == field && $0.kind == .singleSource }
    }

    /// Propose en un geste les deux lectures divergentes pour ce champ.
    @ViewBuilder
    private func candidateChips(for field: LineField, apply: @escaping (String) -> Void) -> some View {
        if let issue = conflict(for: field) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Les deux lectures diffèrent :")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    candidateButton("Lecture 1", issue.candidateA, apply: apply)
                    candidateButton("Lecture 2", issue.candidateB, apply: apply)
                }
            }
        } else if let missing = singleSource(for: field) {
            Text("Ligne vue par une seule lecture — confirmez-la sur la photo. (\(missing.candidateB))")
                .font(.caption)
                .foregroundStyle(Theme.warning)
        }
    }

    private func candidateButton(_ label: String, _ value: String, apply: @escaping (String) -> Void) -> some View {
        Button {
            Feedback.tick()
            apply(value)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(value.isEmpty ? "(vide)" : value)
                    .font(.footnote.weight(.medium))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func save() {
        var updated = line
        updated.isbn = ISBN.normalize(isbn)
        updated.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.author = author.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.quantityOrdered = quantityOrdered
        updated.quantityDelivered = quantityDelivered
        onSave(updated)
        dismiss()
    }
}

/// Visionneuse plein écran zoomable de la page du bon.
struct ZoomablePageView: View {
    let image: UIImage
    @Environment(\.dismiss) private var dismiss

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .scaleEffect(scale)
                .offset(offset)
                .gesture(
                    SimultaneousGesture(
                        MagnificationGesture()
                            .onChanged { value in scale = min(max(lastScale * value, 1), 8) }
                            .onEnded { _ in lastScale = scale },
                        DragGesture()
                            .onChanged { value in
                                offset = CGSize(
                                    width: lastOffset.width + value.translation.width,
                                    height: lastOffset.height + value.translation.height
                                )
                            }
                            .onEnded { _ in lastOffset = offset }
                    )
                )
                .onTapGesture(count: 2) {
                    withAnimation(.spring(response: 0.3)) {
                        if scale > 1 {
                            scale = 1; lastScale = 1; offset = .zero; lastOffset = .zero
                        } else {
                            scale = 3; lastScale = 3
                        }
                    }
                }

            VStack {
                HStack {
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.headline)
                            .foregroundStyle(.white)
                            .padding(12)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .padding()
                }
                Spacer()
            }
        }
    }
}
