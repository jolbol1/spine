import { describe, expect, it } from "vitest"
import { toCollectionFormat } from "@/lib/film-formats"

describe("toCollectionFormat", () => {
  it("rejects a wishlist format that the collection does not support", () => {
    expect(() => toCollectionFormat("VHS")).toThrow("Unsupported film format")
  })
})
