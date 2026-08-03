import Foundation
import UIKit

/// Orchestration de la lecture des pages : redimensionnement, double appel
/// Mistral, rapprochement, consolidation.
struct OCRPipeline {

    /// Taille d'envoi. 2400 px sur le grand côté suffit à lire un tableau dense
    /// tout en gardant la requête légère : au-delà, le coût monte sans gain de
    /// lecture mesurable.
    private static let maxDimension: CGFloat = 2400

    struct Progress {
        var pageIndex: Int
        var pageCount: Int
        var stage: String
    }

    var client: MistralClient
    var doubleCheck: Bool

    /// Lit toutes les pages et renvoie une session prête à être contrôlée.
    /// Les deux moteurs tournent en parallèle sur chaque page.
    func run(
        pages: [UIImage],
        onProgress: @MainActor @escaping (Progress) -> Void
    ) async throws -> CartonSession {

        var perPageLines: [[OrderLine]] = []
        var supplier = ""
        var reference = ""

        for (index, image) in pages.enumerated() {
            await onProgress(Progress(
                pageIndex: index,
                pageCount: pages.count,
                stage: doubleCheck ? "Double lecture de la page \(index + 1)…" : "Lecture de la page \(index + 1)…"
            ))

            let resized = image.resizedForUpload(maxDimension: Self.maxDimension)
            SessionStore.savePage(resized, at: index)
            guard let data = resized.jpegData(compressionQuality: 0.85) else { continue }

            let (pageA, pageB) = try await extract(data: data)

            if supplier.isEmpty { supplier = pageA.supplier }
            if reference.isEmpty { reference = pageA.reference }
            if supplier.isEmpty, let pageB { supplier = pageB.supplier }
            if reference.isEmpty, let pageB { reference = pageB.reference }

            perPageLines.append(Reconciler.reconcile(engineA: pageA, engineB: pageB, pageIndex: index))
        }

        await onProgress(Progress(pageIndex: pages.count, pageCount: pages.count, stage: "Consolidation…"))

        var session = CartonSession()
        session.supplier = supplier.trimmingCharacters(in: .whitespacesAndNewlines)
        session.reference = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        session.pageCount = pages.count
        session.lines = Reconciler.consolidate(perPageLines)

        guard !session.lines.isEmpty else { throw MistralClient.ClientError.emptyResult }

        SessionStore.save(session)
        return session
    }

    /// Lance les deux moteurs en parallèle. Si le moteur OCR échoue alors que
    /// le moteur vision répond, on ne bloque pas l'opérateur : on dégrade en
    /// simple lecture et chaque ligne porte alors la mention « source unique ».
    private func extract(data: Data) async throws -> (ExtractedPage, ExtractedPage?) {
        guard doubleCheck else {
            return (try await client.extractWithOCREngine(imageData: data), nil)
        }

        async let engineA = client.extractWithOCREngine(imageData: data)
        async let engineB = client.extractWithVisionEngine(imageData: data)

        var pageA: ExtractedPage?
        var pageB: ExtractedPage?
        var firstError: Error?

        do { pageA = try await engineA } catch { firstError = error }
        do { pageB = try await engineB } catch { firstError = firstError ?? error }

        switch (pageA, pageB) {
        case let (.some(a), .some(b)):
            return (a, b)
        case let (.some(a), .none):
            return (a, nil)
        case let (.none, .some(b)):
            return (b, nil)
        case (.none, .none):
            throw firstError ?? MistralClient.ClientError.emptyResult
        }
    }
}

extension UIImage {
    /// Redimensionne en conservant le ratio, sans jamais agrandir.
    func resizedForUpload(maxDimension: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxDimension, longest > 0 else { return self }

        let scale = maxDimension / longest
        let target = CGSize(width: size.width * scale, height: size.height * scale)

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }
}
