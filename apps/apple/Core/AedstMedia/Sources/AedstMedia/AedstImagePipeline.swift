import Foundation
import Nuke

/// The app-wide Nuke `ImagePipeline` used by `AedstRemoteImage` (lists, feeds,
/// thumbnails, attachments, avatars).
///
/// - Disk cache: Nuke `DataCache` ("com.aedst.images", 150 MB) holding the
///   original bytes, keyed by `ImageRequest.imageID`. Callers pass the stable
///   media id + variant as the key, so presigned URLs that change on every
///   `GetMedia`/`ListMedia` call still hit the cache.
/// - Memory cache: a dedicated `ImageCache` (decoded, downsampled bitmaps).
/// - Network: a plain `URLSession` with no interceptors. Images come from
///   imgproxy or presigned object-storage URLs, which must be sent unmodified:
///   no bearer token, no tracing headers, no cookies, no `URLCache` (Nuke owns
///   the cache).
public enum AedstImagePipeline {
    /// Directory name of the disk cache inside `Caches/`.
    public static let dataCacheName = "com.aedst.images"
    /// Disk cache limit in bytes (150 MB).
    public static let dataCacheSizeLimit = 150 * 1_024 * 1_024
    /// Memory cache limit in bytes (64 MB of decoded bitmaps).
    public static let memoryCacheCostLimit = 64 * 1_024 * 1_024

    /// Process-wide pipeline (one disk cache directory).
    public static let shared = ImagePipeline(configuration: makeConfiguration())

    /// The session configuration for image downloads: deliberately bare.
    static func makeSessionConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        return configuration
    }

    /// Builds the pipeline configuration. `dataCacheName` is overridable for tests.
    static func makeConfiguration(dataCacheName: String = AedstImagePipeline.dataCacheName) -> ImagePipeline.Configuration {
        var configuration = ImagePipeline.Configuration(dataLoader: DataLoader(configuration: makeSessionConfiguration()))
        let dataCache = try? DataCache(name: dataCacheName)
        dataCache?.sizeLimit = dataCacheSizeLimit
        configuration.dataCache = dataCache
        configuration.imageCache = ImageCache(costLimit: memoryCacheCostLimit)
        configuration.isDecompressionEnabled = true
        configuration.isProgressiveDecodingEnabled = false
        return configuration
    }

    /// Drops every cached image (memory and disk), e.g. on sign-out.
    public static func removeAll() async {
        shared.cache.removeAll()
    }
}
