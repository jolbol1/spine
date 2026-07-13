import { describe, expect, it } from "vitest"
import { toRtScoreUpdate } from "@/lib/rt-score-update"

describe("toRtScoreUpdate", () => {
  it("clears every stored score field when a refresh finds no match", () => {
    expect(toRtScoreUpdate(null)).toEqual({
      rtUrl: null,
      rtCriticsScore: null,
      rtAudienceScore: null,
    })
  })
})
