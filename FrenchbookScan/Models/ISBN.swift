import Foundation

/// Normalisation et validation des codes ISBN / EAN-13.
///
/// Toute la logique de contrôle repose sur la clé de contrôle : c'est elle qui
/// permet de détecter une erreur d'OCR sur un chiffre sans avoir le livre en main.
enum ISBN {

    /// Ne conserve que les chiffres (et le `X` final d'un ISBN-10),
    /// et convertit systématiquement en ISBN-13 pour pouvoir comparer
    /// un code lu sur le papier avec un code-barres scanné.
    static func normalize(_ raw: String) -> String {
        let cleaned = raw.uppercased().filter { $0.isNumber || $0 == "X" }
        if cleaned.count == 10, isValidISBN10(cleaned) {
            return convertToISBN13(cleaned)
        }
        return cleaned
    }

    static func isValid(_ raw: String) -> Bool {
        let cleaned = raw.uppercased().filter { $0.isNumber || $0 == "X" }
        switch cleaned.count {
        case 13: return isValidEAN13(cleaned)
        case 10: return isValidISBN10(cleaned)
        default: return false
        }
    }

    /// Affichage lisible : 978-2-07-036822-8
    static func formatted(_ raw: String) -> String {
        let c = normalize(raw)
        guard c.count == 13 else { return raw }
        let d = Array(c)
        return "\(String(d[0...2]))-\(d[3])-\(String(d[4...7]))-\(String(d[8...11]))-\(d[12])"
    }

    // MARK: - Clés de contrôle

    static func isValidEAN13(_ code: String) -> Bool {
        guard code.count == 13 else { return false }
        let digits = code.compactMap { $0.wholeNumberValue }
        guard digits.count == 13 else { return false }
        var sum = 0
        for (index, digit) in digits.prefix(12).enumerated() {
            sum += index.isMultiple(of: 2) ? digit : digit * 3
        }
        return (10 - sum % 10) % 10 == digits[12]
    }

    static func isValidISBN10(_ code: String) -> Bool {
        guard code.count == 10 else { return false }
        var sum = 0
        for (index, character) in code.enumerated() {
            let value: Int
            if character == "X" {
                guard index == 9 else { return false }
                value = 10
            } else if let digit = character.wholeNumberValue {
                value = digit
            } else {
                return false
            }
            sum += value * (10 - index)
        }
        return sum % 11 == 0
    }

    private static func convertToISBN13(_ isbn10: String) -> String {
        let core = "978" + isbn10.prefix(9)
        let digits = core.compactMap { $0.wholeNumberValue }
        var sum = 0
        for (index, digit) in digits.enumerated() {
            sum += index.isMultiple(of: 2) ? digit : digit * 3
        }
        return core + String((10 - sum % 10) % 10)
    }

    // MARK: - Codes-barres

    /// Les livres portent parfois un EAN-13 « libraire » préfixé 977/979 ou un
    /// code produit non-ISBN. On accepte tout EAN-13 valide : c'est le
    /// rapprochement avec le bon de commande qui tranche.
    static func isBookLikeBarcode(_ code: String) -> Bool {
        let cleaned = code.filter(\.isNumber)
        guard cleaned.count == 13 else { return false }
        return isValidEAN13(cleaned)
    }
}
