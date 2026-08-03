import Foundation

/// L'unité de travail de l'app : un carton, son bon de commande et son comptage.
/// Vit dans le cache le temps du traitement, purgé à la clôture.
struct CartonSession: Codable, Identifiable {
    var id = UUID()
    var startedAt = Date()
    var supplier: String = ""
    var reference: String = ""
    var pageCount: Int = 0
    var lines: [OrderLine] = []
    var extras: [ExtraItem] = []

    // MARK: - Contrôle du bon de commande

    var linesNeedingReview: [OrderLine] { lines.filter(\.needsReview) }
    var reviewCount: Int { linesNeedingReview.count }
    var isReviewComplete: Bool { reviewCount == 0 }

    // MARK: - Avancement du scan

    var totalExpected: Int { lines.reduce(0) { $0 + $1.expected } }
    var totalCounted: Int { lines.reduce(0) { $0 + min($1.counted, $1.expected) } }
    var totalExtras: Int { extras.reduce(0) { $0 + $1.counted } }
    var totalDamaged: Int { lines.reduce(0) { $0 + $1.damaged } + extras.reduce(0) { $0 + $1.damaged } }

    var progress: Double {
        guard totalExpected > 0 else { return 0 }
        return Double(totalCounted) / Double(totalExpected)
    }

    // MARK: - Anomalies pour le récapitulatif

    var missingLines: [OrderLine] { lines.filter { $0.shortfall > 0 } }
    var surplusLines: [OrderLine] { lines.filter { $0.surplus > 0 } }
    var damagedLines: [OrderLine] { lines.filter { $0.damaged > 0 } }
    var backorderedLines: [OrderLine] { lines.filter { $0.backorder > 0 } }

    var hasAnomalies: Bool {
        !missingLines.isEmpty || !surplusLines.isEmpty || !damagedLines.isEmpty || !extras.isEmpty
    }

    var isFullyScanned: Bool { missingLines.isEmpty && surplusLines.isEmpty && extras.isEmpty }

    // MARK: - Mutations

    func lineIndex(forISBN isbn: String) -> Int? {
        let target = ISBN.normalize(isbn)
        return lines.firstIndex { ISBN.normalize($0.isbn) == target }
    }

    func extraIndex(forISBN isbn: String) -> Int? {
        let target = ISBN.normalize(isbn)
        return extras.firstIndex { ISBN.normalize($0.isbn) == target }
    }

    var displayTitle: String {
        let name = supplier.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "Carton en cours" : name
    }
}
