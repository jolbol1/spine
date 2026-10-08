import UIKit
import XCTest

/// Duplicate warnings, the shelf check, and scanned covers — driven through
/// the app and checked on the server. The simulator has no document camera,
/// so cover scans go through its photo-picker fallback.
final class PhotoFeaturesUITests: SpineUITestCase {
  // MARK: Duplicates

  func testTypingATitleAlreadyCataloguedWarnsAndOffersAnotherCopy() async throws {
    let account = try await makeAccount()
    try await createFilm(account, title: "Stalker", year: 1979, format: "Blu-ray")
    let app = launchSignedIn(account, extra: ["-SpineSheet", "add"])

    app.buttons["Add to collection"].waitToAppear()
    let title = app.textFields.matching(NSPredicate(format: "placeholderValue == 'Required'"))
      .firstMatch.waitToAppear()
    title.tap()
    // Case and a leading article don't matter.
    title.typeText("the stalker")

    app.buttons["Add another copy"].waitToAppear()
    XCTAssertFalse(app.buttons["Add to collection"].exists)
    attachScreenshot(app, "Add another copy")

    // The warning names the catalogued copy, and opens it.
    app.buttons["Done"].firstMatch.tap()
    let match = element(app, labelStartingWith: "Stalker (1979) · Blu-ray")
    scroll(app, toReveal: match)
    XCTAssertTrue(
      element(app, labelStartingWith: "Stalker (1979) · Blu-ray, Already in your collection").exists)
    attachScreenshot(app, "Duplicate warning")
    match.tap()
    app.staticTexts["DISC DETAILS"].waitToAppear()
    let films = try await callAPI(account, "listFilms") as? [Any]
    XCTAssertEqual(films?.count, 1, "nothing was added")
  }

  func testScanningACataloguedBarcodeOffersToOpenIt() async throws {
    let account = try await makeAccount()
    try await createFilm(
      account, title: "Test Barcode Film", year: 2021, format: "4K UHD", barcode: "5051892234953")
    let app = launchSignedIn(account, extra: ["-SpineSheet", "scan"])

    // No camera on the simulator: the scanner takes the barcode typed in.
    let field = app.textFields.matching(
      NSPredicate(format: "placeholderValue == 'Barcode (UPC/EAN)'")
    ).firstMatch.waitToAppear()
    field.tap()
    field.typeText("5051892234953")
    app.buttons["Look up barcode"].tap()

    element(app, labelStartingWith: "Already in your collection: Test Barcode Film (2021) · 4K UHD")
      .waitToAppear()
    XCTAssertTrue(app.buttons["Look it up anyway"].exists)
    XCTAssertFalse(app.staticTexts["Searching Blu-ray.com…"].exists, "no lookup for a known disc")
    attachScreenshot(app, "Scanned a catalogued barcode")

    app.buttons["Open"].tap()
    app.staticTexts["DISC DETAILS"].waitToAppear()
    XCTAssertTrue(app.staticTexts["Test Barcode Film"].firstMatch.exists)
  }

  // MARK: Shelf check

  func testAShelfCheckShowsWhyAPhotoCouldntBeRead() async throws {
    let account = try await makeAccount()
    let app = launchSignedIn(account, extra: ["-SpineTab", "shelves"])

    app.buttons["Check a shelf photo"].waitToAppear().tap()
    app.staticTexts["Check a shelf photo"].waitToAppear()
    app.buttons["Choose Photos"].tap()
    pickFirstPhoto(app)
    app.navigationBars["Photos"].buttons["Done"].tap()

    // A server without ANTHROPIC_API_KEY fails the photo with its own
    // message, and it can be tried again.
    guard try readOutcome(app) == .failed else {
      throw XCTSkip("This server can read shelf photos, so there's no missing-key error to show.")
    }
    XCTAssertTrue(
      app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'ANTHROPIC_API_KEY'")).firstMatch
        .exists)
    XCTAssertTrue(app.staticTexts["Photo 1"].exists)
    XCTAssertTrue(app.buttons["Try Again"].exists)
    XCTAssertTrue(element(app, labelStartingWith: "Photo 1, couldn’t be read").exists)
    attachScreenshot(app, "Missing-key error")
  }

  /// Needs a server that can read photos, and a newest photo in the
  /// simulator's library with a disc spine on it (ios/UITestMedia — see the
  /// README); a fresh account has none of them catalogued. Skips otherwise.
  func testASpineAddedFromTheShelfCheckShowsAsAdded() async throws {
    let account = try await makeAccount()
    let app = launchSignedIn(account, extra: ["-SpineTab", "shelves", "-SpineOpen", "shelf-check"])

    app.buttons["Choose Photos"].waitToAppear().tap()
    pickFirstPhoto(app)
    app.navigationBars["Photos"].buttons["Done"].tap()
    guard try readOutcome(app) == .read else {
      throw XCTSkip("This server can't read shelf photos (no ANTHROPIC_API_KEY).")
    }
    let add = app.buttons.matching(identifier: "shelfcheck.add").firstMatch
    guard add.waitForExistence(timeout: 5) else {
      throw XCTSkip("The newest photo has no disc spines on it.")
    }
    let title = String(add.label.dropFirst("Add ".count))
    add.tap()

    // The Add sheet opens searching Blu-ray.com for the spine ("Dune 1984"),
    // its title filled in below; adding closes it back to the shelf check.
    app.navigationBars["Add a film"].waitToAppear()
    app.textFields.matching(NSPredicate(format: "value BEGINSWITH %@", title)).firstMatch
      .waitToAppear()
    app.buttons["Add to collection"].tap()
    try await eventually(timeout: 40) { try await self.film(account, titled: title) != nil }
    app.navigationBars["Shelf check"].waitToAppear(timeout: 20)
    element(app, labelStartingWith: title).waitToAppear()
    app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Added'"))
      .firstMatch.waitToAppear()
    XCTAssertFalse(app.staticTexts["DISC DETAILS"].exists, "stays on the shelf check")
    attachScreenshot(app, "Added from the shelf check")
  }

  func testTheCollectionAddMenuOpensTheShelfCheck() async throws {
    let account = try await makeAccount()
    let app = launchSignedIn(account)

    app.navigationBars.buttons["Add"].waitToAppear().tap()
    app.buttons["Check a shelf photo"].waitToAppear().tap()
    app.staticTexts["Check a shelf photo"].waitToAppear()
    XCTAssertTrue(app.navigationBars["Shelf check"].exists)
  }

  // MARK: Covers

  func testAScannedCoverReplacesTheFilmsCoverOnTheServer() async throws {
    let account = try await makeAccount()
    let id = try await createFilm(account, title: "Test Cover Film", year: 1979, format: "Blu-ray")
    let app = launchSignedIn(account, extra: ["-SpineOpen", "film:\(id)"])

    app.buttons["Scan new cover"].waitToAppear().tap()
    pickFirstPhoto(app)
    app.buttons["Use cover"].waitToAppear(timeout: 20).tap()
    app.staticTexts["Cover updated"].waitToAppear(timeout: 30)

    let cover = try await storedCover(account, titled: "Test Cover Film")
    // Squared off to a Blu-ray case's front.
    XCTAssertEqual(cover.size, CGSize(width: 1052, height: 1200))
  }

  func testAScannedCoverFillsTheAddFormAndIsSaved() async throws {
    let account = try await makeAccount()
    let app = launchSignedIn(account, extra: ["-SpineSheet", "add"])

    let title = app.textFields.matching(NSPredicate(format: "placeholderValue == 'Required'"))
      .firstMatch.waitToAppear()
    title.tap()
    title.typeText("Test Scanned DVD")
    app.buttons["Done"].firstMatch.tap()
    // A DVD cover is narrower than a Blu-ray's.
    app.buttons["Format, Blu-ray"].firstMatch.tap()
    app.buttons["DVD"].waitToAppear().tap()
    scroll(app, toReveal: app.buttons["Scan cover"], upwards: true)
    app.buttons["Scan cover"].tap()
    pickFirstPhoto(app)
    app.buttons["Use cover"].waitToAppear(timeout: 20).tap()

    // The form's cover field now holds the stored cover's path.
    app.textFields.matching(NSPredicate(format: "value BEGINSWITH '/api/covers/'")).firstMatch
      .waitToAppear(timeout: 30)
    app.buttons["Add to collection"].tap()
    app.staticTexts["DISC DETAILS"].waitToAppear(timeout: 30)

    let cover = try await storedCover(account, titled: "Test Scanned DVD")
    XCTAssertEqual(cover.size, CGSize(width: 849, height: 1200))
  }

  // MARK: Helpers

  private enum ReadOutcome { case read, failed }

  /// Wait for the first photo's reading: spines, or the server's error.
  private func readOutcome(_ app: XCUIApplication) throws -> ReadOutcome {
    let read = element(app, labelStartingWith: "Photo 1, read,")
    let failed = element(app, labelStartingWith: "Photo 1, couldn’t be read")
    let deadline = Date().addingTimeInterval(120)
    while Date() < deadline {
      if read.exists { return .read }
      if failed.exists { return .failed }
      _ = read.waitForExistence(timeout: 1)
    }
    XCTFail("the photo was never read")
    throw XCTSkip("no reading")
  }

  /// The film's cover once it's a stored one: its path is relative, and the
  /// server serves it publicly as a JPEG.
  private func storedCover(_ account: Account, titled title: String) async throws -> UIImage {
    var path = ""
    try await eventually(timeout: 30) {
      path = try await self.film(account, titled: title)?["coverUrl"] as? String ?? ""
      return path.wholeMatch(of: /\/api\/covers\/[0-9a-f-]{36}/) != nil
    }
    let (data, response) = try await fetch(path)
    XCTAssertEqual(response.statusCode, 200)
    XCTAssertEqual(response.value(forHTTPHeaderField: "Content-Type"), "image/jpeg")
    return try XCTUnwrap(UIImage(data: data), "the stored cover should be an image")
  }
}
