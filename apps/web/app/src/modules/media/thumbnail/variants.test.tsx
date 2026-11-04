import { create } from "@bufbuild/protobuf";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImageViewer } from "@/modules/media/image/ImageViewer";
import { Thumbnail } from "@/modules/media/thumbnail/Thumbnail";
import {
  pickAvatarUrl,
  pickFeedUrl,
  pickImageUrl,
  pickStoryUrl,
  pickThumbnailUrl,
  playbackSources,
  posterUrl,
  presetForSize,
} from "@/modules/media/thumbnail/variants";
import {
  MediaKind,
  MediaSchema,
  VariantKind,
} from "@/shared/api/connect/generated/aedst/media/v1/media_pb";
import { renderWithProviders } from "@/test/render";

const image = create(MediaSchema, {
  kind: MediaKind.IMAGE,
  url: "https://s3/original.jpg",
  contentType: "image/jpeg",
  variants: [
    {
      kind: VariantKind.STORY_1080X1350,
      url: "https://img/story",
      width: 1080,
    },
    { kind: VariantKind.THUMB_64, url: "https://img/t64", width: 64 },
    { kind: VariantKind.AVATAR_256, url: "https://img/a256", width: 256 },
    { kind: VariantKind.CARD_400, url: "https://img/c400", width: 400 },
    { kind: VariantKind.FEED_800X600, url: "https://img/f800", width: 800 },
  ],
});

const video = create(MediaSchema, {
  kind: MediaKind.VIDEO,
  url: "https://s3/original.mov",
  contentType: "video/quicktime",
  variants: [{ kind: VariantKind.POSTER, url: "https://s3/poster.jpg" }],
});

describe("variants", () => {
  it("selects the preset for each UI context", () => {
    expect(pickAvatarUrl(image)).toBe("https://img/a256");
    expect(pickFeedUrl(image)).toBe("https://img/f800");
    expect(pickStoryUrl(image)).toBe("https://img/story");
    expect(pickImageUrl(image, "card_400")).toBe("https://img/c400");
    expect(presetForSize(24)).toBe("thumb_64");
    expect(presetForSize(112)).toBe("avatar_256");
    expect(presetForSize(200)).toBe("card_400");
    expect(pickThumbnailUrl(image, 24)).toBe("https://img/t64");
    expect(pickThumbnailUrl(image, 112)).toBe("https://img/a256");
  });

  it("uses the nearest preset the server returned, then the original", () => {
    const only = create(MediaSchema, {
      kind: MediaKind.IMAGE,
      url: "https://s3/o.png",
      variants: [{ kind: VariantKind.CARD_400, url: "https://img/c400" }],
    });
    expect(pickAvatarUrl(only)).toBe("https://img/c400");
    expect(pickStoryUrl(only)).toBe("https://img/c400");
    const bare = create(MediaSchema, {
      kind: MediaKind.IMAGE,
      url: "https://s3/o.png",
    });
    expect(pickThumbnailUrl(bare, 100)).toBe("https://s3/o.png");
    expect(
      pickThumbnailUrl(create(MediaSchema, { kind: MediaKind.DOCUMENT }), 100),
    ).toBe("");
  });

  it("uses the poster for video and plays the original", () => {
    expect(pickThumbnailUrl(video, 120)).toBe("https://s3/poster.jpg");
    expect(posterUrl(video)).toBe("https://s3/poster.jpg");
    expect(playbackSources(video)).toEqual([
      { url: "https://s3/original.mov", type: "video/quicktime" },
    ]);
    const derived = create(MediaSchema, {
      kind: MediaKind.VIDEO,
      variants: [{ kind: VariantKind.FEED_800X600, url: "https://img/f800" }],
    });
    expect(posterUrl(derived)).toBe("https://img/f800");
  });
});

describe("viewer and thumbnail components", () => {
  it("fall back to the original image and a file icon", () => {
    const original = create(MediaSchema, {
      kind: MediaKind.IMAGE,
      url: "https://s3/o.png",
    });
    renderWithProviders(<ImageViewer media={original} alt="o" />);
    expect(screen.getByRole("img", { name: "o" })).toHaveAttribute(
      "src",
      "https://s3/o.png",
    );
    render(
      <Thumbnail
        media={create(MediaSchema, { kind: MediaKind.DOCUMENT })}
        alt="doc.pdf"
      />,
    );
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  });
});
