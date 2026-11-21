import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TaskAttachments } from "@/modules/media/ui/TaskAttachments";
import {
  MediaKind,
  MediaService,
  MediaStatus,
  VariantKind,
} from "@/shared/api/connect/generated/aedst/media/v1/media_pb";
import { backend, rpc } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

const t = messages.media;
const TASK_ID = "00000000-0000-4000-8000-000000000301";

const image = {
  id: "00000000-0000-4000-8000-000000000302",
  kind: MediaKind.IMAGE,
  status: MediaStatus.READY,
  filename: "photo.jpg",
  contentType: "image/jpeg",
  url: "https://storage.example/photo.jpg",
  width: 1600,
  height: 1200,
  variants: [
    {
      kind: VariantKind.AVATAR_256,
      url: "https://storage.example/avatar_256",
      width: 256,
      height: 256,
    },
    {
      kind: VariantKind.FEED_800X600,
      url: "https://storage.example/feed_800x600",
      width: 800,
      height: 600,
    },
  ],
};
const video = {
  id: "00000000-0000-4000-8000-000000000303",
  kind: MediaKind.VIDEO,
  status: MediaStatus.READY,
  filename: "clip.mp4",
  contentType: "video/mp4",
  url: "https://storage.example/clip.mp4",
  variants: [
    {
      kind: VariantKind.POSTER,
      url: "https://storage.example/poster.jpg",
      width: 640,
    },
  ],
};
const pdf = {
  id: "00000000-0000-4000-8000-000000000304",
  kind: MediaKind.DOCUMENT,
  status: MediaStatus.READY,
  filename: "notes.pdf",
  url: "https://storage.example/notes.pdf",
};
const processing = {
  id: "00000000-0000-4000-8000-000000000305",
  kind: MediaKind.AUDIO,
  status: MediaStatus.PROCESSING,
  filename: "memo.m4a",
};

describe("TaskAttachments", () => {
  it("lists the task's files and opens each kind with the right native player", async () => {
    let listedFor = "";
    backend.use(
      rpc(MediaService.method.listMedia, (input) => {
        listedFor = input.taskId;
        return { media: [image, video, pdf, processing] };
      }),
    );
    renderWithProviders(<TaskAttachments taskId={TASK_ID} />);

    const openImage = await screen.findByRole("button", {
      name: t.attachments.open.replace("{name}", "photo.jpg"),
    });
    expect(listedFor).toBe(TASK_ID);
    expect(within(openImage).getByRole("img")).toHaveAttribute(
      "src",
      "https://storage.example/avatar_256",
    );
    expect(screen.getByText(t.attachments.processing)).toBeInTheDocument();

    await userEvent.click(openImage);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("img", { name: "photo.jpg" }),
    ).toHaveAttribute("src", "https://storage.example/photo.jpg");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(
      screen.getByRole("button", {
        name: t.attachments.open.replace("{name}", "clip.mp4"),
      }),
    );
    const player = (await screen.findByRole("dialog")).querySelector("video");
    expect(player).toHaveAttribute(
      "poster",
      "https://storage.example/poster.jpg",
    );
    expect(player?.querySelector("source")).toHaveAttribute(
      "src",
      "https://storage.example/clip.mp4",
    );
    await userEvent.keyboard("{Escape}");

    await userEvent.click(
      screen.getByRole("button", {
        name: t.attachments.open.replace("{name}", "notes.pdf"),
      }),
    );
    expect(
      await screen.findByRole("link", {
        name: t.player.open.replace("{name}", "notes.pdf"),
      }),
    ).toHaveAttribute("rel", "noopener noreferrer");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(
      screen.getByRole("button", {
        name: t.attachments.open.replace("{name}", "memo.m4a"),
      }),
    );
    expect(await screen.findByText(t.player.processing)).toBeInTheDocument();
  }, 20_000);

  it("deletes an attachment", async () => {
    const deleted: string[] = [];
    backend.use(
      rpc(MediaService.method.listMedia, () => ({
        media: deleted.length ? [] : [pdf],
      })),
      rpc(MediaService.method.deleteMedia, (input) => {
        deleted.push(input.id);
        return {};
      }),
    );
    renderWithProviders(<TaskAttachments taskId={TASK_ID} />);

    await userEvent.click(
      await screen.findByRole("button", {
        name: t.attachments.delete.replace("{name}", "notes.pdf"),
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: t.attachments.deleteConfirmAction,
      }),
    );
    await waitFor(() => expect(deleted).toEqual([pdf.id]));
    expect(await screen.findByText(t.attachments.empty)).toBeInTheDocument();
  });

  it("asks before deleting and keeps the attachment on cancel", async () => {
    const deleted: string[] = [];
    backend.use(
      rpc(MediaService.method.listMedia, () => ({ media: [pdf] })),
      rpc(MediaService.method.deleteMedia, (input) => {
        deleted.push(input.id);
        return {};
      }),
    );
    renderWithProviders(<TaskAttachments taskId={TASK_ID} />);

    await userEvent.click(
      await screen.findByRole("button", {
        name: t.attachments.delete.replace("{name}", "notes.pdf"),
      }),
    );
    expect(
      await screen.findByText(t.attachments.deleteConfirmTitle),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: t.attachments.deleteCancelAction }),
    );
    expect(deleted).toEqual([]);
    expect(
      screen.getByRole("button", {
        name: t.attachments.delete.replace("{name}", "notes.pdf"),
      }),
    ).toBeInTheDocument();
  });
});
