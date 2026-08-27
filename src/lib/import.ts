"use client";

/**
 * Volet navigateur de la lecture d'un fichier de commande.
 *
 * Toute la mise en forme vit dans `import-format.ts`, que le serveur partage :
 * un fichier déposé à l'écran et un fichier reçu par courriel doivent donner
 * exactement les mêmes lignes, sans quoi le référentiel dépendrait du chemin
 * emprunté.
 */

import { FichierIllisible, lireCsvBrut, type Feuille } from "./import-format";

export {
  CHAMPS,
  CORRESPONDANCE_FIGEE,
  ENTETE_SPECIAL_ORDER,
  FichierIllisible,
  construire,
  deviner,
  refusEntete,
  referenceDepuisNom,
  type CleChamp,
  type Correspondance,
  type Feuille,
  type LigneImport,
  type Resultat,
} from "./import-format";

async function lireExcel(fichier: File): Promise<Feuille> {
  /*
   * Chargée à la demande : l'écran d'import est rare, et la bibliothèque n'a
   * rien à faire dans le bundle du poste de scan.
   *
   * `readSheet` et non l'export par défaut : depuis la version 9, celui-ci rend
   * la liste des feuilles du classeur et non leurs lignes. On ne lit que la
   * première feuille, comme le fait le convertisseur hors ligne.
   */
  const { readSheet } = await import("read-excel-file/browser");
  const rangees = await readSheet(fichier);
  const enTexte = rangees.map((rangee) =>
    rangee.map((brut) => {
      const cellule: unknown = brut;
      // Une date lue par le tableur arrive en objet ; la laisser passer par
      // `String` donnerait « Thu Aug 21 2026 … », que rien ne saurait relire.
      if (cellule instanceof Date) return cellule.toISOString().slice(0, 10);
      return cellule === null || cellule === undefined ? "" : String(cellule).trim();
    }),
  );
  if (enTexte.length === 0) return { entete: [], lignes: [] };
  const [entete, ...reste] = enTexte;
  return { entete, lignes: reste };
}

export async function lireFichier(fichier: File): Promise<Feuille> {
  const nom = fichier.name.toLowerCase();

  let feuille: Feuille;
  try {
    feuille =
      nom.endsWith(".xlsx") || nom.endsWith(".xls")
        ? await lireExcel(fichier)
        : lireCsvBrut(await fichier.text());
  } catch {
    throw new FichierIllisible(
      "Fichier illisible. Attendu : un .xlsx ou un .csv exporté du logiciel de gestion.",
    );
  }

  if (feuille.entete.length === 0 || feuille.lignes.length === 0) {
    throw new FichierIllisible("Ce fichier ne contient aucune ligne exploitable.");
  }
  return feuille;
}
