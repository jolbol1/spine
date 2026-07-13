import { readConfigFile, sys } from "typescript"
import { describe, expect, it } from "vitest"

describe("TanStack Start TypeScript configuration", () => {
  it("keeps verbatim module syntax disabled for import protection", () => {
    const result = readConfigFile("tsconfig.json", sys.readFile)

    expect(result.error).toBeUndefined()
    expect(result.config.compilerOptions?.verbatimModuleSyntax).not.toBe(true)
  })
})
