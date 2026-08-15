import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"

/**
 * The bytes of a captured response, exactly as they came off the wire.
 * See `fixtures/README.md` for what each capture is and how to take another.
 * Large captures are stored gzipped; the bytes returned are the original ones.
 */
export function capturedResponse(name: string): Uint8Array {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
  const stored = readFileSync(path)
  return new Uint8Array(name.endsWith(".gz") ? gunzipSync(stored) : stored)
}
