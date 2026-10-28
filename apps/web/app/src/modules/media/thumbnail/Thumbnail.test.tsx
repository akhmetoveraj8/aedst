import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImageViewer } from "@/modules/media/image/ImageViewer";
import { Thumbnail } from "@/modules/media/thumbnail/Thumbnail";
import { MediaKind } from "@/shared/api/connect/generated/aedst/media/v1/media_pb";
import { messages, renderWithProviders } from "@/test/render";

const image = {
  id: "m1",
  kind: MediaKind.IMAGE,
  filename: "photo.jpg",
  url: "https://cdn.example.test/photo.jpg",
  variants: [],
} as never;

describe("expired media URLs", () => {
  it("replaces a thumbnail that fails to load with the file icon and reports it once", () => {
    const onLoadError = vi.fn();
    renderWithProviders(
      <Thumbnail
        media={image}
        size={96}
        alt="photo.jpg"
        onLoadError={onLoadError}
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "photo.jpg" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("photo.jpg")).toBeInTheDocument();
    expect(onLoadError).toHaveBeenCalledTimes(1);
  });

  it("shows a message instead of a broken image in the viewer", () => {
    renderWithProviders(<ImageViewer media={image} alt="photo.jpg" />);
    fireEvent.error(screen.getByRole("img", { name: "photo.jpg" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      messages.media.player.imageError,
    );
  });
});
