/**
 * Scoped stdout logger for server functions, so `docker compose logs app`
 * shows what each external integration actually did — every outbound call
 * here talks to a scrape-hostile site, and a swallowed failure is otherwise
 * invisible in production.
 */
export function serverLogger(scope: string) {
  const line = (
    level: string,
    message: string,
    detail?: Record<string, unknown>
  ) =>
    `${new Date().toISOString()} [${scope}] ${level} ${message}${
      detail ? ` ${JSON.stringify(detail)}` : ""
    }`
  return {
    info(message: string, detail?: Record<string, unknown>) {
      console.log(line("INFO", message, detail))
    },
    warn(message: string, detail?: Record<string, unknown>) {
      console.warn(line("WARN", message, detail))
    },
    error(message: string, detail?: Record<string, unknown>) {
      console.error(line("ERROR", message, detail))
    },
  }
}

/** Normalise a caught value for a log detail field. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
