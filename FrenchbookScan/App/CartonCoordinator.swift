import Foundation
import SwiftUI

/// Machine à états du poste de réception.
///
/// attente → capture du bon → lecture OCR → contrôle → scan des livres →
/// récapitulatif → clôture (purge) → attente.
@MainActor
final class CartonCoordinator: ObservableObject {

    enum Phase: Equatable {
        case idle
        case processing
        case review
        case scanning
        case summary
    }

    @Published private(set) var phase: Phase = .idle
    @Published var session = CartonSession()
    @Published private(set) var progress: OCRPipeline.Progress?
    @Published var errorMessage: String?
    @Published private(set) var exportURLs: [URL] = []

    /// Vrai si un carton interrompu a été retrouvé dans le cache au lancement.
    @Published private(set) var hasRecoverableSession = false

    private let settings: AppSettings

    init(settings: AppSettings) {
        self.settings = settings
        if let recovered = SessionStore.loadSession(), !recovered.lines.isEmpty {
            session = recovered
            hasRecoverableSession = true
        }
    }

    // MARK: - Reprise après interruption

    func resumeRecoveredSession() {
        hasRecoverableSession = false
        phase = session.isReviewComplete ? .scanning : .review
    }

    func discardRecoveredSession() {
        hasRecoverableSession = false
        reset()
    }

    // MARK: - Phase 1 — lecture du bon de commande

    func processPages(_ pages: [UIImage]) async {
        guard !pages.isEmpty else { return }
        guard settings.isConfigured else {
            errorMessage = MistralClient.ClientError.missingKey.localizedDescription
            return
        }

        SessionStore.prepare()
        phase = .processing
        errorMessage = nil
        progress = OCRPipeline.Progress(pageIndex: 0, pageCount: pages.count, stage: "Préparation…")

        let pipeline = OCRPipeline(client: settings.makeClient(), doubleCheck: settings.doubleCheckEnabled)

        do {
            let result = try await pipeline.run(pages: pages) { [weak self] update in
                self?.progress = update
            }
            session = result
            progress = nil
            phase = .review
        } catch {
            progress = nil
            errorMessage = error.localizedDescription
            phase = .idle
            SessionStore.purge()
        }
    }

    // MARK: - Phase 2 — contrôle des lignes

    func resolveIssues(for lineID: OrderLine.ID, with updated: OrderLine) {
        guard let index = session.lines.firstIndex(where: { $0.id == lineID }) else { return }
        session.lines[index] = updated
        session.lines[index].issues = []
        persist()
    }

    func deleteLine(_ lineID: OrderLine.ID) {
        session.lines.removeAll { $0.id == lineID }
        persist()
    }

    func addManualLine() -> OrderLine {
        let line = OrderLine(
            isbn: "", title: "", author: "",
            quantityOrdered: 1, quantityDelivered: 1,
            pageIndex: 0,
            issues: [FieldIssue(field: .isbn, kind: .missing, candidateA: "", candidateB: "")]
        )
        session.lines.append(line)
        persist()
        return line
    }

    func validateOrder() {
        guard session.isReviewComplete else { return }
        phase = .scanning
        persist()
    }

    // MARK: - Phase 3 — comptage physique

    enum ScanOutcome: Equatable {
        /// Quantité attendue de 1 : validé d'office, court flash de confirmation.
        case autoConfirmed(OrderLine)
        /// Quantité attendue > 1 : demande de confirmation à l'opérateur.
        case needsQuantity(OrderLine)
        /// Ligne déjà complète : nouveau scan = surplus à arbitrer.
        case alreadyComplete(OrderLine)
        /// Code absent du bon de commande.
        case unknown(String)
    }

    func handleScan(_ code: String) -> ScanOutcome {
        let normalized = ISBN.normalize(code)

        guard let index = session.lineIndex(forISBN: normalized) else {
            return .unknown(normalized)
        }

        let line = session.lines[index]

        if line.isComplete {
            return .alreadyComplete(line)
        }

        if line.expected == 1 {
            session.lines[index].counted = 1
            persist()
            return .autoConfirmed(session.lines[index])
        }

        return .needsQuantity(line)
    }

    /// Enregistre la quantité confirmée par l'opérateur pour une ligne.
    func setCount(_ count: Int, damaged: Int, for lineID: OrderLine.ID) {
        guard let index = session.lines.firstIndex(where: { $0.id == lineID }) else { return }
        session.lines[index].counted = max(count, 0)
        session.lines[index].damaged = max(damaged, 0)
        persist()
    }

    func markDamaged(_ count: Int, for lineID: OrderLine.ID) {
        guard let index = session.lines.firstIndex(where: { $0.id == lineID }) else { return }
        session.lines[index].damaged = max(count, 0)
        persist()
    }

    func recordExtra(isbn: String, count: Int = 1) {
        let normalized = ISBN.normalize(isbn)
        if let index = session.extraIndex(forISBN: normalized) {
            session.extras[index].counted += count
        } else {
            session.extras.append(ExtraItem(isbn: normalized, counted: count))
        }
        persist()
    }

    func removeExtra(_ id: ExtraItem.ID) {
        session.extras.removeAll { $0.id == id }
        persist()
    }

    // MARK: - Phase 4 — récapitulatif et clôture

    func requestSummary() {
        phase = .summary
    }

    func returnToScanning() {
        phase = .scanning
    }

    /// Prépare les fichiers d'export. Ils vivent dans le cache et disparaissent
    /// avec lui à la clôture : l'opérateur les partage maintenant ou jamais.
    func prepareExport() {
        exportURLs = Exporter.makeFiles(for: session)
    }

    /// Clôture définitive : purge totale du cache et retour à l'attente.
    func closeCarton() {
        reset()
    }

    func abandonCarton() {
        reset()
    }

    private func reset() {
        SessionStore.purge()
        session = CartonSession()
        exportURLs = []
        progress = nil
        errorMessage = nil
        phase = .idle
    }

    private func persist() {
        SessionStore.save(session)
    }
}
