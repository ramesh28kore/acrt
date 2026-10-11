import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SheetContent } from "@/components/learning/SheetContent";

afterEach(() => vi.restoreAllMocks());

describe("lesson rendering", () => {
  it("renders headings, prose with inline emphasis, grouped lists, code and images", () => {
    const { container } = render(
      <SheetContent
        blocks={[
          { type: "heading", text: "Loops" },
          { type: "paragraph", text: "Use <strong>for</strong> loops" },
          { type: "list_item", text: "one" },
          { type: "list_item", text: "two" },
          { type: "code", text: "for i in range(3):\n    print(i)", lang: "python" },
          { type: "image", url: "https://cdn.example/a.png", alt: "Diagram" },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Loops" })).toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).toBe("for");
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toContain("print(i)");
    expect(screen.getByRole("img", { name: "Diagram" })).toHaveAttribute(
      "src",
      "https://cdn.example/a.png",
    );
  });

  it("never injects stored text as markup", () => {
    const { container } = render(
      <SheetContent
        blocks={[
          {
            type: "paragraph",
            text: "<script>window.hacked=1</script><img src=x onerror=alert(1)>",
          },
        ]}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>window.hacked=1</script>");
  });

  it("copies code to the clipboard and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<SheetContent blocks={[{ type: "code", text: "print('hi')", lang: "python" }]} />);

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument(),
    );
    expect(writeText).toHaveBeenCalledWith("print('hi')");
  });

  it("reports a failed copy instead of failing silently", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    render(<SheetContent blocks={[{ type: "code", text: "x = 1" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copy failed/i })).toBeInTheDocument(),
    );
  });

  it("keeps wide content usable on narrow screens", () => {
    const { container } = render(
      <SheetContent
        blocks={[
          { type: "code", text: "x".repeat(300) },
          { type: "image", url: "/content/images/a.png", alt: "wide" },
          { type: "paragraph", text: "a-very-long-unbroken-word".repeat(10) },
        ]}
      />,
    );
    expect(container.querySelector("pre")?.className).toContain("overflow-x-auto");
    expect(screen.getByRole("img")).toHaveClass("max-w-full", "h-auto");
    expect(container.querySelector("p")?.className).toContain("break-words");
  });
});
