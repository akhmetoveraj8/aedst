import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { renderWithProviders } from "@/test/render";

describe("overlay focus", () => {
  it("Dialog moves focus inside and returns it to the trigger on Escape", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Dialog>
        <DialogTrigger render={<button type="button" />}>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Body</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Title" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await expect.poll(() => document.activeElement).toBe(trigger);
  });

  it("AlertDialog returns focus to the trigger after Cancel", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AlertDialog>
        <AlertDialogTrigger render={<button type="button" />}>
          Delete
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Sure?</AlertDialogTitle>
          <AlertDialogDescription>Cannot undo.</AlertDialogDescription>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const trigger = screen.getByRole("button", { name: "Delete" });
    await user.click(trigger);
    await screen.findByRole("alertdialog", { name: "Sure?" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await expect.poll(() => document.activeElement).toBe(trigger);
  });
});
