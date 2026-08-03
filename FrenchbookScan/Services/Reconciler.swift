import Foundation

/// Croise les lectures des deux moteurs OCR pour produire des lignes fiables.
///
/// Principe : ce qui est lu à l'identique par deux moteurs indépendants **et**
/// dont la clé ISBN est valide est considéré comme sûr. Tout le reste devient
/// un point de contrôle affiché à l'opérateur. On ne cherche pas à deviner :
/// on signale.
enum Reconciler {

    /// Seuil de similarité des titres pour apparier deux lignes sans ISBN commun.
    private static let titleMatchThreshold = 0.80

    static func reconcile(engineA: ExtractedPage, engineB: ExtractedPage?, pageIndex: Int) -> [OrderLine] {
        guard let engineB else {
            // Mode simple lecture : tout est marqué « source unique »,
            // seule la clé ISBN sert de garde-fou.
            return engineA.lines.map { line in
                var order = makeLine(from: line, pageIndex: pageIndex)
                order.issues.append(contentsOf: checksumIssues(for: order))
                return order
            }
        }

        var remainingB = engineB.lines
        var result: [OrderLine] = []

        for lineA in engineA.lines {
            guard let matchIndex = bestMatch(for: lineA, in: remainingB) else {
                var order = makeLine(from: lineA, pageIndex: pageIndex)
                order.issues.append(FieldIssue(
                    field: .title, kind: .singleSource,
                    candidateA: lineA.title, candidateB: "— absente de la 2ᵉ lecture —"
                ))
                order.issues.append(contentsOf: checksumIssues(for: order))
                result.append(order)
                continue
            }

            let lineB = remainingB.remove(at: matchIndex)
            result.append(merge(lineA, lineB, pageIndex: pageIndex))
        }

        // Lignes vues uniquement par le second moteur : le premier en a sauté une.
        for lineB in remainingB {
            var order = makeLine(from: lineB, pageIndex: pageIndex)
            order.issues.append(FieldIssue(
                field: .title, kind: .singleSource,
                candidateA: "— absente de la 1ʳᵉ lecture —", candidateB: lineB.title
            ))
            order.issues.append(contentsOf: checksumIssues(for: order))
            result.append(order)
        }

        return result
    }

    /// Fusionne les pages d'un même bon : additionne les doublons d'ISBN et
    /// signale la fusion pour qu'un humain confirme.
    static func consolidate(_ pages: [[OrderLine]]) -> [OrderLine] {
        var result: [OrderLine] = []

        for line in pages.flatMap({ $0 }) {
            let key = ISBN.normalize(line.isbn)
            if !key.isEmpty,
               let index = result.firstIndex(where: { ISBN.normalize($0.isbn) == key }) {
                result[index].quantityOrdered += line.quantityOrdered
                result[index].quantityDelivered += line.quantityDelivered
                result[index].issues.append(contentsOf: line.issues)
                result[index].issues.append(FieldIssue(
                    field: .quantityDelivered, kind: .merged,
                    candidateA: String(result[index].quantityDelivered),
                    candidateB: "cumul de 2 lignes"
                ))
            } else {
                result.append(line)
            }
        }
        return result
    }

    // MARK: - Comparaison champ à champ

    private static func merge(_ a: ExtractedLine, _ b: ExtractedLine, pageIndex: Int) -> OrderLine {
        var line = makeLine(from: a, pageIndex: pageIndex)
        var issues: [FieldIssue] = []

        if ISBN.normalize(a.isbn) != ISBN.normalize(b.isbn) {
            issues.append(FieldIssue(field: .isbn, kind: .conflict, candidateA: a.isbn, candidateB: b.isbn))
        }
        if normalizedText(a.title) != normalizedText(b.title) {
            issues.append(FieldIssue(field: .title, kind: .conflict, candidateA: a.title, candidateB: b.title))
        }
        if normalizedText(a.author) != normalizedText(b.author) {
            issues.append(FieldIssue(field: .author, kind: .conflict, candidateA: a.author, candidateB: b.author))
        }
        if a.quantityOrdered != b.quantityOrdered {
            issues.append(FieldIssue(
                field: .quantityOrdered, kind: .conflict,
                candidateA: String(a.quantityOrdered), candidateB: String(b.quantityOrdered)
            ))
        }
        if a.quantityDelivered != b.quantityDelivered {
            issues.append(FieldIssue(
                field: .quantityDelivered, kind: .conflict,
                candidateA: String(a.quantityDelivered), candidateB: String(b.quantityDelivered)
            ))
        }

        line.issues = issues + checksumIssues(for: line)
        return line
    }

    private static func makeLine(from extracted: ExtractedLine, pageIndex: Int) -> OrderLine {
        OrderLine(
            isbn: ISBN.normalize(extracted.isbn),
            title: extracted.title.trimmingCharacters(in: .whitespacesAndNewlines),
            author: extracted.author.trimmingCharacters(in: .whitespacesAndNewlines),
            quantityOrdered: max(extracted.quantityOrdered, 0),
            quantityDelivered: max(extracted.quantityDelivered, 0),
            pageIndex: pageIndex
        )
    }

    /// Contrôles qui ne dépendent pas de la comparaison entre moteurs.
    private static func checksumIssues(for line: OrderLine) -> [FieldIssue] {
        var issues: [FieldIssue] = []

        if line.isbn.isEmpty {
            issues.append(FieldIssue(field: .isbn, kind: .missing, candidateA: "", candidateB: ""))
        } else if !ISBN.isValid(line.isbn) {
            issues.append(FieldIssue(
                field: .isbn, kind: .invalidChecksum,
                candidateA: line.isbn, candidateB: ""
            ))
        }

        if line.title.isEmpty {
            issues.append(FieldIssue(field: .title, kind: .missing, candidateA: "", candidateB: ""))
        }

        if line.quantityOrdered == 0 && line.quantityDelivered == 0 {
            issues.append(FieldIssue(
                field: .quantityDelivered, kind: .missing,
                candidateA: "0", candidateB: ""
            ))
        }
        return issues
    }

    // MARK: - Appariement

    private static func bestMatch(for line: ExtractedLine, in candidates: [ExtractedLine]) -> Int? {
        let isbn = ISBN.normalize(line.isbn)
        if !isbn.isEmpty,
           let index = candidates.firstIndex(where: { ISBN.normalize($0.isbn) == isbn }) {
            return index
        }

        var bestIndex: Int?
        var bestScore = titleMatchThreshold
        for (index, candidate) in candidates.enumerated() {
            let score = similarity(normalizedText(line.title), normalizedText(candidate.title))
            if score > bestScore {
                bestScore = score
                bestIndex = index
            }
        }
        return bestIndex
    }

    /// Comparaison indulgente sur la casse, les accents, la ponctuation et les
    /// espaces multiples : une différence de « Éditions » vs « Editions » n'est
    /// pas une divergence de lecture qui mérite l'attention de l'opérateur.
    static func normalizedText(_ value: String) -> String {
        value
            .folding(options: [.diacriticInsensitive, .caseInsensitive, .widthInsensitive], locale: Locale(identifier: "fr_FR"))
            .replacingOccurrences(of: "[^a-z0-9 ]", with: " ", options: .regularExpression)
            .split(separator: " ")
            .joined(separator: " ")
    }

    /// Similarité de Levenshtein normalisée entre 0 et 1.
    static func similarity(_ lhs: String, _ rhs: String) -> Double {
        if lhs == rhs { return 1 }
        if lhs.isEmpty || rhs.isEmpty { return 0 }

        let a = Array(lhs)
        let b = Array(rhs)
        var previous = Array(0...b.count)
        var current = [Int](repeating: 0, count: b.count + 1)

        for i in 1...a.count {
            current[0] = i
            for j in 1...b.count {
                let cost = a[i - 1] == b[j - 1] ? 0 : 1
                current[j] = min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost)
            }
            previous = current
        }

        let distance = Double(previous[b.count])
        return 1 - distance / Double(max(a.count, b.count))
    }
}
