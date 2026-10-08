import XCTest

/// Base for UI tests that drive the real app against a running Spine server:
/// `SPINE_SERVER`, default http://localhost:3000. Pass it through xcodebuild
/// as `TEST_RUNNER_SPINE_SERVER=…`. Each test makes its own account through
/// the server's auth API, exactly as the web's sign-up page does, so a pass
/// also shows that a web account works in the app.
@MainActor
class SpineUITestCase: XCTestCase {
  struct Account {
    var name: String
    var email: String
    var password: String
  }

  var server: String {
    ProcessInfo.processInfo.environment["SPINE_SERVER"] ?? "http://localhost:3000"
  }

  /// No cookie jar: a stored session cookie sent without an Origin header
  /// makes better-auth refuse the request (its CSRF check), and the shared
  /// session's cookies outlive a test run.
  private let http: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    return URLSession(configuration: config)
  }()

  override func setUp() async throws {
    continueAfterFailure = false
  }

  /// A fresh account, created the way the web's sign-up form creates one.
  func makeAccount() async throws -> Account {
    let slug = UUID().uuidString.prefix(8).lowercased()
    let account = Account(
      name: "UI Test", email: "ui-\(slug)@example.com", password: "correct-horse-battery-staple")
    let token = try await post(
      "api/auth/sign-up/email",
      ["name": account.name, "email": account.email, "password": account.password])
    XCTAssertNotNil(token, "sign-up should issue a session")
    return account
  }

  /// Sign in through the server API and call a server function, as the web
  /// UI would — for seeding data and checking what the app wrote.
  func callAPI(_ account: Account, _ name: String, _ body: [String: Any] = [:]) async throws
    -> Any
  {
    let token = try await post(
      "api/auth/sign-in/email", ["email": account.email, "password": account.password])
    var request = URLRequest(url: URL(string: "\(server)/api/v1/\(name)")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(token ?? "")", forHTTPHeaderField: "Authorization")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await http.data(for: request)
    XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200, "\(name) failed")
    return try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)
  }

  /// The app with no stored session, at the sign-in screen.
  func launchSignedOut() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-SpineResetSession", "YES"]
    app.launch()
    return app
  }

  /// The app signed in as `account` (via the debug launch arguments).
  func launchSignedIn(_ account: Account, extra: [String] = []) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments =
      [
        "-SpineResetSession", "YES",
        "-SpineServer", server,
        "-SpineEmail", account.email,
        "-SpinePassword", account.password,
      ] + extra
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["Collection"].waitForExistence(timeout: 20))
    return app
  }

  /// Type into the sign-in form and submit.
  func signInThroughUI(_ app: XCUIApplication, _ account: Account) {
    let serverField = app.textFields["auth.server"].waitToAppear()
    serverField.tap()
    serverField.typeText(server)
    app.textFields["auth.email"].tap()
    app.textFields["auth.email"].typeText(account.email)
    app.secureTextFields["auth.password"].tap()
    // Return submits, as the keyboard's Go key does.
    app.secureTextFields["auth.password"].typeText(account.password + "\n")
  }

  // MARK: Seeding and checking data

  /// Add a film through the API, as the web's form would. Returns its id.
  @discardableResult
  func createFilm(
    _ account: Account, title: String, year: Int, format: String, barcode: String? = nil
  ) async throws -> String {
    var input: [String: Any] = ["title": title, "year": year, "format": format, "discCount": 1]
    if let barcode { input["barcode"] = barcode }
    let film = try await callAPI(account, "createFilm", input) as? [String: Any]
    return try XCTUnwrap(film?["id"] as? String)
  }

  func film(_ account: Account, titled title: String) async throws -> [String: Any]? {
    let films = try await callAPI(account, "listFilms") as? [[String: Any]]
    return films?.first { $0["title"] as? String == title }
  }

  /// A plain GET against the server, outside the API — e.g. a stored cover.
  func fetch(_ path: String) async throws -> (data: Data, response: HTTPURLResponse) {
    let (data, response) = try await http.data(from: URL(string: "\(server)\(path)")!)
    return (data, try XCTUnwrap(response as? HTTPURLResponse))
  }

  /// Poll the server until `check` holds.
  func eventually(
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

  // MARK: Finding things

  func element(_ app: XCUIApplication, labelStartingWith prefix: String) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
  }

  /// The highest match on screen — a confirmation's button rather than the
  /// control it's anchored to.
  func topmost(_ query: XCUIElementQuery) -> XCUIElement {
    XCTAssertTrue(query.firstMatch.waitForExistence(timeout: 10))
    return query.allElementsBoundByIndex.min { $0.frame.minY < $1.frame.minY }!
  }

  /// The photo picker's first (most recent) photo. The simulator's library
  /// always has some.
  func pickFirstPhoto(_ app: XCUIApplication) {
    let photo = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
      .waitToAppear(timeout: 20)
    // The picker runs out of process, so its cells never report hittable;
    // tap where the cell is.
    photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
  }

  /// Scroll the frontmost scroll view until `element` can be tapped.
  func scroll(_ app: XCUIApplication, toReveal element: XCUIElement, upwards: Bool = false) {
    for _ in 0..<8 where !(element.exists && element.isHittable) {
      let scrollable = app.collectionViews.firstMatch
      if upwards { scrollable.swipeDown() } else { scrollable.swipeUp() }
    }
    XCTAssertTrue(element.isHittable, "\(element) never scrolled into view")
  }

  /// Keep a screenshot in the result bundle, for reviewing the screen.
  func attachScreenshot(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func post(_ path: String, _ body: [String: String]) async throws -> String? {
    var request = URLRequest(url: URL(string: "\(server)/\(path)")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await http.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    XCTAssertEqual(status, 200, "\(path): \(String(decoding: data, as: UTF8.self))")
    return (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "set-auth-token")
  }
}

extension XCUIElement {
  /// Wait for the element, failing the test with a readable message if it
  /// never appears.
  @discardableResult
  func waitToAppear(timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line)
    -> XCUIElement
  {
    XCTAssertTrue(
      waitForExistence(timeout: timeout), "\(self) never appeared", file: file, line: line)
    return self
  }
}
