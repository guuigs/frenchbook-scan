/**
 * Préparation des photos avant envoi au serveur.
 *
 * Vercel plafonne le corps d'une requête serverless à 4,5 Mo, et le moteur
 * vision facture au nombre de pixels : le plafond ci-dessous arbitre entre ce
 * que le papier contient et ce qu'on accepte de payer pour l'atteindre.
 */

/**
 * Plafond sur le grand côté, en pixels.
 *
 * Le nombre de pixels varie au carré du plafond : c'est lui qui décide du poids,
 * du coût et de la latence, pas la valeur elle-même.
 *
 * Ces bordereaux sont imprimés en matriciel à 10 caractères par pouce. Sur une
 * page A4 dont la feuille remplirait tout le cadre, 2400 px donnent environ
 * 205 dpi, soit 20 px par caractère — confortable. Mais les pages sont
 * photographiées, jamais scannées : une bonne part du cadre est du bureau et du
 * carton, et la feuille n'en récupère guère plus des deux tiers. On retombe vers
 * 14 px par caractère, la limite basse de ce qu'un OCR lit proprement.
 *
 * D'où 2400 plutôt que 2000, qui laissait les photos sous cette limite. Le gain
 * porte sur les chiffres — jambages fins, clé de contrôle — bien plus que sur
 * les titres, donc exactement sur ce qui déclenche un arbitrage. Au-delà de
 * ~3000 px il n'y a plus rien à gagner : le papier ne contient pas davantage.
 */
const MAX_DIMENSION = 2400;

/**
 * Ces bordereaux sortent d'une imprimante matricielle : des chiffres tracés en
 * points, avec des jambages d'un ou deux pixels une fois l'image réduite. C'est
 * exactement ce que la compression JPEG abîme en premier — le rebond de
 * quantification étale un trait fin sur ses voisins, et un 3 devient un 8.
 *
 * À 0,72 l'artefact était visible sur les chiffres ; à 0,85 il ne l'est plus,
 * pour environ 60 % de poids en plus. Une page reste très en dessous de la
 * limite de corps de requête de Vercel, et un ISBN qu'on n'a pas à faire
 * arbitrer paie largement les octets.
 */
const JPEG_QUALITY = 0.85;

/**
 * Une photo prise à l'iPhone porte son orientation dans ses métadonnées EXIF
 * plutôt que dans ses pixels. Sans cette option, un bon photographié en portrait
 * partirait couché à l'OCR — et un tableau lu de travers se lit nettement moins
 * bien.
 */
async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return createImageBitmap(file);
  }
}

export async function prepareForUpload(file: Blob): Promise<string> {
  const bitmap = await decode(file);

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Impossible de préparer l'image sur cet appareil.");
  }

  // Fond blanc : un JPEG n'a pas de transparence, et une photo au format PNG
  // avec canal alpha virerait au noir sans ça.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

/** Vignette légère pour la grille de pages, sans garder l'original en mémoire. */
export async function makeThumbnail(dataUrl: string, size = 240): Promise<string> {
  const response = await fetch(dataUrl);
  const bitmap = await createImageBitmap(await response.blob());

  const scale = Math.min(size / bitmap.width, size / bitmap.height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return dataUrl;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return canvas.toDataURL("image/jpeg", 0.6);
}
