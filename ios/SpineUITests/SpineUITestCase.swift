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
