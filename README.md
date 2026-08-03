# FrenchbookScan

Application iOS de réception de cartons de livres à l'export.

Un carton arrive, un bon de commande papier est dedans. L'app le photographie,
le lit, vous fait contrôler ce qui est douteux, puis vous fait scanner les
livres un à un pour vérifier physiquement ce qui est réellement dans le carton.
À la clôture, elle produit un récapitulatif des écarts et efface tout.

---

## Le déroulé

| Phase | Écran | Ce qui se passe |
|---|---|---|
| 1. Capture | Scanner de documents iOS | Photo des pages du bon, recadrage et correction de perspective automatiques, multipage. |
| 2. Lecture | Écran de progression | Chaque page passe dans **deux moteurs Mistral indépendants**, les résultats sont comparés. |
| 3. Contrôle | Liste triée | Seules les lignes divergentes ou à ISBN invalide remontent. Photo de la page en regard pour trancher. |
| 4. Scan | Caméra permanente | Un scan par livre. Quantité 1 → flash de confirmation 1,4 s. Quantité > 1 → feuille de validation. |
| 5. Clôture | Récapitulatif | Manques, surplus, abîmés, hors commande. Export PDF + CSV, puis **purge totale**. |

## La fiabilité de lecture

C'est le point critique : une erreur d'OCR sur un ISBN ou une quantité passe
directement en litige fournisseur. Trois garde-fous se cumulent.

**Double lecture croisée.** Chaque page est envoyée en parallèle à deux moteurs
Mistral différents — l'endpoint OCR documentaire et un modèle vision — avec le
*même* schéma JSON strict, donc des sorties directement comparables champ à
champ. Deux moteurs qui se trompent au même endroit de la même façon, c'est
très improbable ; deux moteurs qui divergent, c'est un signal.

**Clé de contrôle ISBN.** Tout ISBN est validé par sa clé (EAN-13 ou ISBN-10,
converti en 13). Un chiffre mal lu casse la clé dans 9 cas sur 10 — l'app le
détecte même quand les deux moteurs lisent la même chose.

**Rien n'est deviné.** Là où un doute subsiste, l'app ne tranche jamais à votre
place : elle affiche les deux lectures côte à côte, avec la photo de la page,
et attend votre arbitrage. Le bouton de validation reste désactivé tant qu'il
reste une ligne à vérifier.

Le prompt impose par ailleurs aux modèles de renvoyer une valeur vide plutôt
que de compléter de mémoire — un ISBN plausible mais inventé serait le pire des
cas, puisqu'il passerait la clé de contrôle.

## Les données

Tout vit dans `Caches/CurrentCarton/` : le JSON de session et les pages JPEG.
Le dossier est exclu des sauvegardes iCloud, recréé à l'ouverture d'un carton
et **entièrement supprimé à la clôture**.

La persistance sert uniquement à la reprise sur incident : si l'app est tuée au
120ᵉ livre d'un carton de 200, elle propose de reprendre au relancement plutôt
que de tout recommencer.

L'export PDF + CSV est proposé au récapitulatif, avant la purge — c'est le seul
moment où les données peuvent quitter l'appareil, et uniquement par votre geste
via la feuille de partage iOS.

La clé API Mistral est stockée dans le Trousseau iOS
(`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` : jamais sauvegardée, jamais
migrée vers un autre appareil). Rien de secret n'est dans le code source.

## Installation

Prérequis : **Xcode 16+**, un iPhone sous **iOS 17+** (la caméra ne fonctionne
pas dans le simulateur).

```bash
open FrenchbookScan.xcodeproj
```

1. Onglet *Signing & Capabilities* → choisissez votre équipe de développement.
   Changez `PRODUCT_BUNDLE_IDENTIFIER` si `com.frenchbook.scan` est déjà pris.
2. Compilez sur un iPhone physique.
3. Au premier lancement : **Réglages** (roue crantée) → collez votre clé API
   Mistral → *Tester la connexion*.

Le projet utilise les *synchronized file groups* d'Xcode 16 : les fichiers
ajoutés dans `FrenchbookScan/` sont pris en compte automatiquement, sans
manipulation du `.pbxproj`.

## Choix techniques

Aucune dépendance tierce. Tout ce dont l'app a besoin existe déjà dans le SDK
iOS, et une dépendance de moins est une dépendance de moins à maintenir sur un
outil de production.

- **SwiftUI** + `ObservableObject`, une machine à états unique (`CartonCoordinator`).
- **VisionKit** (`VNDocumentCameraViewController`) pour la capture du bon :
  détection des bords et correction de perspective déjà éprouvées, et une
  interface que les utilisateurs iOS connaissent.
- **AVFoundation** (`AVCaptureMetadataOutput`) pour les codes-barres, plutôt que
  `DataScannerViewController` qui exige une puce A12+. On garde en prime le
  contrôle de la torche, de la mise au point rapprochée et de l'anti-rebond.
- **Mistral** pour la seule tâche qui le nécessite : lire un tableau manuscrit
  ou photocopié de travers. Le reste — clés de contrôle, rapprochement,
  comptage, export — est du code local et déterministe.

## Organisation

```
FrenchbookScan/
├── App/           FrenchbookScanApp, RootView, CartonCoordinator
├── Models/        ISBN, OrderLine, CartonSession
├── Services/      MistralClient, OCRPipeline, Reconciler,
│                  SessionStore, Exporter, Keychain, AppSettings, Feedback
├── Features/
│   ├── Home/      Écran d'attente
│   ├── Capture/   Scanner de documents, écran de lecture
│   ├── Review/    Contrôle du bon, arbitrage ligne par ligne
│   ├── Scan/      Caméra, feuille de quantité, checklist
│   ├── Summary/   Récapitulatif et clôture
│   └── Settings/  Clé API, modèles, préférences
└── DesignSystem/  Thème et styles de boutons
```

## Réglages notables

**Double lecture croisée** — activée par défaut. La désactiver divise par deux
le coût d'appel API mais supprime la comparaison entre moteurs : seule la clé
ISBN reste vérifiée. L'app affiche un avertissement explicite dans ce mode.

**Modèles** — `mistral-ocr-latest` et `mistral-medium-latest` par défaut,
modifiables dans les Réglages si Mistral publie de nouveaux identifiants, sans
recompiler.
