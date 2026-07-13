import { describe, expect, it } from "vitest"
import {
  blurayToValues,
  cexIdFromUrl,
  cexToValues,
  normalizeHdr,
  scrapeToValues,
} from "./import-mappers"

describe("import source mappings", () => {
  it.each([
    ["HDR10 with Dolby Vision", "Dolby Vision"],
    ["HDR10+", "HDR10+"],
    ["HDR10", "HDR10"],
    ["SDR", ""],
    [null, ""],
  ])("maps %s to the form HDR value %s", (source, expected) => {
    expect(normalizeHdr(source)).toBe(expected)
  })

  it("maps a Blu-ray import into editable form values", () => {
    expect(
      blurayToValues({
        title: "Fixture Film",
        year: 2024,
        director: "Fixture Director",
        format: "4K UHD",
        audio: "Dolby Atmos",
        hdr: "HDR10, Dolby Vision",
        region: "A, B",
        label: "Fixture Label",
        spineNumber: 42,
        runtimeMinutes: 121,
        discCount: 3,
        coverUrl: "https://images.example/cover.jpg",
        url: "https://www.blu-ray.com/movies/fixture/1/",
      })
    ).toMatchObject({
      title: "Fixture Film",
      year: "2024",
      director: "Fixture Director",
      format: "4K UHD",
      hdr: "Dolby Vision",
      region: "A",
      spineNumber: "42",
      runtimeMinutes: "121",
      discCount: "3",
    })
  })

  it("maps CEX catalogue extras into notes", () => {
    expect(
      cexToValues({
        title: "Archive Film",
        year: 1999,
        format: "DVD",
        runtimeMinutes: 90,
        label: "Studio Label",
        bbfcRating: "15",
        genres: ["Drama", "Thriller"],
        publisher: "Publisher",
        supplier: "Supplier",
        coverUrl: null,
        barcode: "5012345678900",
      })
    ).toMatchObject({
      title: "Archive Film",
      year: "1999",
      format: "DVD",
      barcode: "5012345678900",
      notes:
        "BBFC: 15\nGenre: Drama, Thriller\nPublisher: Publisher\nSupplier: Supplier",
    })
  })

  it("cleans retailer titles and infers their format and year", () => {
    expect(
      scrapeToValues({
        title: "Possession (1981) [4K Ultra HD Limited Edition]",
        price: "£29.99",
        retailer: "Second Sight",
        imageUrl: "https://images.example/possession.jpg",
        url: "https://secondsightfilms.co.uk/products/possession",
      })
    ).toMatchObject({
      title: "Possession",
      year: "1981",
      format: "4K UHD",
      notes: "Second Sight · £29.99",
    })
  })

  it("accepts only CEX product URLs with an id", () => {
    expect(
      cexIdFromUrl(new URL("https://uk.webuy.com/product-detail?id=ABC123"))
    ).toBe("ABC123")
    expect(
      cexIdFromUrl(new URL("https://example.com/product-detail?id=ABC123"))
    ).toBeNull()
  })
})
