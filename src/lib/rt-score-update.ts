interface RtScoreResult {
  url: string
  criticsScore: number | null
  audienceScore: number | null
}

export function toRtScoreUpdate(result: RtScoreResult | null) {
  return {
    rtUrl: result?.url ?? null,
    rtCriticsScore: result?.criticsScore ?? null,
    rtAudienceScore: result?.audienceScore ?? null,
  }
}
