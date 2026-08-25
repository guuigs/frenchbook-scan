# Référentiel des commandes clients

À quelle commande appartient le livre qu'on vient de scanner ? La réponse vit
dans une base Supabase, consultée en lecture seule pendant le scan.

## Mise en place, une fois

1. **Créer le projet.** [supabase.com](https://supabase.com) → New project, nom
   `frenchbook-scan`, région `eu-west-3` (Paris) ou `eu-central-1`. Noter le mot
   de passe de la base : il ne sera plus affiché.

2. **Créer le schéma.** SQL Editor → New query → coller `schema.sql` en entier →
   Run. Le script est idempotent : le relancer ne détruit rien.

3. **Vérifier que rien n'est exposé.** Settings → API → *Exposed schemas* doit
   contenir `public` et lui seul. C'est ce réglage qui rend les données de
   commande injoignables depuis l'extérieur : elles vivent dans le schéma
   `catalog`, que l'API ne sert pas.

4. **Récupérer les deux valeurs pour Vercel.** Settings → API :

   | Variable Vercel | Où la trouver |
   |---|---|
   | `SUPABASE_URL` | *Project URL* (`https://xxxx.supabase.co`) |
   | `SUPABASE_SECRET_KEY` | La clé **secrète** (`service_role`, ou `sb_secret_…`) |

   La clé secrète ne quitte jamais le serveur : le navigateur ne l'a jamais, et
   l'application ne contient aucun client Supabase. Ne pas utiliser la clé
   publiable — elle n'a par construction accès à rien ici.

   Redéployer après les avoir posées : une variable n'entre en vigueur qu'au
   déploiement suivant.

## Importer les commandes

La source est l'export « special order » du logiciel de gestion : un fichier
Excel par commande, nommé `<référence>SP.xlsx`. Le numéro de commande n'est
dans aucune colonne — la colonne `P.O` de l'export est vide sur toutes les
lignes — il vient donc du **nom du fichier**, qu'il ne faut pas renommer.

`scripts/commandes-vers-csv.py` convertit un dossier de ces fichiers en un CSV
prêt à importer :

```bash
pip install openpyxl
python3 scripts/commandes-vers-csv.py ~/commandes ~/commandes.csv
```

Un troisième argument optionnel donne le nom affiché par l'appli
(`customer`) : un CSV `numero,refcomm,nom` (le numéro de commande sans
préfixe, tel qu'il figure dans le nom du fichier) produit le nom
`<numero> - <refcomm> - <nom>`. Sans ce fichier, `customer` reste vide et
l'appli retombe sur `order_reference`.

```bash
python3 scripts/commandes-vers-csv.py ~/commandes ~/commandes.csv ~/correspondance.csv
```

Colonnes produites, qui sont exactement celles de la table :

| Colonne | Source dans l'export | Remarque |
|---|---|---|
| `order_reference` | nom du fichier | `10852SP.xlsx` → `10852SP` |
| `customer` | fichier de correspondance (optionnel) | `<numero> - <refcomm> - <nom>` |
| `isbn` | `Code` | **13 chiffres**, vérifiés un à un |
| `title` | `Titre` | recoupe le bon de livraison |
| `author` | `Auteur` | |
| `publisher` | `Editeur` | |
| `supplier_response` | `Réponse` | « Disponible », « 21 - Epuisé »… |
| `shipping_date` | `Date expédition` | converti en ISO |
| `reserved` | `rsvé` | **1 → rien à pointer** |
| `unit_price` | `Unité TTC` | « 24,00 € » → `24.00` |
| `discount_rate` | `Remise %` | « 18,00 % » → `18.00`, le pourcentage brut |
| `quantity_ordered` | `cdé` | |
| `quantity_pending` | déduit | `0` si réservé, la quantité commandée sinon |

Le convertisseur écarte les en-têtes répétés par la pagination, les lignes sans
ISBN valide, et les doublons internes à une commande — que la contrainte
d'unicité refuserait de toute façon.

**La remise est portée par la ligne, pas par la commande.** C'est contre-intuitif
si l'on pense « remise du client » : sur les 58 commandes importées, 46 mélangent
plusieurs taux, et une seule d'entre elles peut en aligner six (10, 13, 15, 17,
18, 20 %). Le taux suit vraisemblablement l'éditeur, sans que ce soit une règle
fiable non plus — 59 éditeurs portent eux-mêmes plusieurs taux selon la commande.
Il n'y a donc pas de « taux de la commande » à afficher : seule la ligne fait foi.

C'est le pourcentage qui est retenu, pas le montant en euros de la colonne
`Remise` voisine : le taux est la valeur canonique, le montant s'en déduit et
arrive bruité par le tableur (`67.275002` pour 67,28 €).

La colonne est **nullable, et le reste** : les commandes importées avant son
existence n'ont pas de source d'où la tirer. Un `0` mentirait — « 0 % de remise »
et « remise inconnue » ne sont pas la même chose.

Ne **pas** ajouter de colonne `quantity_remaining` : elle est calculée par la
base. Deux colonnes qui se contredisent finiraient par diverger, et l'écran de
scan lirait la mauvaise.

Import : Table Editor → sélectionner le schéma `catalog` dans le menu déroulant
en haut → table `order_lines` → Insert → Import data from CSV.

**La règle qui compte au scan :** `rsvé = 1` signifie que le livre est déjà là
ou que le fournisseur ne le servira pas — il n'y a rien à pointer. Ces lignes ne
sont pas cachées pour autant : l'écran les affiche en « réservé · rien à
pointer », avec le motif du fournisseur quand il y en a un. Savoir qu'un livre
annoncé épuisé sort pourtant du carton vaut mieux que de l'ignorer.

## Vérifier

```sql
select count(*) as lignes,
       count(distinct order_reference) as commandes,
       count(distinct isbn) as titres
from catalog.order_lines;

-- Ce que verra l'écran de scan pour un ISBN donné :
select * from public.lookup_order_lines('9782854288520');
```

## Ce que la base peut, et ne peut pas

L'application ne fait qu'une chose : appeler `lookup_order_lines` avec un ISBN.
Elle n'écrit rien — les affectations décidées au scan vivent dans le carton, sur
le téléphone, et repartent au récapitulatif.

Trois barrières se cumulent, et chacune tient seule :

- les tables sont dans un schéma que l'API REST ne publie pas ;
- `anon` et `authenticated` n'ont aucun droit dessus, et la RLS y refuse tout
  par défaut ;
- la clé secrète ne quitte pas le serveur, et n'ouvre de toute façon que la
  fonction de recherche — pas les tables.

Conséquence pratique : une clé secrète qui fuiterait permettrait de savoir quelles
commandes attendent un ISBN donné, à condition de connaître l'ISBN. Elle ne
permettrait ni de lister les clients, ni de lire les prix en masse, ni d'écrire
quoi que ce soit.
