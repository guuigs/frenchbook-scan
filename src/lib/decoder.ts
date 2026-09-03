"use client";

import { HTMLCanvasElementLuminanceSource } from "@zxing/browser";
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatOneDReader,
} from "@zxing/library";

/**
 * Décodage d'un code-barres livre à partir d'un canvas.
 *
 * Deux moteurs, mesurés sur des images identiques (bande de 306×245, modules
 * de 2 px) :
 *
 * |                        | JS `@zxing/library` | WebAssembly `zxing-cpp` |
 * | ---------------------- | ------------------- | ----------------------- |
 * | image sans code        | 7,0 ms              | 1,8 ms                  |
 * | code incliné à 60°     | jamais lu           | lu                       |
 *
 * L'image sans code est de très loin la plus fréquente — c'est elle qui fixe la
 * cadence de lecture. Le WebAssembly est donc le moteur par défaut.
 *
 * Le portage JavaScript reste en secours : si le module WebAssembly ne se
 * charge pas, mieux vaut scanner lentement que pas du tout.
 */

/**
 * Symbologies acceptées.
 *
 * L'EAN-13 est la norme du livre : c'est le code Bookland, celui que porte la
 * quasi-totalité des quatrièmes de couverture. Les variantes UPC et EAN-8
 * couvrent les rares étiquettes courtes recollées par un distributeur.
 *
 * **Le Code 128 est là pour une raison précise.** Certains éditeurs — chez
 * nous Les Presses du Midi (978-2-8127-…), et plus généralement les petites
 * maisons et l'impression à la demande — n'impriment pas un EAN-13 mais un
 * Code 128 qui encode les treize chiffres de l'ISBN. À l'œil c'est le même
 * pavé de barres surmonté du même nombre, et la douchette du libraire le lit
 * sans broncher ; mais pour un décodeur c'est une autre symbologie, et tant
 * qu'elle n'est pas demandée le code n'est jamais lu, quelle que soit la
 * qualité de la visée. Les trois exemplaires qui ont motivé ce correctif
 * (9782812714757, 9782812713606, 9782812707773) ne sortaient rien avec la
 * liste précédente et sortent leur ISBN du premier coup avec celle-ci.
 *
 * Le coût est nul là où il compterait : sur une image sans code — la très
 * grande majorité des images, celle qui fixe la cadence — la recherche passe
 * de 2,13 ms à 2,15 ms, mesuré sur la bande réellement analysée.
 */
const FORMATS = ["EAN-13", "EAN-8", "UPC-A", "UPC-E", "Code128"] as const;

/**
 * Une lecture, avec la symbologie qui l'a produite.
 *
 * L'appelant en a besoin : l'EAN-13 est un code de produit de détail, un
 * Code 128 est aussi bien l'étiquette logistique du carton posé à côté. Ils ne
 * méritent pas la même confiance, et c'est `useBarcodeScanner` qui tranche.
 */
export interface Decoded {
  text: string;
  format: string;
}

type Decoder = (canvas: HTMLCanvasElement) => Promise<Decoded | null>;

// MARK: - Moteur de secours : portage JavaScript

const jsHints = new Map<DecodeHintType, unknown>();
jsHints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
]);

const jsReader = new MultiFormatOneDReader(jsHints);

/** Aligne le nom de symbologie du portage JS sur celui du WebAssembly. */
const JS_FORMAT_NAMES: Partial<Record<BarcodeFormat, string>> = {
  [BarcodeFormat.EAN_13]: "EAN-13",
  [BarcodeFormat.EAN_8]: "EAN-8",
  [BarcodeFormat.UPC_A]: "UPC-A",
  [BarcodeFormat.UPC_E]: "UPC-E",
  [BarcodeFormat.CODE_128]: "Code128",
};

const decodeWithJs: Decoder = async (canvas) => {
  try {
    const source = new HTMLCanvasElementLuminanceSource(canvas);
    const result = jsReader.decode(new BinaryBitmap(new HybridBinarizer(source)), jsHints);
    return {
      text: result.getText(),
      format: JS_FORMAT_NAMES[result.getBarcodeFormat()] ?? "",
    };
  } catch {
    return null;
  }
};

// MARK: - Moteur principal : zxing-cpp compilé en WebAssembly

let wasmDecoder: Decoder | null = null;
let wasmLoading: Promise<Decoder> | null = null;

async function loadWasmDecoder(): Promise<Decoder> {
  const { prepareZXingModule, readBarcodes } = await import("zxing-wasm/reader");

  // Binaire servi depuis notre propre domaine plutôt qu'un CDN : une
  // dépendance réseau tierce sur le chemin critique du scan serait un point de
  // panne gratuit dans un entrepôt.
  prepareZXingModule({
    overrides: {
      locateFile: (path: string) => (path.endsWith(".wasm") ? "/zxing_reader.wasm" : path),
    },
  });

  const decode: Decoder = async (canvas) => {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    const results = await readBarcodes(
      context.getImageData(0, 0, canvas.width, canvas.height),
      {
        formats: [...FORMATS],
        tryHarder: true,
        // Fait aussi balayer l'image dans l'autre sens : couvre le livre
        // présenté de travers sans repasser par une rotation manuelle.
        tryRotate: true,
        tryDownscale: true,
        // Un livre à la fois : inutile de continuer à chercher après le premier.
        maxNumberOfSymbols: 1,
      },
    );
    const first = results[0];
    return first ? { text: first.text, format: first.format } : null;
  };

  // Première invocation à vide : la compilation du module coûte ~100 ms, autant
  // la payer pendant que l'opérateur ouvre l'écran plutôt qu'au premier livre.
  const warmup = document.createElement("canvas");
  warmup.width = 32;
  warmup.height = 32;
  await decode(warmup).catch(() => null);

  return decode;
}

/**
 * Prépare le moteur. Appelé à l'ouverture du poste de scan pour que le module
 * soit compilé avant le premier livre.
 */
export function warmUpDecoder(): void {
  if (wasmDecoder || wasmLoading) return;
  wasmLoading = loadWasmDecoder()
    .then((decoder) => {
      wasmDecoder = decoder;
      return decoder;
    })
    .catch(() => decodeWithJs);
}

export async function decodeCanvas(canvas: HTMLCanvasElement): Promise<Decoded | null> {
  if (wasmDecoder) return wasmDecoder(canvas);
  if (!wasmLoading) warmUpDecoder();
  const decoder = await (wasmLoading ?? Promise.resolve(decodeWithJs));
  return decoder(canvas);
}

/** Vrai une fois le moteur WebAssembly prêt ; faux tant qu'on est en secours. */
export function isAcceleratedDecoderReady(): boolean {
  return wasmDecoder !== null;
}
