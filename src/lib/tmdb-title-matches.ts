interface TmdbTitleIdentity {
  tmdbId: number
  mediaType: "movie" | "tv"
}

export function dedupeTmdbTitleMatches<TMatch extends TmdbTitleIdentity>(
  matches: readonly TMatch[],
): TMatch[] {
  const seen = new Set<string>()
  return matches.filter((match) => {
    const key = `${match.mediaType}:${match.tmdbId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
