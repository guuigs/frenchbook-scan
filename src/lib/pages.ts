import { clear, createStore, del, get, set } from "idb-keyval";

/**
 * Photos des pages du bon, conservées le temps du carton.
 *
 * Elles vivent dans leur propre base IndexedDB, séparée de l'état de la
 * session : ce sont des données lourdes qu'on ne veut pas sérialiser à chaque
 * scan, et qu'on veut pouvoir effacer d'un bloc à la clôture.
 */
const pageStore = createStore("frenchbook-pages", "pages");

export async function savePage(index: number, dataUrl: string): Promise<void> {
  await set(`page-${index}`, dataUrl, pageStore);
}

export async function loadPage(index: number): Promise<string | undefined> {
  return get<string>(`page-${index}`, pageStore);
}

export async function deletePage(index: number): Promise<void> {
  await del(`page-${index}`, pageStore);
}

/** Purge complète, appelée à la clôture ou à l'abandon d'un carton. */
export async function clearPages(): Promise<void> {
  await clear(pageStore);
}
