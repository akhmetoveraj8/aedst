import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Paged, swipeable slides matching shadcn/ui `Carousel`: a horizontally paging `ScrollView` (native swipe
/// on touch, trackpad and scroll wheel on the Mac) with previous/next buttons and page dots. The paging
/// direction follows the layout direction, so right-to-left locales swipe the other way.
///
/// VoiceOver treats the page indicator as one adjustable element ("Slide 2 of 5"): swipe up or down to change
/// the slide. Programmatic slide changes are not animated when Reduce Motion is on.
public struct AedstCarousel<Item: Identifiable, Content: View>: View {
    private let items: [Item]
    @Binding private var selection: Int
    private let showsControls: Bool
    private let content: (Item) -> Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameters:
    ///   - items: The slides' data.
    ///   - selection: 0-based index of the visible slide.
    ///   - showsControls: Shows the previous/next buttons (the page dots are always shown).
    ///   - content: Builds one slide; it is given the full width of the carousel.
    public init(
        _ items: [Item],
        selection: Binding<Int>,
        showsControls: Bool = true,
        @ViewBuilder content: @escaping (Item) -> Content
    ) {
        self.items = items
        self._selection = selection
        self.showsControls = showsControls
        self.content = content
    }

    public var body: some View {
        VStack(spacing: AedstSpacing.sm) {
            HStack(spacing: AedstSpacing.xs) {
                if showsControls {
                    AedstIconButton(
                        systemImage: "chevron.backward",
                        accessibilityLabel: AedstStrings.previousSlide,
                        variant: .outline,
                        size: .iconSm,
                        isDisabled: current <= 0
                    ) {
                        show(current - 1)
                    }
                }
                slides
                if showsControls {
                    AedstIconButton(
                        systemImage: "chevron.forward",
                        accessibilityLabel: AedstStrings.nextSlide,
                        variant: .outline,
                        size: .iconSm,
                        isDisabled: current >= items.count - 1
                    ) {
                        show(current + 1)
                    }
                }
            }
            if items.count > 1 {
                indicator
            }
        }
    }

    private var current: Int { AedstCarouselIndex.clamped(selection, count: items.count) }

    /// `scrollPosition(id:)` needs an optional binding; the slide ids are their indices.
    private var position: Binding<Int?> {
        Binding(
            get: { current },
            set: { newValue in
                if let newValue, newValue != selection { selection = newValue }
            }
        )
    }

    private var slides: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: AedstSpacing.none) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    content(item)
                        .containerRelativeFrame(.horizontal)
                        .id(index)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: position)
        .scrollIndicators(.hidden)
    }

    private var indicator: some View {
        HStack(spacing: AedstSpacing.xs) {
            ForEach(items.indices, id: \.self) { index in
                Circle()
                    .fill(index == current ? AedstColor.primary : AedstColor.border)
                    .frame(width: AedstSpacing.sm, height: AedstSpacing.sm)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(AedstStrings.slideOf((current + 1).formatted(), items.count.formatted())))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: show(current + 1)
            case .decrement: show(current - 1)
            @unknown default: break
            }
        }
    }

    private func show(_ index: Int) {
        let target = AedstCarouselIndex.clamped(index, count: items.count)
        guard target != selection else { return }
        withAnimation(reduceMotion ? nil : .easeInOut(duration: AedstMotion.durationSlow)) {
            selection = target
        }
    }
}

/// Index arithmetic of `AedstCarousel`, kept out of the generic view so it can be unit-tested.
enum AedstCarouselIndex {
    /// `index` limited to `0..<count` (0 for an empty carousel).
    static func clamped(_ index: Int, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return min(max(index, 0), count - 1)
    }
}

private struct AedstCarouselPreviewSlide: Identifiable {
    let id: Int
}

#Preview("AedstCarousel") {
    @Previewable @State var selection = 0
    AedstCarousel((1...5).map { AedstCarouselPreviewSlide(id: $0) }, selection: $selection) { slide in
        AedstCard {
            Text(verbatim: slide.id.formatted())
                .font(AedstTypography.largeTitle)
                .frame(maxWidth: .infinity, minHeight: 120)
        }
        .padding(.horizontal, AedstSpacing.xs)
    }
    .padding()
}

#endif
