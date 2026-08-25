-- =============================================================================
--  frenchbook-scan — référentiel des commandes clients
--
--  À coller tel quel dans Supabase : SQL Editor → New query → Run.
--  Le script est idempotent : le relancer ne détruit aucune donnée.
--
--  Ce qu'il contient : une table de lignes de commande, et un seul point
--  d'entrée pour les lire — la recherche par ISBN.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. Un schéma qui n'est pas exposé à l'API
--
--  Supabase publie automatiquement, en REST, toutes les tables du schéma
--  `public`. Les données de commande — qui a commandé quoi, à quel prix — n'ont
--  aucune raison d'y être atteignables, même protégées.
--
--  Elles vivent donc dans un schéma que PostgREST ne sert pas. Laissez la
--  liste « Exposed schemas » (Settings → API) sur `public` seul : c'est ce
--  réglage qui rend `catalog` injoignable de l'extérieur, quelle que soit la
--  clé présentée. Une clé secrète qui fuiterait ne donnerait donc pas accès à
--  la table, seulement à la fonction de recherche définie plus bas.
-- -----------------------------------------------------------------------------

create schema if not exists catalog;

revoke all on schema catalog from public, anon, authenticated;
grant usage on schema catalog to service_role;


-- -----------------------------------------------------------------------------
--  2. Les lignes de commande
--
--  Une ligne = un titre dans une commande. Le tableur d'origine est repris tel
--  quel, colonne pour colonne, sans normalisation en tables séparées : la
--  source est un export, il sera réimporté périodiquement, et une modélisation
--  plus fine ne servirait qu'à compliquer chaque import.
-- -----------------------------------------------------------------------------

create table if not exists catalog.order_lines (
  id                 uuid primary key default gen_random_uuid(),

  -- Numéro de commande, tel qu'il est imprimé sur les documents.
  order_reference    text        not null check (length(btrim(order_reference)) > 0),

  -- Nom du client. C'est ce que l'opérateur reconnaît d'un coup d'œil au scan,
  -- là où une référence demande un effort de lecture.
  customer           text        not null default '',

  -- ISBN à 13 chiffres, sans tiret ni espace : la même forme que celle que
  -- rend le lecteur de codes-barres, sinon aucune recherche ne concorde.
  isbn               text        not null check (isbn ~ '^[0-9]{13}$'),

  title              text        not null default '',
  author             text        not null default '',
  publisher          text        not null default '',

  -- Réponse du fournisseur, telle qu'imprimée : « Disponible »,
  -- « 21 - Epuisé », « 28 - Arret de comm définitif »…
  supplier_response  text        not null default '',
  shipping_date      date,

  -- Colonne « rsvé » de l'export : le livre est déjà là, ou le fournisseur ne
  -- le servira pas. Il n'y a rien à pointer dessus. C'est une règle métier à
  -- part entière, elle a donc sa colonne plutôt que d'être déduite d'un calcul
  -- de quantités.
  reserved           boolean     not null default false,

  -- Prix unitaire. Nullable : toutes les sources ne le portent pas.
  unit_price         numeric(10, 2) check (unit_price >= 0),
  currency           text        not null default 'EUR',

  -- Taux de remise en pourcentage brut : « 18,00 % » dans l'export devient
  -- 18.00. Il est porté par la ligne et non par la commande — une même commande
  -- mélange couramment plusieurs taux, vraisemblablement un par éditeur.
  --
  -- Nullable, et c'est délibéré : les commandes importées avant que cette
  -- colonne existe n'ont pas de source d'où la tirer, et un 0 mentirait —
  -- « 0 % de remise » et « remise inconnue » ne sont pas la même chose.
  discount_rate      numeric(5, 2) check (discount_rate >= 0 and discount_rate <= 100),

  quantity_ordered   integer     not null default 0 check (quantity_ordered   >= 0),
  quantity_delivered integer     not null default 0 check (quantity_delivered >= 0),

  -- Reste à pointer, tel que la source le dit. Vaut 0 sur une ligne réservée,
  -- la quantité commandée sinon. Il peut différer de la soustraction — une
  -- annulation partielle, un reliquat soldé autrement — et c'est la source qui
  -- a raison.
  quantity_pending   integer     check (quantity_pending >= 0),

  -- Ce qu'il reste à servir, calculé par la base et jamais saisi : deux
  -- colonnes qui se contredisent finiraient par diverger, et l'écran de scan
  -- lirait la mauvaise.
  quantity_remaining integer generated always as (
    greatest(coalesce(quantity_pending, quantity_ordered - quantity_delivered), 0)
  ) stored,

  imported_at        timestamptz not null default now(),

  -- Un même titre ne figure qu'une fois par commande. Cette contrainte est
  -- aussi ce qui permet de réimporter le tableur en écrasant proprement
  -- (`on conflict … do update`) plutôt qu'en accumulant des doublons.
  constraint order_lines_unique_line unique (order_reference, isbn)
);

-- Colonnes ajoutées après coup. Le `create table` ci-dessus ne s'applique qu'à
-- une base vierge : sans ce rattrapage, relancer ce script sur une base déjà
-- en service laisserait le schéma en arrière, ce qui est exactement le cas que
-- l'idempotence est censée couvrir.
alter table catalog.order_lines
  add column if not exists discount_rate numeric(5, 2);

do $$
begin
  alter table catalog.order_lines
    add constraint order_lines_discount_rate_check
    check (discount_rate >= 0 and discount_rate <= 100);
exception
  when duplicate_object then null;
end $$;

-- La seule recherche que fait l'application.
create index if not exists order_lines_isbn_idx on catalog.order_lines (isbn);


-- -----------------------------------------------------------------------------
--  3. Verrouillage des accès directs
--
--  RLS activée sans aucune politique : la table refuse tout le monde par
--  défaut. C'est une ceinture en plus des bretelles du point 1 — si le schéma
--  venait à être exposé par erreur, il n'y aurait toujours rien à lire.
-- -----------------------------------------------------------------------------

alter table catalog.order_lines enable row level security;

revoke all on catalog.order_lines from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  4. Le seul point d'entrée : rechercher un ISBN
--
--  `security definer` : la fonction lit la table avec les droits de son
--  propriétaire, sans que l'appelant n'ait le moindre droit dessus. Elle ne
--  prend qu'un ISBN, ne rend que des lignes de commande, et ne peut rien
--  écrire — c'est toute la surface exposée.
--
--  `set search_path = ''` : sans cela, un objet homonyme créé dans un schéma
--  en tête de chemin pourrait détourner la requête. Tous les noms sont donc
--  qualifiés en entier ci-dessous.
-- -----------------------------------------------------------------------------

-- Toute évolution de ce type de retour impose un `drop function` : Postgres
-- refuse de remplacer une fonction dont la signature de sortie change.
drop function if exists public.lookup_order_lines(text);

create function public.lookup_order_lines(p_isbn text)
returns table (
  order_reference    text,
  customer           text,
  title              text,
  author             text,
  publisher          text,
  supplier_response  text,
  shipping_date      date,
  reserved           boolean,
  unit_price         numeric,
  currency           text,
  quantity_ordered   integer,
  quantity_delivered integer,
  quantity_remaining integer
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    l.order_reference,
    l.customer,
    l.title,
    l.author,
    l.publisher,
    l.supplier_response,
    l.shipping_date,
    l.reserved,
    l.unit_price,
    l.currency,
    l.quantity_ordered,
    l.quantity_delivered,
    l.quantity_remaining
  from catalog.order_lines as l
  -- L'entrée est ramenée à des chiffres avant comparaison : un ISBN saisi à la
  -- main arrive parfois avec des tirets, et il vaut mieux le rapprocher que le
  -- rejeter.
  where l.isbn = regexp_replace(coalesce(p_isbn, ''), '[^0-9]', '', 'g')
  -- Ce qui reste à pointer d'abord ; une ligne réservée n'est pas cachée pour
  -- autant : savoir qu'un livre était déjà là est une information, pas du bruit.
  order by l.quantity_remaining desc, l.order_reference
  limit 50;
$$;

-- Personne n'appelle cette fonction depuis un navigateur. Seul le serveur
-- Next.js le fait, avec la clé secrète, et lui seul en a besoin.
revoke all on function public.lookup_order_lines(text) from public, anon, authenticated;
grant execute on function public.lookup_order_lines(text) to service_role;


-- -----------------------------------------------------------------------------
--  5. Vérification
--
--  À exécuter après l'import pour confirmer que tout est en place.
-- -----------------------------------------------------------------------------

-- select count(*) as lignes, count(distinct order_reference) as commandes,
--        count(distinct isbn) as titres
-- from catalog.order_lines;

-- select * from public.lookup_order_lines('9782070368228');
