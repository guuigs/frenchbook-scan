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

Le tableur doit porter exactement ces colonnes, dans n'importe quel ordre :

| Colonne | Obligatoire | Remarque |
|---|---|---|
| `order_reference` | oui | Numéro de commande |
| `isbn` | oui | **13 chiffres, sans tiret ni espace** — la base refuse le reste |
| `customer` | non | Nom du client, affiché au scan |
| `title` | non | Titre, pour recouper avec le bon de livraison |
| `unit_price` | non | Point décimal, pas de symbole monétaire |
| `currency` | non | `EUR` par défaut |
| `quantity_ordered` | non | Quantité commandée |
| `quantity_delivered` | non | Déjà livrée |
| `quantity_pending` | non | Reste annoncé, s'il est donné explicitement |

Ne **pas** créer de colonne `quantity_remaining` : elle est calculée par la base
(le reste annoncé s'il existe, sinon commandé moins livré). Deux colonnes qui se
contredisent finiraient par diverger, et l'écran de scan lirait la mauvaise.

Import : Table Editor → sélectionner le schéma `catalog` dans le menu déroulant
en haut → table `order_lines` → Insert → Import data from CSV.

Une ligne par titre et par commande. Un même titre deux fois dans la même
commande est refusé — c'est voulu, et c'est ce qui permet de réimporter le
tableur sans accumuler de doublons.

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
