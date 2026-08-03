import SwiftUI

@main
struct FrenchbookScanApp: App {
    @StateObject private var settings: AppSettings
    @StateObject private var coordinator: CartonCoordinator

    init() {
        let settings = AppSettings()
        _settings = StateObject(wrappedValue: settings)
        _coordinator = StateObject(wrappedValue: CartonCoordinator(settings: settings))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(settings)
                .environmentObject(coordinator)
        }
    }
}
