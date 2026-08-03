/**
 * Normalisation et validation des codes ISBN / EAN-13.
 *
 * Toute la logique de contrôle repose sur la clé de contrôle : c'est elle qui
 * permet de détecter une erreur d'OCR sur un chiffre sans avoir le livre en
 * main.
 */

function digitsOnly(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9X]/g, "");
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

export function isValidIsbn10(code: string): boolean {
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const character = code[i];
    const value = character === "X" ? 10 : Number(character);
    sum += value * (10 - i);
  }
  return sum % 11 === 0;
}

function toIsbn13(isbn10: string): string {
  const core = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return core + String((10 - (sum % 10)) % 10);
}

/**
 * Ne conserve que les chiffres (et le `X` final d'un ISBN-10), et convertit
 * systématiquement en ISBN-13 pour pouvoir comparer un code lu sur le papier
 * avec un code-barres scanné.
 */
export function normalizeIsbn(raw: string): string {
  const cleaned = digitsOnly(raw);
  if (cleaned.length === 10 && isValidIsbn10(cleaned)) {
    return toIsbn13(cleaned);
  }
  return cleaned;
}

export function isValidIsbn(raw: string): boolean {
  const cleaned = digitsOnly(raw);
  if (cleaned.length === 13) return isValidEan13(cleaned);
  if (cleaned.length === 10) return isValidIsbn10(cleaned);
  return false;
}

/**
 * Affichage lisible : `9 782070 368228`.
 *
 * C'est le groupement EAN-13 imprimé sous les barres, celui que l'opérateur a
 * littéralement sous les yeux sur la quatrième de couverture. On ne tente pas
 * la césure ISBN par registrant (978-2-07-036822-8) : la longueur du préfixe
 * éditeur varie selon le pays et demanderait les tables de l'agence
 * internationale — une césure fausse serait pire que pas de césure du tout
 * quand il s'agit de comparer chiffre à chiffre avec un bon papier.
 */
export function formatIsbn(raw: string): string {
  const cleaned = normalizeIsbn(raw);
  if (cleaned.length !== 13) return raw;
  return `${cleaned.slice(0, 1)} ${cleaned.slice(1, 7)} ${cleaned.slice(7)}`;
}
