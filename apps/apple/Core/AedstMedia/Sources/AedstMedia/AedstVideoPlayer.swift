import AVFoundation
import AVKit
import SwiftUI

/// Video playback through the system player UI: `AVPlayerViewController` on
/// iOS (full-screen, AirPlay, Picture in Picture, system captions) and
/// `AVPlayerView` on macOS. One wrapper on both platforms instead of
/// SwiftUI's `VideoPlayer`, whose controls are a subset of these.
///
/// Presigned URLs expire (see `MediaService`); a screen that can stay open
/// longer than the URL lifetime should re-fetch the media and pass the new URL
/// (the player is rebuilt when `url` changes).
public struct AedstVideoPlayer: View {
    private let url: URL
    @State private var player: AVPlayer?

    /// Plays `url` (remote or local file).
    public init(url: URL) {
        self.url = url
    }

    public var body: some View {
        Group {
            if let player {
                PlayerRepresentable(player: player)
            } else {
                Color.black
            }
        }
        .onAppear {
            if player == nil { player = AVPlayer(url: url) }
        }
        .onChange(of: url) { _, newURL in
            player?.pause()
            player = AVPlayer(url: newURL)
        }
        .onDisappear { player?.pause() }
    }
}

#if os(iOS)
private struct PlayerRepresentable: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.allowsPictureInPicturePlayback = true
        controller.canStartPictureInPictureAutomaticallyFromInline = false
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player {
            controller.player = player
        }
    }
}
#elseif os(macOS)
private struct PlayerRepresentable: NSViewRepresentable {
    let player: AVPlayer

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.player = player
        view.controlsStyle = .inline
        view.allowsPictureInPicturePlayback = true
        return view
    }

    func updateNSView(_ view: AVPlayerView, context: Context) {
        if view.player !== player {
            view.player = player
        }
    }
}
#endif
