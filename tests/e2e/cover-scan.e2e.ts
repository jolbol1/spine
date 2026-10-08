import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import { accountFor, signUp } from "./support"
import type { Locator, Page } from "@playwright/test"

/** A 600×800 photo of a blue cover with a white band, lying skewed on a dark table. */
const coverPhoto = fileURLToPath(
  new URL("./fixtures/cover-photo.png", import.meta.url)
)
/** Where the cover's corners are in that photo. */
const photoSize = { width: 600, height: 800 }
const coverCorners = {
  "Top-left": { x: 110, y: 120 },
  "Top-right": { x: 480, y: 100 },
  "Bottom-right": { x: 500, y: 690 },
  "Bottom-left": { x: 95, y: 670 },
}

const coverPath = /^\/api\/covers\/[0-9a-f-]{36}$/

/** Drag each corner handle onto the cover's corner in the photo. */
async function dragCornersOntoCover(page: Page, dialog: Locator) {
  const photo = await dialog.getByLabel("The photo").boundingBox()
  if (!photo) throw new Error("The photo isn't shown")
  for (const [name, corner] of Object.entries(coverCorners)) {
    const handle = await dialog
      .getByRole("button", { name: `${name} corner` })
      .boundingBox()
    if (!handle) throw new Error(`No ${name} handle`)
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      photo.x + (corner.x / photoSize.width) * photo.width,
      photo.y + (corner.y / photoSize.height) * photo.height,
      { steps: 6 }
    )
    await page.mouse.up()
  }
}

/** The flattened cover's size and a few sampled colours. */
function inspectCover(cover: Locator) {
  return cover.evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    const canvas = document.createElement("canvas")
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(img, 0, 0)
    const at = (x: number, y: number) =>
      Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3))
    const w = img.naturalWidth
    const h = img.naturalHeight
    return {
      width: w,
      height: h,
      corners: [at(24, 24), at(w - 25, 24), at(w - 25, h - 25), at(24, h - 25)],
      // The white band sits 400–480px down the cover's 570px height.
      band: at(w / 2, Math.round((h * 440) / 570)),
    }
  })
}

const isBlue = ([r, g, b]: Array<number>) => b > 150 && r < 100 && g < 140
const isWhite = (rgb: Array<number>) => rgb.every((c) => c > 200)

test("a cover scanned from a photo is flattened, saved, served, and replaced", async ({
  page,
}) => {
  await signUp(page, accountFor("cover-scanner"))
  await page.getByRole("button", { name: "Add film", exact: true }).click()
  await page.getByLabel("Title *").fill("Scanned Cover Film")

  // No camera in the test browser — the photo fallback stands in.
  await page.getByRole("button", { name: "Scan cover" }).click()
  const dialog = page.getByRole("dialog", { name: "Scan cover" })
  await dialog.getByLabel("Cover photo").setInputFiles(coverPhoto)
  await expect(
    dialog.getByRole("button", { name: "Top-left corner" })
  ).toBeVisible()
  await dragCornersOntoCover(page, dialog)
  await dialog.getByRole("button", { name: "Flatten" }).click()

  // Flattened to the Blu-ray front's exact size, cover edge to cover edge.
  const flattened = dialog.getByRole("img", { name: "The flattened cover" })
  await expect(flattened).toBeVisible()
  const result = await inspectCover(flattened)
  expect([result.width, result.height]).toEqual([1052, 1200])
  for (const corner of result.corners) expect(isBlue(corner)).toBe(true)
  expect(isWhite(result.band)).toBe(true)

  await dialog.getByRole("button", { name: "Use cover" }).click()
  await expect(dialog).toBeHidden()
  const coverUrl = page.getByLabel("Cover URL")
  await expect(coverUrl).toHaveValue(coverPath)
  const firstCover = await coverUrl.inputValue()

  await page.getByRole("button", { name: "Add to collection" }).click()
  // The form previews the cover too, so wait for the film's own page.
  await expect(
    page.getByRole("heading", { name: "Scanned Cover Film" })
  ).toBeVisible()
  const poster = page.getByRole("img", { name: "Scanned Cover Film cover" })
  await expect(poster).toHaveAttribute("src", firstCover)
  const served = await page.request.get(firstCover)
  expect(served.status()).toBe(200)
  expect(served.headers()["content-type"]).toBe("image/jpeg")

  // On the film page a scan saves straight away.
  await page.getByRole("button", { name: "Scan cover" }).click()
  const again = page.getByRole("dialog", { name: "Scan cover" })
  await again.getByLabel("Cover photo").setInputFiles(coverPhoto)
  await again.getByRole("button", { name: "Flatten" }).click()
  await again.getByRole("button", { name: "Use cover" }).click()
  await expect(again).toBeHidden()
  await expect(page.getByText("Cover updated")).toBeVisible()

  await expect(poster).not.toHaveAttribute("src", firstCover)
  const secondCover = await poster.getAttribute("src")
  expect(secondCover).toMatch(coverPath)
  expect((await page.request.get(secondCover!)).status()).toBe(200)
  // The replaced photo isn't kept.
  expect((await page.request.get(firstCover)).status()).toBe(404)
})
