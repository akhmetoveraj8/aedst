import { create } from "@bufbuild/protobuf";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MediaPlayer } from "@/modules/media/player/MediaPlayer";
import {
  MediaKind,
  MediaSchema,
  MediaStatus,
  VariantKind,
} from "@/shared/api/connect/generated/aedst/media/v1/media_pb";
import { renderWithProviders } from "@/test/render";

const media = (init: Parameters<typeof create<typeof MediaSchema>>[1]) =>
  create(MediaSchema, {
    status: MediaStatus.READY,
    filename: "file.bin",
    url: "https://s3/original",
    ...init,
  });

describe("MediaPlayer", () => {
  it("says a file is still processing instead of rendering it", () => {
    renderWithProviders(
      <MediaPlayer
        media={media({ kind: MediaKind.IMAGE, status: MediaStatus.PROCESSING })}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "This file is still being processed.",
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("says a failed file could not be processed", () => {
    renderWithProviders(
      <MediaPlayer
        media={media({ kind: MediaKind.VIDEO, status: MediaStatus.FAILED })}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "This file couldn’t be processed.",
    );
  });

  it("renders an image with its filename as the alternative text", () => {
    renderWithProviders(
      <MediaPlayer
        media={media({ kind: MediaKind.IMAGE, filename: "cat.jpg" })}
      />,
    );

    expect(screen.getByRole("img", { name: "cat.jpg" })).toHaveAttribute(
      "src",
      "https://s3/original",
    );
  });

  it("renders a video with controls, metadata preload and the stored poster", () => {
    const { container } = renderWithProviders(
      <MediaPlayer
        media={media({
          kind: MediaKind.VIDEO,
          filename: "clip.mp4",
          contentType: "video/mp4",
          variants: [
            { kind: VariantKind.POSTER, url: "https://s3/poster.jpg" },
          ],
        })}
      />,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).toHaveAttribute("poster", "https://s3/poster.jpg");
    expect(video).toHaveAccessibleName("clip.mp4");
    expect(container.querySelector("source")).toHaveAttribute(
      "src",
      "https://s3/original",
    );
  });

  it("renders audio with native controls and a name", () => {
    const { container } = renderWithProviders(
      <MediaPlayer
        media={media({ kind: MediaKind.AUDIO, filename: "voice.ogg" })}
      />,
    );

    const audio = container.querySelector("audio");
    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("src", "https://s3/original");
    expect(audio).toHaveAccessibleName("voice.ogg");
  });

  it("offers documents as a safe new-tab link", () => {
    renderWithProviders(
      <MediaPlayer
        media={media({ kind: MediaKind.DOCUMENT, filename: "report.pdf" })}
      />,
    );

    const link = screen.getByRole("link", { name: "Open report.pdf" });
    expect(link).toHaveAttribute("href", "https://s3/original");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
