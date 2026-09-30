/**
 * Phone shell: floating tab bar, the "+" composer that hands a picked image to the
 * analysis screen, the long-press context menu and the bottom sheet.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ComposerProvider } from "@/components/shell/Composer";
import { MobileTabBar } from "@/components/shell/MobileTabBar";
import { LongPressMenu } from "@/components/ui/lift-menu";
import { BottomSheet } from "@/components/ui/sheet";
import { AnalyzePage } from "@/pages/AnalyzePage";
import { modelInfo } from "@/test/fixtures";
import { json, mockFetch, mockImageLoading, renderWithProviders } from "@/test/utils";

describe("mobile tab bar and composer", () => {
  beforeEach(() => mockImageLoading(600, 450));

  it("shows four destinations with the current one marked, plus the new-analysis action", () => {
    renderWithProviders(
      <ComposerProvider>
        <MobileTabBar />
      </ComposerProvider>,
      { route: "/app/analyses", path: "/app/*" },
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Home", "History", "Reports", "Profile"]);
    expect(within(nav).getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "New analysis" })).toBeInTheDocument();
  });

  it("opens the composer and carries the picked image to an immediate preview", async () => {
    mockFetch({ "GET /api/model/info": () => json(modelInfo) });
    renderWithProviders(
      <ComposerProvider>
        <MobileTabBar />
      </ComposerProvider>,
      { route: "/app", path: "/app", extraRoutes: [{ path: "/app/analyze", element: <AnalyzePage /> }] },
    );
    await userEvent.click(screen.getByRole("button", { name: "New analysis" }));
    const dialog = await screen.findByRole("dialog", { name: "New analysis" });
    for (const name of ["Take a photo", "Choose from photos", "Browse files"]) {
      expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
    }
    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!;
    await userEvent.upload(input, new File([new Uint8Array(2000)], "mole.jpg", { type: "image/jpeg" }));
    expect(await screen.findByAltText("Preview of mole.jpg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyse image" })).toBeEnabled();
  });
});

describe("LongPressMenu", () => {
  it("opens on right-click, supports arrow keys, and runs the chosen action", async () => {
    const open = vi.fn();
    const remove = vi.fn();
    renderWithProviders(
      <LongPressMenu
        label="Actions for Melanoma"
        actions={[
          { label: "Open result", icon: <span />, onSelect: open },
          { label: "Delete", icon: <span />, onSelect: remove, destructive: true },
        ]}
      >
        <a href="#result">Melanoma card</a>
      </LongPressMenu>,
    );
    fireEvent.contextMenu(screen.getByText("Melanoma card"));
    const menu = await screen.findByRole("menu", { name: "Actions for Melanoma" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Open result", "Delete"]);
    items[0]!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes with Escape without running anything", async () => {
    const action = vi.fn();
    renderWithProviders(
      <LongPressMenu label="Actions" actions={[{ label: "Open result", icon: <span />, onSelect: action }]}>
        <button type="button">Card</button>
      </LongPressMenu>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Card" }), { key: "F10", shiftKey: true });
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });
});

describe("BottomSheet", () => {
  function Harness({ onConfirm }: { onConfirm: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <BottomSheet open={open} onOpenChange={setOpen} title="Filters" description="Filter analyses" onConfirm={onConfirm} confirmLabel="Apply filters">
        <p>Sheet body</p>
      </BottomSheet>
    );
  }

  it("has a title, a confirm action and a close button", async () => {
    const onConfirm = vi.fn();
    renderWithProviders(<Harness onConfirm={onConfirm} />);
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(within(dialog).getByText("Sheet body")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply filters" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Sheet body")).not.toBeInTheDocument();
  });

  it("recedes the page behind it while open on phones", () => {
    renderWithProviders(<Harness onConfirm={() => undefined} />);
    expect(document.documentElement).toHaveAttribute("data-sheet-open");
  });
});
