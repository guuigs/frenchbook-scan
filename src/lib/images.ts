/**
 * Préparation des photos avant envoi au serveur.
 *
 * Deux contraintes se rejoignent : Vercel plafonne le corps d'une requête
 * serverless à quelques mégaoctets, et au-delà de ~2000 px sur le grand côté
 * le coût d'un appel OCR monte sans gain de lecture mesurable sur un tableau.
 */

const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 0.72;

export async function prepareForUpload(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);

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
