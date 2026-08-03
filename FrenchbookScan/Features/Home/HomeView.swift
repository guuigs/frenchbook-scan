import SwiftUI
import PhotosUI

/// Écran d'attente : le poste est prêt à recevoir un nouveau carton.
struct HomeView: View {
    @EnvironmentObject private var coordinator: CartonCoordinator
    @EnvironmentObject private var settings: AppSettings

    @State private var isCapturing = false
    @State private var showSettings = false
    @State private var photoSelection: [PhotosPickerItem] = []

    /// Le scanner de documents n'existe pas dans le simulateur : l'import
    /// photothèque y devient le seul chemin d'entrée.
    private var documentScannerAvailable: Bool {
        #if targetEnvironment(simulator)
        false
        #else
        true
        #endif
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    header

                    if !settings.isConfigured {
                        configurationNotice
                    }

                    VStack(spacing: 10) {
                        if documentScannerAvailable {
                            Button {
                                isCapturing = true
                            } label: {
                                Label("Photographier le bon de commande", systemImage: "doc.viewfinder")
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(!settings.isConfigured)

                            // Utile quand le bon arrive déjà en photo, par mail
                            // ou depuis un autre appareil.
                            photoPicker("Importer depuis la photothèque")
                                .buttonStyle(SecondaryButtonStyle())
                        } else {
                            photoPicker("Importer les pages du bon")
                                .buttonStyle(PrimaryButtonStyle())
                        }
                    }

                    steps
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Réception")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Réglages")
                }
            }
        }
        .fullScreenCover(isPresented: $isCapturing) {
            DocumentCameraView(
                onFinish: { pages in
                    isCapturing = false
                    Task { await coordinator.processPages(pages) }
                },
                onCancel: { isCapturing = false }
            )
            .ignoresSafeArea()
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .alert("Lecture impossible", isPresented: .constant(coordinator.errorMessage != nil)) {
            Button("OK") { coordinator.errorMessage = nil }
        } message: {
            Text(coordinator.errorMessage ?? "")
        }
        .alert("Carton interrompu", isPresented: .constant(coordinator.hasRecoverableSession)) {
            Button("Reprendre") { coordinator.resumeRecoveredSession() }
            Button("Abandonner", role: .destructive) { coordinator.discardRecoveredSession() }
        } message: {
            Text("Un carton de \(coordinator.session.lines.count) titre(s) était en cours. Voulez-vous reprendre là où vous en étiez ?")
        }
    }

    /// L'ordre de sélection est conservé (`.ordered`) : les pages d'un bon ne
    /// sont pas interchangeables.
    private func photoPicker(_ label: String) -> some View {
        PhotosPicker(
            selection: $photoSelection,
            maxSelectionCount: 30,
            selectionBehavior: .ordered,
            matching: .images
        ) {
            Label(label, systemImage: "photo.on.rectangle")
        }
        .disabled(!settings.isConfigured)
        .onChange(of: photoSelection) { _, items in
            guard !items.isEmpty else { return }
            Task { await importPhotos(items) }
        }
    }

    private func importPhotos(_ items: [PhotosPickerItem]) async {
        var pages: [UIImage] = []
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self),
               let image = UIImage(data: data) {
                pages.append(image)
            }
        }
        photoSelection = []
        guard !pages.isEmpty else { return }
        await coordinator.processPages(pages)
    }

    private var header: some View {
        VStack(spacing: 12) {
            Image(systemName: "shippingbox")
                .font(.system(size: 52, weight: .light))
                .foregroundStyle(Theme.accent)
                .padding(.top, 16)

            Text("Aucun carton en cours")
                .font(.title3.weight(.semibold))

            Text("Commencez par photographier le bon de commande papier trouvé dans le carton.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
    }

    private var configurationNotice: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.warning)
            VStack(alignment: .leading, spacing: 4) {
                Text("Clé API manquante").font(.subheadline.weight(.semibold))
                Text("Renseignez votre clé Mistral dans les Réglages pour activer la lecture des bons.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Ouvrir les Réglages") { showSettings = true }
                    .font(.footnote.weight(.semibold))
                    .padding(.top, 2)
            }
            Spacer(minLength: 0)
        }
        .cardStyle()
    }

    private var steps: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Déroulé")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)

            stepRow(1, "doc.viewfinder", "Photographier le bon", "Une page après l'autre, la caméra recadre toute seule.")
            stepRow(2, "checkmark.rectangle.stack", "Contrôler la lecture", "Seules les lignes douteuses vous sont soumises.")
            stepRow(3, "barcode.viewfinder", "Scanner les livres", "La caméra reste active, les scans s'enchaînent.")
            stepRow(4, "checklist", "Clôturer le carton", "Récapitulatif des écarts, export, puis effacement.")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }

    private func stepRow(_ number: Int, _ icon: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(Theme.accent)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(number). \(title)").font(.subheadline.weight(.medium))
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}
