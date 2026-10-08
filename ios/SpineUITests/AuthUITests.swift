import XCTest

final class AuthUITests: SpineUITestCase {
  func testAnAccountMadeOnTheWebSignsInToTheApp() async throws {
    let account = try await makeAccount()
    let app = launchSignedOut()

    signInThroughUI(app, account)

    app.tabBars.buttons["Collection"].waitToAppear(timeout: 20)
    app.staticTexts["Your shelf is empty"].waitToAppear()
  }

  func testAWrongPasswordIsRefusedWithTheServersMessage() async throws {
    var account = try await makeAccount()
    account.password = "not-the-password"
    let app = launchSignedOut()

    signInThroughUI(app, account)

    let error = app.staticTexts["auth.error"].waitToAppear()
    XCTAssertEqual(error.label, "Invalid email or password")
    XCTAssertFalse(app.tabBars.buttons["Collection"].exists)
  }

  func testCreatingAnAccountInTheAppSignsIn() async throws {
    let app = launchSignedOut()
    app.segmentedControls["auth.mode"].buttons["Create account"].waitToAppear().tap()

    let email = "ui-\(UUID().uuidString.prefix(8).lowercased())@example.com"
    app.textFields["auth.server"].tap()
    app.textFields["auth.server"].typeText(server)
    app.textFields["auth.name"].waitToAppear().tap()
    app.textFields["auth.name"].typeText("App Signup")
    app.textFields["auth.email"].tap()
    app.textFields["auth.email"].typeText(email)
    let password = app.secureTextFields["auth.password"]
    password.tap()
    // A new-password field brings up iOS's "Use Strong Password?" sheet. It
    // runs out of process, outside the app's accessibility tree, so close it
    // by its ✕'s position (on the password row when the sheet isn't there),
    // then take the field back.
    sleep(2)
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.906, dy: 0.578)).tap()
    sleep(1)
    password.tap()
    password.typeText("correct-horse-battery-staple\n")

    app.tabBars.buttons["Collection"].waitToAppear(timeout: 20)
  }
}
