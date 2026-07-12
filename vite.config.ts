import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

/**
 * Hosts allowed to reach the dev/preview server.
 * ALLOWED_HOSTS="spine.example.com,other.example.com" for a specific list,
 * "*" (or "true") to allow any host — e.g. behind your own reverse proxy.
 * Unset keeps Vite's default (localhost only).
 */
function allowedHosts(): true | string[] | undefined {
  const raw = process.env.ALLOWED_HOSTS?.trim()
  if (!raw) return undefined
  if (raw === "*" || raw === "true") return true
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean)
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
  server: { allowedHosts: allowedHosts() },
  preview: { allowedHosts: allowedHosts() },
})

export default config
