#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstAttachment")
struct AedstAttachmentTests {
    @Test("the media tile shrinks from default to xs, as web w-10, w-8, w-7")
    func mediaSides() {
        #expect(AedstAttachmentSize.allCases.map(\.mediaSide) == [40, 32, 28])
        #expect(AedstAttachmentSize.xs.cornerRadius < AedstAttachmentSize.default.cornerRadius)
    }

    @Test("a chip grows from 160 pt; a card is 96 pt, 120 pt with text")
    func widths() {
        #expect(AedstAttachmentOrientation.horizontal.width(hasContent: true).min == 160)
        #expect(AedstAttachmentOrientation.horizontal.width(hasContent: true).fixed == nil)
        #expect(AedstAttachmentOrientation.vertical.width(hasContent: false).fixed == 96)
        #expect(AedstAttachmentOrientation.vertical.width(hasContent: true).fixed == 120)
    }

    @Test("busy and failed states are spoken; idle and done say nothing extra")
    func stateValues() {
        #expect(AedstAttachmentState.uploading.accessibilityValue == AedstStrings.attachmentUploading)
        #expect(AedstAttachmentState.processing.accessibilityValue == AedstStrings.attachmentProcessing)
        #expect(AedstAttachmentState.error.accessibilityValue == AedstStrings.attachmentFailed)
        #expect(AedstAttachmentState.idle.accessibilityValue == nil)
        #expect(AedstAttachmentState.done.accessibilityValue == nil)
    }

    @Test("only image media is dimmed, and only while the file is not ready")
    func dimming() {
        #expect(AedstAttachmentState.uploading.dimsMedia(.image))
        #expect(AedstAttachmentState.error.dimsMedia(.image))
        #expect(!AedstAttachmentState.done.dimsMedia(.image))
        #expect(!AedstAttachmentState.idle.dimsMedia(.image))
        #expect(!AedstAttachmentState.uploading.dimsMedia(.icon))
    }
}
#endif
