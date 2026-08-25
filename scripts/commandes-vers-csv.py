"""Convertit les exports « special order » en un CSV prêt à importer.

Une commande par fichier, la référence venant du nom : 10852SP.xlsx → 10852SP.
La colonne P.O de l'export est vide sur toutes les lignes, elle ne peut donc
pas servir.

La règle métier qui compte : « rsvé = 1 » veut dire que le livre est déjà là ou
qu'il n'est pas disponible — rien à pointer. Elle est portée telle quelle par
`reserved`, et se répercute sur `quantity_pending`, que la base utilise pour
calculer le reste à servir.
"""

import csv
import glob
import math
import os
import re
import sys

import openpyxl

ENTETE = ['Code', 'P.O', 'Titre', 'Auteur', 'Editeur', 'cdé', 'rsvé', 'Réponse',
          'Date expédition', 'Unité TTC', 'Remise', 'Remise %', 'Valeur TTC', 'Poids (kg)']

# Les colonnes de `catalog.order_lines`, dans l'ordre où le CSV les portera.
COLONNES = ['order_reference', 'customer', 'isbn', 'title', 'author', 'publisher',
            'supplier_response', 'shipping_date', 'reserved', 'unit_price',
            'discount_rate', 'quantity_ordered', 'quantity_pending']


def texte(valeur):
    return "" if valeur is None else str(valeur).strip()


def entier(valeur):
    chiffres = re.sub(r"[^0-9]", "", texte(valeur))
    return int(chiffres) if chiffres else 0


def prix(valeur):
    """« 24,00 € », « 14 », « 12.18 » → 24.00. Vide si illisible."""
    brut = texte(valeur).replace("€", "").replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        montant = float(brut)
    except ValueError:
        return None
    return None if math.isnan(montant) or montant < 0 else round(montant, 2)


def taux(valeur):
    """« 18,00 % » → 18.00. C'est le pourcentage brut qui est retenu, pas le
    montant en euros de la colonne « Remise » voisine : le taux est la valeur
    canonique, le montant s'en déduit et arrive bruité par le tableur
    (67.275002 pour 67,28 €).

    Le taux est propre à la ligne, pas à la commande : une même commande
    mélange couramment plusieurs taux, vraisemblablement un par éditeur.
    """
    brut = texte(valeur).replace("%", "").replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        pourcentage = float(brut)
    except ValueError:
        return None
    if math.isnan(pourcentage) or not 0 <= pourcentage <= 100:
        return None
    return round(pourcentage, 2)


def date(valeur):
    """openpyxl rend « 2026-08-21 00:00:00 » ; l'export CSV rendait « 21/08/2026 »."""
    brut = texte(valeur)
    if not brut:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}", brut):
        return brut[:10]
    jour = re.match(r"^(\d{2})/(\d{2})/(\d{4})", brut)
    return f"{jour.group(3)}-{jour.group(2)}-{jour.group(1)}" if jour else None


def charger_correspondance(chemin):
    """numero -> "numero - Réf. Comm. - Nom", le nom qu'affiche l'appli.

    Le CSV de correspondance porte les colonnes numero,refcomm,nom (le numéro
    de commande sans préfixe, tel qu'il figure dans le nom du fichier).
    """
    correspondance = {}
    with open(chemin, newline="", encoding="utf-8") as fichier:
        for ligne in csv.DictReader(fichier):
            correspondance[ligne["numero"]] = f"{ligne['numero']} - {ligne['refcomm']} - {ligne['nom']}"
    return correspondance


def lire(chemin, correspondance):
    reference = os.path.basename(chemin).replace(".xlsx", "")
    customer = correspondance.get(re.sub(r"[^0-9]", "", reference), "")
    feuille = openpyxl.load_workbook(chemin, data_only=True).worksheets[0]
    lignes = list(feuille.iter_rows(values_only=True))

    entete = [texte(v) for v in lignes[0]]
    if entete != ENTETE:
        raise SystemExit(f"{reference} : en-tête inattendu {entete}")

    vues = set()
    resultat = []
    for brute in lignes[1:]:
        champs = dict(zip(ENTETE, brute))
        isbn = re.sub(r"[^0-9]", "", texte(champs["Code"]))

        # Les en-têtes répétés par la pagination et les lignes vides tombent ici.
        if len(isbn) != 13:
            continue
        # La contrainte d'unicité (référence, isbn) rejetterait un doublon
        # interne : on garde la première occurrence plutôt que de faire échouer
        # l'import entier.
        if isbn in vues:
            continue
        vues.add(isbn)

        commande = entier(champs["cdé"])
        reserve = texte(champs["rsvé"]) == "1"

        resultat.append((
            reference,
            customer,
            isbn,
            texte(champs["Titre"]),
            texte(champs["Auteur"]),
            texte(champs["Editeur"]),
            texte(champs["Réponse"]),
            date(champs["Date expédition"]),
            reserve,
            prix(champs["Unité TTC"]),
            taux(champs["Remise %"]),
            commande,
            # Rien à pointer sur une ligne réservée : le reste est explicitement
            # nul, et c'est cette valeur que la base retient pour le calcul.
            0 if reserve else commande,
        ))
    return resultat


def main(dossier, sortie, correspondance_csv):
    correspondance = charger_correspondance(correspondance_csv) if correspondance_csv else {}
    total = 0
    with open(sortie, "w", newline="", encoding="utf-8") as fichier:
        ecrivain = csv.writer(fichier)
        ecrivain.writerow(COLONNES)

        for chemin in sorted(glob.glob(f"{dossier}/*.xlsx")):
            lignes = lire(chemin, correspondance)
            for (ref, customer, isbn, titre, auteur, editeur, reponse,
                 expedition, reserve, montant, remise, commande, reste) in lignes:
                ecrivain.writerow([
                    ref, customer, isbn, titre, auteur, editeur, reponse,
                    expedition or "",
                    "true" if reserve else "false",
                    "" if montant is None else f"{montant:.2f}",
                    "" if remise is None else f"{remise:.2f}",
                    commande, reste,
                ])
            total += len(lignes)
            print(f"{os.path.basename(chemin):16} {len(lignes):5} lignes", file=sys.stderr)

    print(f"\n{total} lignes → {sortie}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        raise SystemExit(
            "usage : commandes-vers-csv.py <dossier de .xlsx> <sortie.csv> [correspondance.csv]"
        )
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else None)
