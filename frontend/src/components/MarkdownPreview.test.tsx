import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import MarkdownPreview from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  afterEach(cleanup);

  it("renders basic markdown structures", () => {
    render(
      <MarkdownPreview
        content={"## Scoring criteria\n\n- Thesis clarity: 2 points\n"}
      />,
    );

    expect(screen.getByRole("heading", { name: "Scoring criteria" })).toBeTruthy();
    expect(screen.getByText(/Thesis clarity/)).toBeTruthy();
  });

  it("escapes raw HTML and scripts instead of rendering them", () => {
    const { container } = render(
      <MarkdownPreview
        content={
          'Hello <script>window.__pwned = true</script><img src=x onerror="alert(1)">'
        }
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("window.__pwned");
  });

  it("does not execute inline event handlers from markdown links", () => {
    const { container } = render(
      <MarkdownPreview content={'[click](javascript:alert(1))'} />,
    );

    const anchor = container.querySelector("a");
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute("href")).not.toBe("javascript:alert(1)");
  });
});
