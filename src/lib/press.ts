/**
 * Le code-barres presse français.
 *
 * Une revue vendue en kiosque ne porte pas un code-barres de livre. Elle porte
 * un **code presse** : un EAN-13 tout à fait ordinaire, que n'importe quel
 * lecteur déchiffre — mais qui n'encode pas l'ISBN.
 *
 * Sa structure, vérifiée sur deux numéros de la même revue :
 *
 * |            | imprimé au-dessus des barres | dans le code-barres |
 * | ---------- | ---------------------------- | ------------------- |
 * | préfixe    |                              | `378`               |
 * | publication| `M 08145`                    | `08145`             |
 * | prix       | `F: 12,00 €`                 | `1200`              |
 * | clé        |                              | `1`                 |
 *
 * Autrement dit : **le titre et le prix, rien d'autre**. Le numéro de la
 * livraison n'y est pas — il vit dans un complément à cinq chiffres (`03050`
 * pour le n° 305), et l'ISBN, lui, n'est imprimé qu'en toutes lettres à côté
 * du cadre (`2-84387-311-8`).
 *
 * La conséquence tient en une phrase : **deux numéros différents de la même
 * revue donnent exactement le même code-barres**. Nos deux exemplaires, le
 * n° 300 et le n° 305, se lisent tous deux `3780814512001`. Aucun réglage de
 * décodeur n'y changera rien ; il n'y a pas d'ISBN à en tirer.
 *
 * Le complément à cinq chiffres n'est délibérément pas lu. Il faudrait
 * l'activer sur toutes les images, ce qui ferait remonter deux symboles au
 * lieu d'un sur le chemin critique du scan — et surtout, sur un livre anglais
 * portant un complément de prix, ces cinq chiffres viendraient se coller à
 * l'ISBN et empêcheraient la ligne du bon d'être retrouvée. On y gagnerait le
 * numéro de la livraison, que l'opérateur a de toute façon imprimé en clair
 * sous les yeux.
 */

import { isValidEan13 } from "./isbn";

export interface PressCode {
  /** Le numéro de publication, celui imprimé « M 08145 » au-dessus des barres. */
  publication: string;
  /** Le prix de vente porté par le code-barres, en centimes. */
  priceCents: number;
}

/**
 * Reconnaît un code presse français, ou rend `null`.
 *
 * Le préfixe `378` est celui des deux exemplaires décodés, et celui qu'emploie
 * la codification presse française. La clé de contrôle est exigée en plus :
 * sans elle, n'importe quelle suite de treize chiffres commençant par 378
 * passerait pour une revue.
 */
export function readPressCode(raw: string): PressCode | null {
  const cleaned = raw.replace(/\D/g, "");
  if (!/^378\d{10}$/.test(cleaned) || !isValidEan13(cleaned)) return null;
  return {
    publication: cleaned.slice(3, 8),
    priceCents: Number(cleaned.slice(8, 12)),
  };
}

/** `M 08145 · 12,00 €` — ce que l'opérateur lit au-dessus des barres. */
export function formatPressCode({ publication, priceCents }: PressCode): string {
  const price = `${Math.floor(priceCents / 100)},${String(priceCents % 100).padStart(2, "0")} €`;
  return `M ${publication} · ${price}`;
}
