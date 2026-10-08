import XCTest

/// Stacked shelves: the builder's "How the discs sit" choice is saved for
/// the web, the Shelves tab draws the shelf as a pile, and a shelf's menu
/// opens its order check.
final class ShelfOrientationUITests: SpineUITestCase {
  func testAStackedShelfIsSavedAndDrawnAsAPile() async throws {
    let account = try await makeAccount()
    try await createFilm(account, title: "Alien", year: 1979, format: "DVD")
    try await createFilm(account, title: "Brazil", year: 1985, format: "DVD")
    try await createFilm(account, title: "Heat", year: 1995, format: "Blu-ray")
    var app = launchSignedIn(account, extra: ["-SpineTab", "shelves"])

    element(app, labelStartingWith: "By format").waitToAppear().tap()
    app.buttons["Options for DVD"].waitToAppear(timeout: 20).tap()
    app.buttons["Edit Shelf"].waitToAppear().tap()

    let stacked = element(app, labelStartingWith: "Stacked flat")
    scroll(app, toReveal: stacked)
    stacked.tap()
    app.buttons["Save"].tap()

    try await eventually {
      let settings = try await self.callAPI(account, "getSettings") as? [String: Any]
      let shelves = settings?["shelves"] as? [[String: Any]] ?? []
      let dvd = shelves.first { $0["name"] as? String == "DVD" }
      let bluray = shelves.first { $0["name"] as? String == "Blu-ray" }
      return dvd?["orientation"] as? String == "stacked" && bluray?["orientation"] == nil
    }

    // The DVD shelf is a pile, first disc on top; the others still stand.
    let pile = app.otherElements["shelf.pile"].waitToAppear()
    let alien = pile.descendants(matching: .any)["Alien, slot 1"].waitToAppear()
    let brazil = pile.descendants(matching: .any)["Brazil, slot 2"]
    XCTAssertTrue(brazil.exists)
    XCTAssertLessThan(alien.frame.midY, brazil.frame.midY, "the first disc lies on top")
    XCTAssertGreaterThan(alien.frame.width, alien.frame.height * 4, "it lies flat")
    XCTAssertEqual(app.otherElements.matching(identifier: "shelf.pile").count, 1)

    // It's still stacked after a fresh launch, and the builder says so.
    app.terminate()
    app = launchSignedIn(account, extra: ["-SpineTab", "shelves"])
    app.otherElements["shelf.pile"].waitToAppear(timeout: 20)
    app.buttons["Options for DVD"].tap()
    app.buttons["Edit Shelf"].waitToAppear().tap()
    let saved = element(app, labelStartingWith: "Stacked flat")
    scroll(app, toReveal: saved)
    XCTAssertTrue(saved.isSelected)
    XCTAssertFalse(element(app, labelStartingWith: "Standing upright").isSelected)
  }

  func testAShelfsMenuOpensItsOrderCheck() async throws {
    let account = try await makeAccount()
    try await createFilm(account, title: "Alien", year: 1979, format: "DVD")
    let app = launchSignedIn(account, extra: ["-SpineTab", "shelves"])

    element(app, labelStartingWith: "By format").waitToAppear().tap()
    app.buttons["Options for DVD"].waitToAppear(timeout: 20).tap()
    app.buttons["Check Order with a Photo"].waitToAppear().tap()

    app.staticTexts["Check the order of “DVD”"].waitToAppear()
    XCTAssertTrue(
      element(app, labelStartingWith: "Photograph the shelf from its left end to its right").exists)
    XCTAssertTrue(app.buttons["Choose Photos"].exists)
  }

  /// Needs a server that can read photos, and the simulator library's
  /// newest photo to be ios/UITestMedia/shelf-bluray.jpg (Dune, Paris,
  /// Texas, Heat, Stalker, Kwaidan, Videodrome, then the DVD of Alien) —
  /// see the README. Skips otherwise.
  func testAPhotographedShelfSaysWhatToMove() async throws {
    let account = try await makeAccount()
    for (title, year) in [
      ("Dune", 1984), ("Heat", 1995), ("Paris, Texas", 1984), ("Stalker", 1979),
      ("Videodrome", 1983),
    ] {
      try await createFilm(account, title: title, year: year, format: "Blu-ray")
    }
    try await createFilm(account, title: "Alien", year: 1979, format: "DVD")
    let app = launchSignedIn(account, extra: ["-SpineTab", "shelves"])

    element(app, labelStartingWith: "By format").waitToAppear().tap()
    app.buttons["Options for Blu-ray"].waitToAppear(timeout: 20).tap()
    app.buttons["Check Order with a Photo"].waitToAppear().tap()
    app.buttons["Choose Photos"].waitToAppear().tap()
    pickFirstPhoto(app)
    app.navigationBars["Photos"].buttons["Done"].tap()

    let read = element(app, labelStartingWith: "Photo 1, read,")
    let failed = element(app, labelStartingWith: "Photo 1, couldn’t be read")
    let deadline = Date().addingTimeInterval(120)
    while Date() < deadline, !read.exists, !failed.exists {
      _ = read.waitForExistence(timeout: 1)
    }
    if failed.exists { throw XCTSkip("This server can't read shelf photos (no ANTHROPIC_API_KEY).") }
    XCTAssertTrue(read.exists, "the photo was never read")
    guard element(app, labelStartingWith: "2. Paris, Texas").exists else {
      throw XCTSkip("The newest photo isn't ios/UITestMedia/shelf-bluray.jpg.")
    }
    XCTAssertTrue(app.staticTexts["1 to move"].exists, "one disc is out of place")
    attachScreenshot(app, "Order check")

    // Paris, Texas stands before Heat; the fewest-moves fix moves it.
    let move = app.descendants(matching: .any).matching(
      NSPredicate(format: "label CONTAINS 'Move Paris, Texas between Heat and Stalker'")
    ).firstMatch
    scroll(app, toReveal: move)
    let alien = element(app, labelStartingWith: "Alien (1979)")
    scroll(app, toReveal: alien)
    XCTAssertTrue(alien.label.contains("DVD"), "Alien belongs on the DVD shelf: \(alien.label)")
    scroll(app, toReveal: app.buttons.matching(identifier: "shelfcheck.add").firstMatch)
    XCTAssertTrue(app.buttons["Add Kwaidan"].exists, "Kwaidan isn't catalogued")
    attachScreenshot(app, "Order check, scrolled")
  }
}
