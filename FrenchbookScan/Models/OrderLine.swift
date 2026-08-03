import Foundation

/// Champ d'une ligne de bon de commande.
enum LineField: String, Codable, CaseIterable, Hashable {
    case isbn
    case title
    case author
    case quantityOrdered
    case quantityDelivered

    var label: String {
        switch self {
        case .isbn: return "ISBN"
        case .title: return "Titre"
        case .author: return "Auteur"
        case .quantityOrdered: return "Qté commandée"
        case .quantityDelivered: return "Qté livrée"
        }
    }
}

/// Raison pour laquelle une ligne doit passer devant les yeux d'un humain.
enum IssueKind: String, Codable, Hashable {
    /// Les deux moteurs OCR ne lisent pas la même chose.
    case conflict
    /// Un seul des deux moteurs a vu cette ligne.
    case singleSource
    /// La clé de contrôle de l'ISBN est fausse : au moins un chiffre est mal lu.
    case invalidChecksum
    /// Le même ISBN apparaissait plusieurs fois, les quantités ont été fusionnées.
    case merged
    /// Champ vide alors qu'il est obligatoire.
    case missing

    var label: String {
        switch self {
        case .conflict: return "Lecture divergente"
        case .singleSource: return "Vu par un seul moteur"
        case .invalidChecksum: return "Clé ISBN invalide"
        case .merged: return "Doublon fusionné"
        case .missing: return "Champ vide"
        }
    }
}

/// Un point de contrôle sur une ligne. Tant qu'il en reste un, le bon de
/// commande ne peut pas être validé.
struct FieldIssue: Codable, Hashable, Identifiable {
    var id = UUID()
    var field: LineField
    var kind: IssueKind
    /// Valeur proposée par le moteur OCR document.
    var candidateA: String
    /// Valeur proposée par le moteur vision.
    var candidateB: String
}

/// Une ligne du bon de commande papier, enrichie du comptage physique.
struct OrderLine: Identifiable, Codable, Hashable {
    var id = UUID()
    var isbn: String
    var title: String
    var author: String
    var quantityOrdered: Int
    var quantityDelivered: Int
    var pageIndex: Int
    var issues: [FieldIssue] = []

    // Renseignés pendant la phase de scan.
    var counted: Int = 0
    var damaged: Int = 0

    /// Ce qui doit physiquement se trouver dans le carton : la quantité que le
    /// fournisseur déclare avoir livrée, pas celle qui a été commandée.
    var expected: Int {
        quantityDelivered > 0 ? quantityDelivered : quantityOrdered
    }

    var isComplete: Bool { counted >= expected }
    var shortfall: Int { max(expected - counted, 0) }
    var surplus: Int { max(counted - expected, 0) }
    var needsReview: Bool { !issues.isEmpty }

    /// Écart entre ce qui a été commandé et ce que le fournisseur annonce livrer.
    var backorder: Int { max(quantityOrdered - quantityDelivered, 0) }

    var displayAuthor: String {
        author.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Auteur inconnu" : author
    }
}

/// Un livre trouvé dans le carton mais absent du bon de commande.
struct ExtraItem: Identifiable, Codable, Hashable {
    var id = UUID()
    var isbn: String
    var counted: Int = 1
    var damaged: Int = 0
}
