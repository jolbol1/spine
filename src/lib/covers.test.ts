import { describe, expect, it } from "vitest"
import { coverSize, customCoverId, sniffImageType } from "./covers"

describe("custom cover paths", () => {
  it("recognises a stored cover's path and nothing else", () => {
    const id = "734d2a4b-d02e-432b-95e2-5644bacd737e"
    expect(customCoverId(`/api/covers/${id}`)).toBe(id)
    expect(customCoverId(`https://example.com/api/covers/${id}`)).toBeNull()
    expect(customCoverId("/api/covers/not-a-uuid")).toBeNull()
    expect(customCoverId(null)).toBeNull()
  })
})

describe("cover dimensions", () => {
  it("follows the printed insert's proportions per format", () => {
    expect(coverSize("DVD")).toEqual({ width: 849, height: 1200 })
    expect(coverSize("Blu-ray")).toEqual({ width: 1052, height: 1200 })
    expect(coverSize("4K UHD")).toEqual(coverSize("Blu-ray"))
  })
})

describe("sniffImageType", () => {
  const bytes = (...values: number[]) => new Uint8Array(values)
  const ascii = (text: string) =>
    new Uint8Array([...text].map((c) => c.charCodeAt(0)))

  it("reads the magic number, not the claimed type", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg")
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d))).toBe(
      "image/png"
    )
    expect(sniffImageType(ascii("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp")
    expect(sniffImageType(ascii("<svg xmlns="))).toBeNull()
  })
})
