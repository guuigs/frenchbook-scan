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

const FORMATS = ["EAN-13", "EAN-8", "UPC-A", "UPC-E"] as const;

type Decoder = (canvas: HTMLCanvasElement) => Promise<string | null>;

// MARK: - Moteur de secours : portage JavaScript

const jsHints = new Map<DecodeHintType, unknown>();
jsHints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
]);

const jsReader = new MultiFormatOneDReader(jsHints);

const decodeWithJs: Decoder = async (canvas) => {
  try {
    const source = new HTMLCanvasElementLuminanceSource(canvas);
    return jsReader.decode(new BinaryBitmap(new HybridBinarizer(source)), jsHints).getText();
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
    return results[0]?.text ?? null;
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

export async function decodeCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  if (wasmDecoder) return wasmDecoder(canvas);
  if (!wasmLoading) warmUpDecoder();
  const decoder = await (wasmLoading ?? Promise.resolve(decodeWithJs));
  return decoder(canvas);
}

/** Vrai une fois le moteur WebAssembly prêt ; faux tant qu'on est en secours. */
export function isAcceleratedDecoderReady(): boolean {
  return wasmDecoder !== null;
}
