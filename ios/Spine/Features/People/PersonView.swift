import SwiftUI

/// A director or cast member (src/routes/_app/people.$person.tsx):
/// everything of theirs on the shelf, with their headshot and IMDb / TMDB
/// links. Pushed onto any tab's stack.
struct PersonView: View {
  let name: String

  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @State private var links: PersonLinks?

  private static let columns = [
    GridItem(.adaptive(minimum: 104, maximum: 150), spacing: 12, alignment: .top)
  ]

  var body: some View {
    let credits = PersonCredits(name: name, films: library.films)
    Group {
      if !library.hasLoadedFilms {
        if let error = library.loadError {
          LoadFailedView(message: error) { await library.refreshAll() }
        } else {
          LoadingView()
        }
      } else if credits.isEmpty {
        ContentUnavailableView {
          Label(name, systemImage: "person.crop.circle")
        } description: {
          Text("Nothing in your collection features this person — yet.")
        }
        .spineScreenBackground()
      } else {
        page(credits)
      }
    }
    .navigationTitle(name)
    // The empty state already names them, large.
    .navigationBarTitleDisplayMode(library.hasLoadedFilms && credits.isEmpty ? .inline : .large)
    .task(id: credits.linkKey) {
      guard !credits.isEmpty else { return }
      links = await PersonLinkCache.links(
        name: name, tmdbPersonId: credits.tmdbPersonId, api: library.api)
    }
  }

  private func page(_ credits: PersonCredits) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 32) {
        header(credits)

        if !credits.directed.isEmpty {
          section("Directed", systemImage: "movieclapper") {
            ForEach(credits.directed) { film in
              NavigationLink(value: Route.film(id: film.id)) {
                FilmCard(film: film)
              }
              .buttonStyle(.plain)
            }
          }
        }

        if !credits.acted.isEmpty {
          section("Acted in", systemImage: "theatermasks") {
            ForEach(credits.acted, id: \.film.id) { credit in
              NavigationLink(value: Route.film(id: credit.film.id)) {
                VStack(alignment: .leading, spacing: 3) {
                  FilmCard(film: credit.film)
                  if let character = credit.character, !character.isEmpty {
                    Text("as \(character)")
                      .font(.caption)
                      .foregroundStyle(.spineMutedForeground)
                      .lineLimit(1)
                      .padding(.horizontal, 2)
                  }
                }
                .accessibilityElement(children: .combine)
              }
              .buttonStyle(.plain)
            }
          }
        }

        Text("Showing titles from your collection only.")
          .font(.caption)
          .foregroundStyle(.spineMutedForeground)
      }
      .padding(.horizontal, 16)
      .padding(.top, 4)
      .padding(.bottom, 24)
      .frame(maxWidth: 1000)
      .frame(maxWidth: .infinity)
    }
    .spineScreenBackground()
    .refreshable {
      do { try await library.refreshFilms() } catch { toasts.error(error) }
    }
  }

  private func header(_ credits: PersonCredits) -> some View {
    HStack(alignment: .center, spacing: 16) {
      PersonAvatar(name: name, url: credits.profileURL, size: 88)
        .overlay(Circle().strokeBorder(.spineBorder, lineWidth: 1))

      VStack(alignment: .leading, spacing: 12) {
        Text(credits.summary)
          .font(.subheadline)
          .foregroundStyle(.spineMutedForeground)
          .fixedSize(horizontal: false, vertical: true)

        HStack(spacing: 8) {
          if let url = links?.imdbURL {
            Link(destination: url) {
              Label("IMDb", systemImage: "arrow.up.right")
                .labelStyle(PersonLinkLabelStyle())
            }
            .accessibilityLabel("\(name) on IMDb")
          }
          if let url = links?.tmdbURL ?? credits.tmdbURL {
            Link(destination: url) {
              Label("TMDB", systemImage: "arrow.up.right")
                .labelStyle(PersonLinkLabelStyle())
            }
            .accessibilityLabel("\(name) on TMDB")
          }
        }
        .buttonStyle(.glass)
        .controlSize(.small)
        .animation(.default, value: links)
      }
    }
  }

  private func section<Content: View>(
    _ title: String, systemImage: String, @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 6) {
        Image(systemName: systemImage)
          .font(.caption.weight(.semibold))
          .foregroundStyle(.spineMutedForeground)
          .accessibilityHidden(true)
        SectionLabel(title)
      }
      LazyVGrid(columns: Self.columns, alignment: .leading, spacing: 20) {
        content()
      }
    }
  }
}

/// "IMDb ↗" — the title, then a small arrow.
private struct PersonLinkLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.title
      configuration.icon.imageScale(.small)
    }
    .font(.subheadline.weight(.semibold))
  }
}

// MARK: - Credits

/// What the collection holds for one person: films they directed, films
/// they're credited in, and the headshot and TMDB id from the first cast
/// credit that has them.
private struct PersonCredits {
  struct Acted {
    let film: Film
    let character: String?
  }

  var directed: [Film] = []
  var acted: [Acted] = []
  var profilePath: String?
  var tmdbPersonId: Int?

  init(name: String, films: [Film]) {
    for film in films {
      if film.directors.contains(name) { directed.append(film) }
      if let credit = film.tmdbCast?.first(where: { $0.name == name }) {
        acted.append(Acted(film: film, character: credit.character))
        if profilePath == nil { profilePath = credit.profilePath }
        if tmdbPersonId == nil { tmdbPersonId = credit.id }
      }
    }
  }

  var isEmpty: Bool { directed.isEmpty && acted.isEmpty }

  var profileURL: URL? {
    profilePath.flatMap { URL(string: "https://image.tmdb.org/t/p/w185\($0)") }
  }

  var tmdbURL: URL? {
    tmdbPersonId.flatMap { URL(string: "https://www.themoviedb.org/person/\($0)") }
  }

  /// Refetch the links when the person first appears or gains a TMDB id.
  var linkKey: String { "\(isEmpty)-\(tmdbPersonId.map(String.init) ?? "-")" }

  /// "Directed 2 titles · appears in 1 title in your collection".
  var summary: String {
    let parts = [
      directed.isEmpty ? nil : "directed \(Formatters.count(directed.count, "title"))",
      acted.isEmpty ? nil : "appears in \(Formatters.count(acted.count, "title"))",
    ].compactMap { $0 }
    let text = parts.joined(separator: " · ") + " in your collection"
    return text.prefix(1).uppercased() + text.dropFirst()
  }
}

// MARK: - Links

extension PersonLinks {
  fileprivate var imdbURL: URL? {
    imdbId.flatMap { URL(string: "https://www.imdb.com/name/\($0)/") }
  }

  fileprivate var tmdbURL: URL? {
    tmdbPersonId.flatMap { URL(string: "https://www.themoviedb.org/person/\($0)") }
  }
}

/// IMDb / TMDB ids per person for the session — the web caches them
/// forever (`staleTime: Infinity`), and they don't change.
private enum PersonLinkCache {
  private static var entries: [String: PersonLinks] = [:]

  static func links(name: String, tmdbPersonId: Int?, api: APIClient) async -> PersonLinks? {
    let key = "\(name)|\(tmdbPersonId.map(String.init) ?? "")"
    if let cached = entries[key] { return cached }
    // A failure just leaves the buttons out, as on the web.
    guard let links = try? await api.personLinks(name: name, tmdbPersonId: tmdbPersonId)
    else { return nil }
    entries[key] = links
    return links
  }
}
