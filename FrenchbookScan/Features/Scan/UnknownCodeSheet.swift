import SwiftUI

/// Un code lu ne figure pas au bon de commande.
///
/// Deux causes possibles, toutes deux normales : le fournisseur a glissé un
/// livre non commandé, ou l'ISBN a été mal lu sur le papier. On ne tranche pas
/// à la place de l'opérateur — on enregistre l'écart pour le récapitulatif.
struct UnknownCodeSheet: View {
    let code: String
    let onRecord: () -> Void
    let onIgnore: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "questionmark.circle.fill")
                .font(.system(size: 44))
                .foregroundStyle(Theme.warning)
                .padding(.top, 24)

            VStack(spacing: 6) {
                Text("Livre absent du bon")
                    .font(.headline)
                Text(ISBN.formatted(code))
                    .font(.title3.monospaced())
                    .textSelection(.enabled)
            }

            Text("Ce code ne correspond à aucune ligne du bon de commande. Enregistrez-le comme livre hors commande, ou ignorez-le si c'est une erreur de scan.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            Spacer(minLength: 0)

            VStack(spacing: 10) {
                Button {
                    onRecord()
                } label: {
                    Label("Enregistrer hors commande", systemImage: "plus.circle")
                }
                .buttonStyle(PrimaryButtonStyle(tint: Theme.warning))

                Button("Ignorer ce scan", role: .cancel) { onIgnore() }
                    .buttonStyle(SecondaryButtonStyle())
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .background(Color(.systemGroupedBackground))
    }
}
