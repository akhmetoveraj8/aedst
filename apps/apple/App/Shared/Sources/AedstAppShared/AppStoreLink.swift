import Foundation

/// The App Store page of this app, from the numeric Apple ID in the `AEDST_APP_STORE_ID` Info.plist key
/// (`Config/Base.xcconfig`; empty until the app record exists in App Store Connect). `https://apps.apple.com/app/id<ID>`
/// opens the App Store on iOS and the Mac App Store on macOS.
enum AppStoreLink {
    static func url(forID raw: String?) -> URL? {
        guard let id = raw?.trimmingCharacters(in: .whitespaces),
              !id.isEmpty, id.allSatisfy(\.isASCII), id.allSatisfy(\.isNumber)
        else { return nil }
        return URL(string: "https://apps.apple.com/app/id\(id)")
    }
}

extension AppDependencies {
    static func appStoreURL(bundle: Bundle) -> URL? {
        AppStoreLink.url(forID: bundle.object(forInfoDictionaryKey: "AEDST_APP_STORE_ID") as? String)
    }
}
