import Foundation
import UIKit

/// Persistance temporaire du carton en cours.
///
/// Tout vit dans `Caches/CurrentCarton/` : la session JSON et les pages JPEG.
/// Ce dossier est recréé à l'ouverture d'un carton et **entièrement supprimé**
/// à sa clôture. Il est exclu des sauvegardes iCloud : aucune donnée client ne
/// quitte l'appareil autrement que par l'export explicite de l'opérateur.
///
/// Le but n'est pas l'archivage mais la reprise sur incident : si l'app est
/// tuée en plein comptage d'un carton de 200 livres, on ne recommence pas.
enum SessionStore {

    private static let folderName = "CurrentCarton"
    private static let sessionFile = "session.json"

    private static var directory: URL {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return caches.appendingPathComponent(folderName, isDirectory: true)
    }

    // MARK: - Cycle de vie

    static func prepare() {
        purge()
        var url = directory
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)

        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    /// Efface tout : session, pages, exports temporaires. Appelé à la clôture
    /// d'un carton et à l'abandon d'un carton.
    static func purge() {
        try? FileManager.default.removeItem(at: directory)
    }

    // MARK: - Session

    static func save(_ session: CartonSession) {
        ensureDirectory()
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        guard let data = try? encoder.encode(session) else { return }
        try? data.write(to: directory.appendingPathComponent(sessionFile), options: .atomic)
    }

    static func loadSession() -> CartonSession? {
        let url = directory.appendingPathComponent(sessionFile)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(CartonSession.self, from: data)
    }

    // MARK: - Pages du bon de commande

    static func pageURL(_ index: Int) -> URL {
        directory.appendingPathComponent("page-\(index).jpg")
    }

    @discardableResult
    static func savePage(_ image: UIImage, at index: Int) -> Data? {
        ensureDirectory()
        guard let data = image.jpegData(compressionQuality: 0.85) else { return nil }
        try? data.write(to: pageURL(index), options: .atomic)
        return data
    }

    static func loadPage(_ index: Int) -> UIImage? {
        guard let data = try? Data(contentsOf: pageURL(index)) else { return nil }
        return UIImage(data: data)
    }

    /// Dossier de travail pour les exports (PDF/CSV), purgé avec le reste.
    static func exportURL(named name: String) -> URL {
        ensureDirectory()
        return directory.appendingPathComponent(name)
    }

    private static func ensureDirectory() {
        if !FileManager.default.fileExists(atPath: directory.path) {
            prepare()
        }
    }
}
