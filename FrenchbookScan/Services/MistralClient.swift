import Foundation
import UIKit

/// Ligne brute telle que renvoyée par un moteur d'extraction, avant
/// rapprochement. Tolérante : les modèles renvoient parfois un nombre en
/// chaîne, ou `null` sur une cellule vide.
struct ExtractedLine: Codable, Hashable {
    var isbn: String
    var title: String
    var author: String
    var quantityOrdered: Int
    var quantityDelivered: Int

    enum CodingKeys: String, CodingKey {
        case isbn, title, author
        case quantityOrdered = "quantity_ordered"
        case quantityDelivered = "quantity_delivered"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        isbn = Self.string(container, .isbn)
        title = Self.string(container, .title)
        author = Self.string(container, .author)
        quantityOrdered = Self.int(container, .quantityOrdered) ?? 0
        quantityDelivered = Self.int(container, .quantityDelivered) ?? 0
    }

    init(isbn: String, title: String, author: String, quantityOrdered: Int, quantityDelivered: Int) {
        self.isbn = isbn
        self.title = title
        self.author = author
        self.quantityOrdered = quantityOrdered
        self.quantityDelivered = quantityDelivered
    }

    private static func string(_ container: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> String {
        if let value = try? container.decodeIfPresent(String.self, forKey: key) { return value }
        if let value = try? container.decodeIfPresent(Int.self, forKey: key) { return String(value) }
        if let value = try? container.decodeIfPresent(Double.self, forKey: key) { return String(Int(value)) }
        return ""
    }

    private static func int(_ container: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> Int? {
        if let value = try? container.decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? container.decodeIfPresent(Double.self, forKey: key) { return Int(value) }
        if let value = try? container.decodeIfPresent(String.self, forKey: key) {
            return Int(value.filter(\.isNumber))
        }
        return nil
    }
}

/// Résultat d'extraction pour une page.
struct ExtractedPage: Codable, Hashable {
    var supplier: String
    var reference: String
    var lines: [ExtractedLine]

    enum CodingKeys: String, CodingKey {
        case supplier, reference, lines
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        supplier = ((try? container.decodeIfPresent(String.self, forKey: .supplier)) ?? nil) ?? ""
        reference = ((try? container.decodeIfPresent(String.self, forKey: .reference)) ?? nil) ?? ""
        lines = ((try? container.decodeIfPresent([ExtractedLine].self, forKey: .lines)) ?? nil) ?? []
    }

    init(supplier: String = "", reference: String = "", lines: [ExtractedLine] = []) {
        self.supplier = supplier
        self.reference = reference
        self.lines = lines
    }
}

/// Accès à l'API Mistral. Deux moteurs indépendants sont exposés : leurs
/// résultats sont croisés par le `Reconciler`.
struct MistralClient {
    var apiKey: String
    var ocrModel: String
    var visionModel: String
    var urlSession: URLSession = .shared

    private static let baseURL = URL(string: "https://api.mistral.ai/v1")!

    enum ClientError: LocalizedError {
        case missingKey
        case http(status: Int, body: String)
        case malformedResponse(String)
        case emptyResult

        var errorDescription: String? {
            switch self {
            case .missingKey:
                return "Aucune clé API Mistral n'est enregistrée. Ouvrez les Réglages de l'app."
            case .http(let status, let body):
                if status == 401 { return "Clé API refusée (401). Vérifiez la clé dans les Réglages." }
                if status == 429 { return "Trop de requêtes (429). Patientez quelques secondes." }
                return "Erreur Mistral \(status) : \(body.prefix(200))"
            case .malformedResponse(let detail):
                return "Réponse illisible du moteur : \(detail)"
            case .emptyResult:
                return "Le moteur n'a détecté aucune ligne sur cette page."
            }
        }
    }

    // MARK: - Schéma d'extraction partagé par les deux moteurs

    /// Schéma JSON strict imposé aux deux moteurs pour qu'ils renvoient
    /// exactement la même forme et soient comparables champ à champ.
    static var extractionSchema: [String: Any] {
        [
            "type": "object",
            "title": "PurchaseOrderPage",
            "properties": [
                "supplier": [
                    "type": "string",
                    "description": "Nom du fournisseur / éditeur figurant sur le bon. Chaîne vide si absent."
                ],
                "reference": [
                    "type": "string",
                    "description": "Numéro ou référence du bon de commande. Chaîne vide si absent."
                ],
                "lines": [
                    "type": "array",
                    "description": "Une entrée par ligne de livre du tableau, dans l'ordre du document.",
                    "items": [
                        "type": "object",
                        "properties": [
                            "isbn": [
                                "type": "string",
                                "description": "ISBN ou EAN, chiffres uniquement, sans tiret ni espace."
                            ],
                            "title": ["type": "string", "description": "Titre du livre, tel qu'imprimé."],
                            "author": ["type": "string", "description": "Auteur. Chaîne vide si la colonne n'existe pas."],
                            "quantity_ordered": ["type": "integer", "description": "Quantité commandée. 0 si absent."],
                            "quantity_delivered": ["type": "integer", "description": "Quantité livrée/servie. 0 si absent."]
                        ],
                        "required": ["isbn", "title", "author", "quantity_ordered", "quantity_delivered"],
                        "additionalProperties": false
                    ]
                ]
            ],
            "required": ["supplier", "reference", "lines"],
            "additionalProperties": false
        ]
    }

    static let instruction = """
    Tu extrais le tableau d'un bon de commande de livres, en français.

    Règles impératives :
    - Une entrée du tableau `lines` par ligne de livre imprimée, dans l'ordre du document.
    - N'invente jamais une valeur. Si une cellule est vide, illisible ou barrée, renvoie une chaîne vide (ou 0 pour un nombre).
    - Ne complète pas un ISBN de mémoire : recopie strictement les chiffres visibles.
    - `isbn` : chiffres uniquement, tirets et espaces retirés.
    - `quantity_ordered` : la colonne « commandé / cdé / qté cde ».
    - `quantity_delivered` : la colonne « livré / servi / expédié ». Si une seule colonne de quantité existe, mets la même valeur dans les deux.
    - Ignore les en-têtes, totaux, pieds de page, mentions légales et lignes de sous-total.
    - Les mentions manuscrites (rayures, annotations, « manque », « en attente ») ne changent pas les chiffres imprimés : recopie l'imprimé.
    """

    // MARK: - Moteur A — endpoint OCR document

    func extractWithOCREngine(imageData: Data) async throws -> ExtractedPage {
        let body: [String: Any] = [
            "model": ocrModel,
            "document": [
                "type": "image_url",
                "image_url": Self.dataURL(for: imageData)
            ],
            "include_image_base64": false,
            "document_annotation_format": [
                "type": "json_schema",
                "json_schema": [
                    "name": "purchase_order_page",
                    "schema": Self.extractionSchema,
                    "strict": true
                ]
            ]
        ]

        let data = try await post(path: "ocr", body: body)

        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ClientError.malformedResponse("enveloppe OCR")
        }

        // L'annotation revient sous forme de chaîne JSON à décoder une seconde fois.
        if let annotation = root["document_annotation"] as? String,
           let page = try? Self.decodePage(from: Data(annotation.utf8)) {
            return page
        }
        if let annotation = root["document_annotation"] as? [String: Any],
           let nested = try? JSONSerialization.data(withJSONObject: annotation),
           let page = try? Self.decodePage(from: nested) {
            return page
        }

        // Repli : certaines réponses ne portent que le markdown des pages.
        // On le repasse au moteur vision plutôt que de parser du markdown à la main.
        throw ClientError.malformedResponse("annotation absente de la réponse OCR")
    }

    // MARK: - Moteur B — modèle vision + sortie structurée

    func extractWithVisionEngine(imageData: Data) async throws -> ExtractedPage {
        let body: [String: Any] = [
            "model": visionModel,
            "temperature": 0,
            "messages": [
                [
                    "role": "user",
                    "content": [
                        ["type": "text", "text": Self.instruction],
                        ["type": "image_url", "image_url": Self.dataURL(for: imageData)]
                    ]
                ]
            ],
            "response_format": [
                "type": "json_schema",
                "json_schema": [
                    "name": "purchase_order_page",
                    "schema": Self.extractionSchema,
                    "strict": true
                ]
            ]
        ]

        let data = try await post(path: "chat/completions", body: body)

        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = root["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any]
        else {
            throw ClientError.malformedResponse("enveloppe chat")
        }

        let content: String
        if let text = message["content"] as? String {
            content = text
        } else if let parts = message["content"] as? [[String: Any]] {
            content = parts.compactMap { $0["text"] as? String }.joined()
        } else {
            throw ClientError.malformedResponse("contenu vide")
        }

        return try Self.decodePage(from: Data(content.utf8))
    }

    // MARK: - Transport

    private func post(path: String, body: [String: Any]) async throws -> Data {
        guard !apiKey.isEmpty else { throw ClientError.missingKey }

        var request = URLRequest(url: Self.baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 120

        let (data, response) = try await urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ClientError.malformedResponse("réponse non HTTP")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ClientError.http(status: http.statusCode, body: String(decoding: data, as: UTF8.self))
        }
        return data
    }

    private static func decodePage(from data: Data) throws -> ExtractedPage {
        do {
            return try JSONDecoder().decode(ExtractedPage.self, from: data)
        } catch {
            // Certains modèles encadrent le JSON de balises markdown.
            let raw = String(decoding: data, as: UTF8.self)
            guard let start = raw.firstIndex(of: "{"), let end = raw.lastIndex(of: "}") else {
                throw ClientError.malformedResponse(String(raw.prefix(160)))
            }
            let slice = String(raw[start...end])
            return try JSONDecoder().decode(ExtractedPage.self, from: Data(slice.utf8))
        }
    }

    private static func dataURL(for imageData: Data) -> String {
        "data:image/jpeg;base64," + imageData.base64EncodedString()
    }
}
