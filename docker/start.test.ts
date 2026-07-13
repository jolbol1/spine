import { spawnSync } from "node:child_process"
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
})
