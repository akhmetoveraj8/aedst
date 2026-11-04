import Foundation
import Nuke
import Testing
@testable import AedstMedia

@Suite("AedstImagePipeline")
struct AedstImagePipelineTests {
    @Test("disk cache is a DataCache named com.aedst.images limited to 150 MB")
    func diskCache() throws {
        let configuration = AedstImagePipeline.makeConfiguration()
        let dataCache = try #require(configuration.dataCache as? DataCache)
        #expect(dataCache.path.lastPathComponent == "com.aedst.images")
        #expect(dataCache.sizeLimit == 150 * 1_024 * 1_024)
        #expect(AedstImagePipeline.dataCacheName == "com.aedst.images")
    }

    @Test("memory cache is dedicated and bounded")
    func memoryCache() throws {
        let configuration = AedstImagePipeline.makeConfiguration()
        let imageCache = try #require(configuration.imageCache as? ImageCache)
        #expect(imageCache !== ImageCache.shared)
        #expect(imageCache.costLimit == 64 * 1_024 * 1_024)
        #expect(configuration.isDecompressionEnabled)
        #expect(!configuration.isProgressiveDecodingEnabled)
    }

    @Test("session sends images unmodified: no extra headers, interceptors, cookies or URLCache")
    func plainSession() throws {
        let configuration = AedstImagePipeline.makeConfiguration()
        let loader = try #require(configuration.dataLoader as? DataLoader)
        let session = loader.session.configuration
        #expect(session.httpAdditionalHeaders == nil || session.httpAdditionalHeaders?.isEmpty == true)
        #expect(session.protocolClasses == nil || session.protocolClasses?.isEmpty == true)
        #expect(session.urlCache == nil)
        #expect(session.httpCookieStorage == nil)
        #expect(!session.httpShouldSetCookies)
    }

    @Test("removeAll empties memory and disk caches")
    func removeAll() async throws {
        let name = "com.aedst.images.test.\(UUID().uuidString)"
        let pipeline = ImagePipeline(configuration: AedstImagePipeline.makeConfiguration(dataCacheName: name))
        let dataCache = try #require(pipeline.configuration.dataCache as? DataCache)
        defer { dataCache.removeAll() }

        dataCache.storeData(Data([1, 2, 3]), for: "k")
        dataCache.flush()
        #expect(dataCache.containsData(for: "k"))

        pipeline.cache.removeAll()
        #expect(!dataCache.containsData(for: "k"))
    }
}
