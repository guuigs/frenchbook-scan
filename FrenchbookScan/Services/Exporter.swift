import Foundation
import UIKit

/// Génère le récapitulatif de réception avant purge du cache.
///
/// Deux formats : un PDF lisible tel quel (à joindre à un litige fournisseur)
/// et un CSV réintégrable dans un tableur ou un ERP.
enum Exporter {

    static func makeFiles(for session: CartonSession) -> [URL] {
        var urls: [URL] = []
        if let pdf = makePDF(for: session) { urls.append(pdf) }
        if let csv = makeCSV(for: session) { urls.append(csv) }
        return urls
    }

    private static func fileStem(for session: CartonSession) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd_HHmm"
        let reference = session.reference.isEmpty ? "carton" : session.reference
        let safe = reference.replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "-", options: .regularExpression)
        return "reception_\(safe)_\(formatter.string(from: session.startedAt))"
    }

    // MARK: - CSV

    static func makeCSV(for session: CartonSession) -> URL? {
        var rows = [
            "ISBN;Titre;Auteur;Qte commandee;Qte annoncee livree;Qte comptee;Ecart;Abimes;Statut"
        ]

        for line in session.lines {
            let gap = line.counted - line.expected
            let status: String
            if line.shortfall > 0 { status = "MANQUE" }
            else if line.surplus > 0 { status = "SURPLUS" }
            else { status = "CONFORME" }

            rows.append([
                line.isbn,
                escape(line.title),
                escape(line.author),
                String(line.quantityOrdered),
                String(line.quantityDelivered),
                String(line.counted),
                String(gap),
                String(line.damaged),
                status
            ].joined(separator: ";"))
        }

        for extra in session.extras {
            rows.append([
                extra.isbn, "Non commande", "", "0", "0",
                String(extra.counted), "+\(extra.counted)", String(extra.damaged), "HORS BON"
            ].joined(separator: ";"))
        }

        let csv = rows.joined(separator: "\r\n")
        let url = SessionStore.exportURL(named: fileStem(for: session) + ".csv")
        // BOM UTF-8 : sans lui, Excel en français casse les accents.
        var data = Data([0xEF, 0xBB, 0xBF])
        data.append(Data(csv.utf8))
        try? data.write(to: url, options: .atomic)
        return url
    }

    private static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: ";", with: ",")
             .replacingOccurrences(of: "\n", with: " ")
    }

    /// Colonnes du PDF alignées en police à chasse fixe.
    private static func pad(_ value: String, _ width: Int) -> String {
        value.count >= width
            ? String(value.prefix(width - 1)) + " "
            : value + String(repeating: " ", count: width - value.count)
    }

    private static func padLeft(_ value: String, _ width: Int) -> String {
        value.count >= width ? value : String(repeating: " ", count: width - value.count) + value
    }

    // MARK: - PDF

    static func makePDF(for session: CartonSession) -> URL? {
        let pageSize = CGSize(width: 595, height: 842) // A4 à 72 dpi
        let margin: CGFloat = 40
        let url = SessionStore.exportURL(named: fileStem(for: session) + ".pdf")

        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: pageSize))

        let title = UIFont.systemFont(ofSize: 18, weight: .bold)
        let heading = UIFont.systemFont(ofSize: 11, weight: .semibold)
        let body = UIFont.systemFont(ofSize: 10, weight: .regular)
        let mono = UIFont.monospacedSystemFont(ofSize: 9, weight: .regular)

        do {
            try renderer.writePDF(to: url) { context in
                var y: CGFloat = margin
                context.beginPage()

                func newPageIfNeeded(_ needed: CGFloat) {
                    if y + needed > pageSize.height - margin {
                        context.beginPage()
                        y = margin
                    }
                }

                func draw(_ text: String, font: UIFont, color: UIColor = .black, x: CGFloat = margin, width: CGFloat? = nil) {
                    let maxWidth = width ?? (pageSize.width - 2 * margin)
                    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
                    let rect = CGRect(x: x, y: y, width: maxWidth, height: font.lineHeight * 3)
                    (text as NSString).draw(in: rect, withAttributes: attributes)
                }

                // En-tête
                draw("Bon de réception", font: title)
                y += 26

                let formatter = DateFormatter()
                formatter.dateStyle = .long
                formatter.timeStyle = .short
                formatter.locale = Locale(identifier: "fr_FR")

                draw("Fournisseur : \(session.supplier.isEmpty ? "—" : session.supplier)", font: body)
                y += 14
                draw("Référence : \(session.reference.isEmpty ? "—" : session.reference)", font: body)
                y += 14
                draw("Réceptionné le \(formatter.string(from: Date())) — \(session.pageCount) page(s) de bon", font: body, color: .darkGray)
                y += 22

                // Synthèse
                draw("Synthèse", font: heading)
                y += 16
                let summary = [
                    "Titres au bon : \(session.lines.count)",
                    "Exemplaires attendus : \(session.totalExpected)",
                    "Exemplaires comptés : \(session.totalCounted)",
                    "Manquants : \(session.missingLines.reduce(0) { $0 + $1.shortfall })",
                    "En surplus : \(session.surplusLines.reduce(0) { $0 + $1.surplus })",
                    "Abîmés : \(session.totalDamaged)",
                    "Hors bon de commande : \(session.totalExtras)"
                ]
                for item in summary {
                    draw("• " + item, font: body)
                    y += 13
                }
                y += 14

                // Détail
                draw("Détail des lignes", font: heading)
                y += 16

                let header = pad("ISBN", 15) + pad("Titre", 42)
                    + padLeft("Cdé", 6) + padLeft("Livr", 6) + padLeft("Cpté", 6) + padLeft("Abîmé", 7)
                draw(header, font: mono, color: .darkGray)
                y += 14

                for line in session.lines {
                    newPageIfNeeded(16)
                    let truncated = line.title.count > 40 ? String(line.title.prefix(39)) + "…" : line.title
                    let row = pad(line.isbn, 15) + pad(truncated, 42)
                        + padLeft(String(line.quantityOrdered), 6)
                        + padLeft(String(line.quantityDelivered), 6)
                        + padLeft(String(line.counted), 6)
                        + padLeft(String(line.damaged), 7)
                    let color: UIColor = line.shortfall > 0 ? .systemRed
                        : (line.surplus > 0 || line.damaged > 0 ? .systemOrange : .black)
                    draw(row, font: mono, color: color)
                    y += 12
                }

                if !session.extras.isEmpty {
                    y += 16
                    newPageIfNeeded(40)
                    draw("Livres hors bon de commande", font: heading)
                    y += 16
                    for extra in session.extras {
                        newPageIfNeeded(16)
                        draw("\(ISBN.formatted(extra.isbn))  ×\(extra.counted)", font: mono, color: .systemOrange)
                        y += 12
                    }
                }

                y += 24
                newPageIfNeeded(40)
                draw("Document généré par FrenchbookScan. Les données de ce carton ont été effacées de l'appareil après cet export.",
                     font: UIFont.systemFont(ofSize: 8), color: .gray)
            }
            return url
        } catch {
            return nil
        }
    }
}
