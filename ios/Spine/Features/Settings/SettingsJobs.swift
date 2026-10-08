import Foundation
import Observation

/// The Settings syncs and backfills. The server runs each to completion
/// before answering — minutes for a large collection — so they live here
/// rather than in the sheet: closing Settings doesn't cancel one, reopening
/// shows it still running, and the result arrives as a toast either way.
@Observable
final class SettingsJobs {
  static let shared = SettingsJobs()

  enum Job: Hashable, CaseIterable {
    case letterboxd, letterboxdHistory, tmdbCast, tmdbDetails, rottenTomatoes, criterionSpines
  }

  private struct Key: Hashable {
    let userID: String
    let job: Job
  }

  /// When each running job started, per account.
  private var started: [Key: Date] = [:]

  /// When `job` started for this account, or nil when it isn't running.
  func startDate(of job: Job, for library: Library) -> Date? {
    started[Key(userID: library.userID, job: job)]
  }

  func run(_ job: Job, library: Library, toasts: Toasts) {
    let key = Key(userID: library.userID, job: job)
    guard started[key] == nil else { return }
    started[key] = .now
    Task {
      defer { started[key] = nil }
      do {
        let result = try await Self.perform(job, api: library.api)
        await library.refreshAfterSync()
        if result.ok { toasts.success(result.message) } else { toasts.error(result.message) }
      } catch is CancellationError {
      } catch APIError.unauthorized {
      } catch APIError.transport(let message) {
        toasts.error(message)
      } catch {
        toasts.error(job.failureMessage)
      }
    }
  }

  /// Runs the job and phrases the result exactly as the web's toasts do.
  private static func perform(_ job: Job, api: APIClient) async throws -> (
    ok: Bool, message: String
  ) {
    switch job {
    case .letterboxd:
      return try await api.syncLetterboxd().settingsMessage { result in
        result.matched > 0
          ? "Synced — \(Formatters.count(result.matched, "title")) newly marked watched"
          : "Synced — no new first-time watches matched (\(result.scanned) diary entries checked)"
      }
    case .letterboxdHistory:
      return try await api.syncLetterboxdHistory().settingsMessage { result in
        guard result.matched > 0 else {
          return "Full history synced — no new matches (\(result.filmsSeen) films checked)"
        }
        let reviews =
          result.reviews > 0 ? ", \(Formatters.count(result.reviews, "review")) pulled in" : ""
        return
          "Full history synced — \(Formatters.count(result.matched, "title")) matched (\(result.filmsSeen) films across \(Formatters.count(result.pages, "page")))\(reviews)"
      }
    case .tmdbCast:
      return try await api.syncTmdbCast().settingsMessage { result in
        result.scanned == 0
          ? "All films already have cast data"
          : "Cast fetched for \(result.updated) of \(Formatters.count(result.scanned, "film"))\(unmatched(result, "no TMDB match"))"
      }
    case .tmdbDetails:
      return try await api.syncTmdbDetails().settingsMessage { result in
        result.scanned == 0
          ? "All films already have TMDB details"
          : "Details fetched for \(result.updated) of \(Formatters.count(result.scanned, "film"))\(unmatched(result, "no TMDB match"))"
      }
    case .rottenTomatoes:
      return try await api.syncRottenTomatoes().settingsMessage { result in
        result.scanned == 0
          ? "All films already have Rotten Tomatoes scores"
          : "Scores fetched for \(result.updated) of \(Formatters.count(result.scanned, "film"))\(unmatched(result, "no match"))"
      }
    case .criterionSpines:
      return try await api.syncCriterionSpines().settingsMessage { result in
        result.scanned == 0
          ? "All Criterion titles already have spine numbers (list has \(result.listSize) entries)"
          : "Spine numbers filled for \(result.updated) of \(Formatters.count(result.scanned, "Criterion title"))"
      }
    }
  }

  private static func unmatched(_ result: BackfillResult, _ phrase: String) -> String {
    result.unmatched > 0 ? " (\(result.unmatched) had \(phrase))" : ""
  }
}

extension SettingsJobs.Job {
  /// The web's `onError` toast, for a request that failed outright.
  fileprivate var failureMessage: String {
    switch self {
    case .letterboxd: "Sync failed"
    case .letterboxdHistory: "History sync failed"
    case .tmdbCast: "TMDB sync failed"
    case .tmdbDetails: "TMDB details sync failed"
    case .rottenTomatoes: "Rotten Tomatoes sync failed"
    case .criterionSpines: "Spine sync failed"
    }
  }
}

extension Outcome {
  /// The toast for this result: the success phrased by `phrase`, or the
  /// server's in-band error.
  fileprivate func settingsMessage(_ phrase: (Value) -> String) -> (ok: Bool, message: String) {
    switch self {
    case .success(let value): (true, phrase(value))
    case .failure(let message): (false, message)
    }
  }
}
