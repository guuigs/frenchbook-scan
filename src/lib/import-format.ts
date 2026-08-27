/**
 * Lecture et mise en forme d'un fichier de commande.
 *
 * Ce module est pur : ni React, ni API du navigateur. Les deux chemins de
 * dépôt s'en servent — l'écran de l'application, où l'opérateur voit et
 * corrige, et la boîte de réception, où personne ne regarde. C'est pour ce
 * second chemin qu'il ne devait dépendre de rien.
 */

/** Ce que la base attend d'une ligne. Tout est optionnel sauf l'ISBN. */
export interface LigneImport {
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  supplier_response: string;
  shipping_date: string | null;
  reserved: boolean;
  unit_price: number | null;
  discount_rate: number | null;
  quantity_ordered: number;
  quantity_pending: number;
}

/** Les champs que l'opérateur peut rattacher à une colonne du fichier. */
export const CHAMPS = [
  { cle: "isbn", libelle: "ISBN", requis: true },
  { cle: "title", libelle: "Titre", requis: false },
  { cle: "quantity_ordered", libelle: "Quantité commandée", requis: false },
  { cle: "reserved", libelle: "Réservé", requis: false },
  { cle: "author", libelle: "Auteur", requis: false },
  { cle: "publisher", libelle: "Éditeur", requis: false },
  { cle: "supplier_response", libelle: "Réponse fournisseur", requis: false },
  { cle: "shipping_date", libelle: "Date d'expédition", requis: false },
  { cle: "unit_price", libelle: "Prix unitaire", requis: false },
  { cle: "discount_rate", libelle: "Remise %", requis: false },
] as const;

export type CleChamp = (typeof CHAMPS)[number]["cle"];

/** Colonne du fichier retenue pour chaque champ, ou `null` si non rattaché. */
export type Correspondance = Partial<Record<CleChamp, number | null>>;

export interface Feuille {
  entete: string[];
  lignes: string[][];
}

/*
 * Libellés reconnus, en tête de liste ceux de l'export « special order » qui
 * est la source courante. La comparaison est faite sans accent ni casse, sur
 * une égalité stricte plutôt que sur une inclusion : « Remise » et « Remise % »
 * ne désignent pas la même chose, et un `includes` les confondrait.
 */
const LIBELLES: Record<CleChamp, string[]> = {
  isbn: ["code", "isbn", "ean", "ean13", "code ean", "gencod", "gencode", "reference"],
  title: ["titre", "title", "libelle", "designation", "ouvrage"],
  quantity_ordered: ["cde", "qte", "quantite", "quantity", "qty", "commande", "qte commandee"],
  reserved: ["rsve", "reserve", "reserved"],
  author: ["auteur", "author"],
  publisher: ["editeur", "publisher", "edition"],
  supplier_response: ["reponse", "statut", "status", "disponibilite"],
  shipping_date: ["date expedition", "date d expedition", "expedition", "date"],
  unit_price: ["unite ttc", "prix unitaire", "prix", "pu", "unit price", "unite"],
  discount_rate: ["remise %", "remise pourcent", "taux remise", "remise (%)", "discount"],
};

/** Sans accent, sans ponctuation superflue, en minuscules. */
function normaliser(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

/** Propose une colonne pour chaque champ, d'après les en-têtes du fichier. */
export function deviner(entete: string[]): Correspondance {
  const normalisees = entete.map(normaliser);
  const correspondance: Correspondance = {};
  const prises = new Set<number>();

  for (const { cle } of CHAMPS) {
    const index = normalisees.findIndex(
      (libelle, position) =>
        !prises.has(position) && libelle.length > 0 && LIBELLES[cle].includes(libelle),
    );
    if (index >= 0) {
      correspondance[cle] = index;
      prises.add(index);
    } else {
      correspondance[cle] = null;
    }
  }

  return correspondance;
}

// MARK: - Conversions

function texte(valeur: unknown): string {
  return valeur === null || valeur === undefined ? "" : String(valeur).trim();
}

function entier(valeur: unknown): number {
  const chiffres = texte(valeur).replace(/[^0-9]/g, "");
  return chiffres ? Number(chiffres) : 0;
}

/** « 24,00 € », « 14 », « 12.18 » → 24. Nul si illisible. */
function nombre(valeur: unknown): number | null {
  const brut = texte(valeur)
    .replace(/[€%\s ]/g, "")
    .replace(",", ".");
  if (!brut) return null;
  const montant = Number(brut);
  return Number.isFinite(montant) && montant >= 0 ? Math.round(montant * 100) / 100 : null;
}

/** Accepte l'ISO, le jour/mois/année, et les dates rendues par le tableur. */
function date(valeur: unknown): string | null {
  const brut = texte(valeur);
  if (!brut) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(brut)) return brut.slice(0, 10);
  const jour = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(brut);
  if (jour) return `${jour[3]}-${jour[2]}-${jour[1]}`;
  const lu = new Date(brut);
  return Number.isNaN(lu.getTime()) ? null : lu.toISOString().slice(0, 10);
}

export interface Resultat {
  lignes: LigneImport[];
  /** Lignes écartées faute d'ISBN à treize chiffres. */
  ecartees: number;
  /** Doublons internes : la contrainte d'unicité les refuserait de toute façon. */
  doublons: number;
}

/**
 * Applique la correspondance aux lignes du fichier.
 *
 * Deux écarts sont comptés plutôt que signalés un par un : un fichier de mille
 * lignes en produit trop pour une liste, et ce qui compte à l'écran est de
 * savoir combien de livres entreront réellement.
 */
export function construire(feuille: Feuille, correspondance: Correspondance): Resultat {
  const cellule = (ligne: string[], cle: CleChamp): unknown => {
    const index = correspondance[cle];
    return index === null || index === undefined ? "" : ligne[index];
  };

  const lignes: LigneImport[] = [];
  const vues = new Set<string>();
  let ecartees = 0;
  let doublons = 0;

  for (const ligne of feuille.lignes) {
    const isbn = texte(cellule(ligne, "isbn")).replace(/[^0-9]/g, "");

    // Les en-têtes répétés par la pagination et les lignes vides tombent ici.
    if (isbn.length !== 13) {
      if (ligne.some((valeur) => texte(valeur).length > 0)) ecartees += 1;
      continue;
    }
    if (vues.has(isbn)) {
      doublons += 1;
      continue;
    }
    vues.add(isbn);

    const commande = Math.max(entier(cellule(ligne, "quantity_ordered")), 0) || 1;
    const reserve = texte(cellule(ligne, "reserved")) === "1";

    lignes.push({
      isbn,
      title: texte(cellule(ligne, "title")),
      author: texte(cellule(ligne, "author")),
      publisher: texte(cellule(ligne, "publisher")),
      supplier_response: texte(cellule(ligne, "supplier_response")),
      shipping_date: date(cellule(ligne, "shipping_date")),
      reserved: reserve,
      unit_price: nombre(cellule(ligne, "unit_price")),
      discount_rate: nombre(cellule(ligne, "discount_rate")),
      quantity_ordered: commande,
      // Rien à pointer sur une ligne réservée : même règle que le convertisseur.
      quantity_pending: reserve ? 0 : commande,
    });
  }

  return { lignes, ecartees, doublons };
}

/**
 * Découpe une ligne de CSV en respectant les guillemets.
 *
 * Un titre porte des virgules et des points-virgules bien plus souvent qu'on ne
 * le croit ; un `split` sur le séparateur couperait le titre en deux et
 * décalerait toutes les colonnes suivantes — l'ISBN se retrouvant dans la
 * colonne du prix, sans que rien ne le signale.
 */
function decouper(ligne: string, separateur: string): string[] {
  const cellules: string[] = [];
  let courante = "";
  let entreGuillemets = false;

  for (let i = 0; i < ligne.length; i += 1) {
    const caractere = ligne[i];
    if (caractere === '"') {
      if (entreGuillemets && ligne[i + 1] === '"') {
        courante += '"';
        i += 1;
      } else {
        entreGuillemets = !entreGuillemets;
      }
    } else if (caractere === separateur && !entreGuillemets) {
      cellules.push(courante);
      courante = "";
    } else {
      courante += caractere;
    }
  }
  cellules.push(courante);
  return cellules.map((cellule) => cellule.trim());
}

/** Le séparateur le plus présent sur la première ligne l'emporte. */
function separateurDe(entete: string): string {
  const candidats = [";", ",", "\t"];
  return candidats.reduce((meilleur, candidat) =>
    entete.split(candidat).length > entete.split(meilleur).length ? candidat : meilleur,
  );
}

function lireCsv(contenu: string): Feuille {
  // Le BOM d'un export Excel se collerait au premier en-tête, qui ne serait
  // alors reconnu par aucune correspondance.
  const propre = contenu.replace(/^﻿/, "");
  const lignes = propre.split(/\r?\n/).filter((ligne) => ligne.trim().length > 0);
  if (lignes.length === 0) return { entete: [], lignes: [] };

  const separateur = separateurDe(lignes[0]);
  const [entete, ...reste] = lignes.map((ligne) => decouper(ligne, separateur));
  return { entete, lignes: reste };
}

export class FichierIllisible extends Error {}

/**
 * Lit un CSV. L'Excel demande une bibliothèque, et pas la même selon qu'on
 * soit dans le navigateur ou sur le serveur : chaque appelant s'en charge.
 */
export function lireCsvBrut(contenu: string): Feuille {
  return lireCsv(contenu);
}

/**
 * Référence proposée d'après le nom du fichier, comme le fait le convertisseur
 * hors ligne — c'est de là que viennent les références déjà en base.
 */
export function referenceDepuisNom(nom: string): string {
  return nom.replace(/\.[^.]+$/, "").trim().slice(0, 80);
}

// MARK: - Le format figé de l'export « special order »

/**
 * L'en-tête que produit le logiciel de gestion, au caractère près.
 *
 * Le dépôt par courriel n'a personne pour relire : il n'y devine donc aucune
 * colonne, il exige cet en-tête et refuse tout le reste. Ce n'est pas une
 * précaution de principe — sur les 58 fichiers du premier envoi, 25 sont
 * sortis du même logiciel **sans la colonne `Code`**, donc sans ISBN. C'est le
 * refus que cette liste doit attraper, et de loin le plus fréquent.
 */
export const ENTETE_SPECIAL_ORDER = [
  "Code", "P.O", "Titre", "Auteur", "Editeur", "cdé", "rsvé", "Réponse",
  "Date expédition", "Unité TTC", "Remise", "Remise %", "Valeur TTC", "Poids (kg)",
] as const;

/** La correspondance qui découle de cet en-tête, sans aucune reconnaissance. */
export const CORRESPONDANCE_FIGEE: Correspondance = {
  isbn: 0,
  title: 2,
  author: 3,
  publisher: 4,
  quantity_ordered: 5,
  reserved: 6,
  supplier_response: 7,
  shipping_date: 8,
  unit_price: 9,
  discount_rate: 11,
};

/**
 * Rend le motif du refus, ou `null` si l'en-tête est celui attendu.
 *
 * Le message nomme ce qui manque plutôt que d'afficher les deux listes : c'est
 * lu dans un courriel, par quelqu'un qui doit savoir quoi réexporter.
 */
export function refusEntete(entete: readonly string[]): string | null {
  const vus = entete.map((valeur) => valeur.trim());
  const attendus = [...ENTETE_SPECIAL_ORDER];
  if (attendus.every((colonne, index) => vus[index] === colonne)) return null;

  const manquantes = attendus.filter((colonne) => !vus.includes(colonne));
  if (manquantes.length > 0) {
    return `colonne${manquantes.length > 1 ? "s" : ""} absente${
      manquantes.length > 1 ? "s" : ""
    } : ${manquantes.join(", ")}`;
  }
  return `colonnes dans un ordre inattendu (${vus.length} trouvées, ${attendus.length} attendues)`;
}
