import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { Clapperboard, Users } from "lucide-react"
import { useMemo } from "react"
import { FilmCard } from "@/components/film-card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import type { Film } from "@/db/schema"
import { directorsOf } from "@/lib/film-helpers"
import { filmsQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/people/$person")({
  loader: ({ context }) => context.queryClient.ensureQueryData(filmsQuery),
  component: PersonPage,
})

interface ActedEntry {
  film: Film
  character: string | null
}

function PersonPage() {
  const { person } = Route.useParams()
  const { data: films } = useSuspenseQuery(filmsQuery)

  const { directed, acted, profilePath } = useMemo(() => {
    const directedFilms: Film[] = []
    const actedEntries: ActedEntry[] = []
    let profile: string | null = null
    for (const film of films) {
      if (directorsOf(film).includes(person)) directedFilms.push(film)
      const credit = film.tmdbCast?.find((member) => member.name === person)
      if (credit) {
        actedEntries.push({ film, character: credit.character })
        profile ??= credit.profilePath
      }
    }
    return { directed: directedFilms, acted: actedEntries, profilePath: profile }
  }, [films, person])

  if (directed.length === 0 && acted.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{person}</EmptyTitle>
          <EmptyDescription>
            Nothing in your collection features this person — yet.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-4">
        {profilePath ? (
          <img
            src={`https://image.tmdb.org/t/p/w185${profilePath}`}
            alt=""
            className="size-16 rounded-full object-cover"
          />
        ) : (
          <span className="bg-secondary flex size-16 items-center justify-center rounded-full text-lg font-bold">
            {person
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </span>
        )}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{person}</h1>
          <p className="text-muted-foreground text-sm">
            {[
              directed.length > 0 &&
                `directed ${directed.length} title${directed.length === 1 ? "" : "s"}`,
              acted.length > 0 &&
                `appears in ${acted.length} title${acted.length === 1 ? "" : "s"}`,
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            in your collection
          </p>
        </div>
      </div>

      {directed.length > 0 && (
        <section>
          <h2 className="text-muted-foreground mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.14em] uppercase">
            <Clapperboard className="size-4" /> Directed
          </h2>
          <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {directed.map((film) => (
              <FilmCard key={film.id} film={film} />
            ))}
          </div>
        </section>
      )}

      {acted.length > 0 && (
        <section>
          <h2 className="text-muted-foreground mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.14em] uppercase">
            <Users className="size-4" /> Acted in
          </h2>
          <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {acted.map(({ film, character }) => (
              <div key={film.id}>
                <FilmCard film={film} />
                {character && (
                  <p className="text-muted-foreground mt-0.5 truncate px-0.5 text-xs">
                    as {character}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-muted-foreground text-xs">
        Showing titles from your collection only.{" "}
        <Link to="/" className="text-lb-blue hover:underline">
          Back to the shelf
        </Link>
      </p>
    </div>
  )
}
