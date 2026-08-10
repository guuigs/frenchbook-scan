/**
 * Copie le binaire WebAssembly de ZXing dans /public.
 *
 * Auto-hébergé plutôt que chargé depuis un CDN : une dépendance réseau tierce
 * de plus sur le chemin critique du scan serait un point de panne gratuit dans
 * un entrepôt. Le fichier est recopié à chaque build, donc toujours en phase
 * avec la version installée — et il n'a pas à vivre dans le dépôt.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const source = require.resolve("zxing-wasm/reader/zxing_reader.wasm");
mkdirSync("public", { recursive: true });
copyFileSync(source, "public/zxing_reader.wasm");
console.log("zxing_reader.wasm copié dans public/");
