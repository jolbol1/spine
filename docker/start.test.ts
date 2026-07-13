import { spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const hasDocker = spawnSync("docker", ["compose", "version"]).status === 0

describe("the production container entrypoint", () => {
  it("refuses to start without an authentication secret", () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: "/usr/bin:/bin",
    }
    delete env.BETTER_AUTH_SECRET

    const result = spawnSync("/bin/sh", ["docker/start.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain(
      "BETTER_AUTH_SECRET is required"
    )
  })

  it.skipIf(!hasDocker)("rejects a Compose config without a secret", () => {
    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env.BETTER_AUTH_SECRET

    const result = spawnSync(
      "docker",
      ["compose", "--env-file", "/dev/null", "config"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
      }
    )

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain(
      "BETTER_AUTH_SECRET is required"
    )
  })

  it("pushes the schema, reapplies RLS, then starts the preview server", () => {
    const bin = mkdtempSync(join(tmpdir(), "spine-entrypoint-"))
    const log = join(bin, "commands.log")
    const command = (name: string) => {
      const path = join(bin, name)
      writeFileSync(path, `#!/bin/sh\necho "$0 $*" >> "$LOG_FILE"\n`)
      chmodSync(path, 0o755)
    }
    command("bun")
    command("bunx")

    try {
      const result = spawnSync("/bin/sh", ["docker/start.sh"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:/usr/bin:/bin`,
          LOG_FILE: log,
          BETTER_AUTH_SECRET: "test-secret-at-least-32-characters",
        },
      })

      expect(result.status).toBe(0)
      expect(
        readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => line.replace(bin, "<bin>"))
      ).toEqual([
        "<bin>/bunx drizzle-kit push --force",
        "<bin>/bun docker/apply-rls.ts",
        "<bin>/bunx vite preview --host 0.0.0.0 --port 3000",
      ])
    } finally {
      rmSync(bin, { recursive: true, force: true })
    }
  })

  it("requires an admin database URL before applying RLS", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL_ADMIN: "" }

    const result = spawnSync("bun", ["docker/apply-rls.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain(
      "DATABASE_URL_ADMIN is required"
    )
  })

  it.skipIf(!hasDocker)("renders the expected production Compose model", () => {
    const result = spawnSync(
      "docker",
      ["compose", "--env-file", "/dev/null", "config", "--format", "json"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          BETTER_AUTH_SECRET: "test-secret-at-least-32-characters",
        },
      }
    )

    expect(result.status).toBe(0)
    const config = JSON.parse(result.stdout) as {
      services: {
        app: {
          depends_on: { db: { condition: string } }
          environment: Record<string, string>
          ports: Array<{ published: string; target: number }>
        }
        db: { healthcheck: { test: string[] } }
      }
    }
    expect(config.services.app.depends_on.db.condition).toBe("service_healthy")
    expect(config.services.app.environment.DATABASE_URL).toContain("movie_app")
    expect(config.services.app.environment.DATABASE_URL_ADMIN).toContain(
      "postgres@db"
    )
    expect(config.services.app.ports).toContainEqual(
      expect.objectContaining({ published: "3000", target: 3000 })
    )
    expect(config.services.db.healthcheck.test.join(" ")).toContain(
      "pg_isready"
    )
  })
})
