import XCTest

/// The main flows, driven through the app and checked on the server — what
/// the app writes is what the web reads.
final class FlowUITests: SpineUITestCase {
  func testFilmsAddedOnTheWebShowUpAndOpenInTheApp() async throws {
    let account = try await makeAccount()
    try await createFilm(account, title: "Stalker", year: 1979, format: "Blu-ray")
    try await createFilm(account, title: "Alien", year: 1979, format: "DVD")
    let app = launchSignedIn(account)

    element(app, labelStartingWith: "Alien").waitToAppear()
    element(app, labelStartingWith: "Stalker").waitToAppear().tap()

    app.staticTexts["DISC DETAILS"].waitToAppear()
    app.buttons["Mark watched"].waitToAppear().tap()

    try await eventually {
      let film = try await self.film(account, titled: "Stalker")
      return film?["watchedOverride"] as? Bool == true
    }
  }

  func testAFilmAddedInTheAppIsSavedForTheWeb() async throws {
    let account = try await makeAccount()
    let app = launchSignedIn(account, extra: ["-SpineSheet", "add"])

    let title = app.textFields.matching(NSPredicate(format: "placeholderValue == 'Required'"))
      .firstMatch.waitToAppear()
    title.tap()
    title.typeText("Test App Film")
    app.buttons["Add to collection"].waitToAppear().tap()

    // The sheet closes and the new film opens.
    app.staticTexts["DISC DETAILS"].waitToAppear(timeout: 30)
    try await eventually { try await self.film(account, titled: "Test App Film") != nil }
  }

  func testEditingAndDeletingAFilmReachTheServer() async throws {
    let account = try await makeAccount()
    let id = try await createFilm(account, title: "Solaris", year: 1972, format: "Blu-ray")
    let app = launchSignedIn(account, extra: ["-SpineOpen", "film:\(id)"])

    app.buttons["Edit"].waitToAppear().tap()
    let title = app.textFields.matching(NSPredicate(format: "value == 'Solaris'")).firstMatch
      .waitToAppear()
    // A double tap selects the one-word title, so typing replaces it.
    title.doubleTap()
    title.typeText("Solaris (Director's Cut)")
    app.buttons["Save changes"].waitToAppear().tap()
    try await eventually { try await self.film(account, titled: "Solaris (Director's Cut)") != nil }

    app.buttons["Delete film"].waitToAppear().tap()
    topmost(app.buttons.matching(NSPredicate(format: "label == 'Delete'"))).tap()
    try await eventually {
      (try await self.callAPI(account, "listFilms") as? [Any])?.isEmpty == true
    }
  }

  func testAWishlistItemCanBeAddedAndMovedToTheCollection() async throws {
    let account = try await makeAccount()
    let app = launchSignedIn(account, extra: ["-SpineTab", "wishlist"])

    app.buttons["Add manually"].firstMatch.waitToAppear().tap()
    let title = app.textFields.matching(
      NSPredicate(format: "placeholderValue == 'Title (required)'")
    ).firstMatch.waitToAppear()
    title.tap()
    title.typeText("Andrei Rublev")
    app.buttons["Save to wishlist"].waitToAppear().tap()

    element(app, labelStartingWith: "Andrei Rublev").waitToAppear()
    try await eventually {
      (try await self.callAPI(account, "listWishlist") as? [Any])?.count == 1
    }

    app.buttons["Bought it"].firstMatch.waitToAppear().tap()
    try await eventually {
      let wishlist = try await self.callAPI(account, "listWishlist") as? [Any]
      let film = try await self.film(account, titled: "Andrei Rublev")
      return wishlist?.isEmpty == true && film != nil
    }
  }

  func testSettingsSaveTheLetterboxdUsernameAndSignOut() async throws {
    let account = try await makeAccount()
    let app = launchSignedIn(account, extra: ["-SpineSheet", "settings"])

    let username = app.textFields.matching(
      NSPredicate(format: "placeholderValue == 'e.g. davidehrlich'")
    ).firstMatch.waitToAppear()
    username.tap()
    username.typeText("spine_ui_test")
    app.buttons["Save"].firstMatch.waitToAppear().tap()

    // The toast shows above the still-open sheet.
    app.staticTexts["Settings saved"].waitToAppear()
    try await eventually {
      let settings = try await self.callAPI(account, "getSettings") as? [String: Any]
      return settings?["letterboxdUsername"] as? String == "spine_ui_test"
    }

    app.buttons["Sign Out"].firstMatch.tap()
    // The confirmation's button, above the list row it's anchored to.
    app.staticTexts["Sign out of Spine?"].waitToAppear()
    topmost(app.buttons.matching(NSPredicate(format: "label == 'Sign Out'"))).tap()
    app.buttons["auth.submit"].waitToAppear()
  }

  func testShelvesFromATemplateAreSaved() async throws {
    let account = try await makeAccount()
    try await createFilm(account, title: "Heat", year: 1995, format: "4K UHD")
    let app = launchSignedIn(account, extra: ["-SpineTab", "shelves"])

    element(app, labelStartingWith: "By format").waitToAppear().tap()

    try await eventually {
      let settings = try await self.callAPI(account, "getSettings") as? [String: Any]
      return ((settings?["shelves"] as? [Any])?.count ?? 0) > 0
    }
    element(app, labelStartingWith: "Heat").waitToAppear()
  }

  func testTheOracleChoosesFromTheShelf() async throws {
    let account = try await makeAccount()
    try await createFilm(account, title: "Videodrome", year: 1983, format: "Blu-ray")
    let app = launchSignedIn(account, extra: ["-SpineTab", "oracle"])

    app.buttons["Consult the Oracle"].waitToAppear().tap()
    element(app, labelStartingWith: "Videodrome").waitToAppear()
  }

  func testStatsCountTheCollection() async throws {
    let account = try await makeAccount()
    try await createFilm(account, title: "Jaws", year: 1975, format: "DVD")
    let app = launchSignedIn(account, extra: ["-SpineTab", "stats"])

    app.staticTexts["TOTAL DISCS"].waitToAppear()
  }

  // MARK: Helpers

  @discardableResult
  private func createFilm(_ account: Account, title: String, year: Int, format: String)
    async throws -> String
  {
    let film = try await callAPI(
      account, "createFilm",
      ["title": title, "year": year, "format": format, "discCount": 1]) as? [String: Any]
    return try XCTUnwrap(film?["id"] as? String)
  }

  private func film(_ account: Account, titled title: String) async throws -> [String: Any]? {
    let films = try await callAPI(account, "listFilms") as? [[String: Any]]
    return films?.first { $0["title"] as? String == title }
  }

  private func element(_ app: XCUIApplication, labelStartingWith prefix: String) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
  }

  /// The highest match on screen — a confirmation's button rather than the
  /// control it's anchored to.
  private func topmost(_ query: XCUIElementQuery) -> XCUIElement {
    XCTAssertTrue(query.firstMatch.waitForExistence(timeout: 10))
    return query.allElementsBoundByIndex.min { $0.frame.minY < $1.frame.minY }!
  }

  /// Poll the server until `check` holds.
  private func eventually(
    timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line,
    _ check: @escaping () async throws -> Bool
  ) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if try await check() { return }
      try await Task.sleep(for: .milliseconds(500))
    }
    XCTFail("the server never reached the expected state", file: file, line: line)
  }
}
