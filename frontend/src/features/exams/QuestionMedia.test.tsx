import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import QuestionMedia from "./QuestionMedia";

import type { ExamImage } from "@/types/exam-api.types";

const image: ExamImage = {
  id: "11111111-1111-4111-8111-111111111111",
  position: 1,
  alt_text:
    "Agile workflow diagram showing work moving through an iterative planning and delivery process.",
  media_type: "image/png",
  url:
    "https://pub-example.r2.dev/questions/demo/agile.png",
};

describe("QuestionMedia", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing for a text-only question", () => {
    const { container } = render(
      <QuestionMedia images={[]} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders the hosted image with author-provided alt text", () => {
    render(
      <QuestionMedia images={[image]} />,
    );

    const renderedImage = screen.getByRole(
      "img",
      {
        name: image.alt_text,
      },
    );

    expect(renderedImage).toHaveAttribute(
      "src",
      image.url,
    );

    expect(renderedImage).toHaveAttribute(
      "alt",
      image.alt_text,
    );
  });

  it("shows a loading state until the image loads", () => {
    render(
      <QuestionMedia images={[image]} />,
    );

    expect(
      screen.getByText("Loading image..."),
    ).toBeTruthy();

    fireEvent.load(
      screen.getByRole("img", {
        name: image.alt_text,
      }),
    );

    expect(
      screen.queryByText("Loading image..."),
    ).toBeNull();
  });

  it("shows an accessible fallback when the image fails", () => {
    render(
      <QuestionMedia images={[image]} />,
    );

    fireEvent.error(
      screen.getByRole("img", {
        name: image.alt_text,
      }),
    );

    expect(
      screen.getByText("Image unavailable"),
    ).toBeTruthy();

    expect(
      screen.getByText(image.alt_text),
    ).toBeTruthy();

    expect(
      screen.queryByRole("img"),
    ).toBeNull();
  });

  it("shows an accessible fallback when the URL is unavailable", () => {
    render(
      <QuestionMedia
        images={[
          {
            ...image,
            url: null,
          },
        ]}
      />,
    );

    expect(
      screen.getByText("Image unavailable"),
    ).toBeTruthy();

    expect(
      screen.getByText(image.alt_text),
    ).toBeTruthy();

    expect(
      screen.queryByRole("img"),
    ).toBeNull();
  });

  it("renders images in their declared position order", () => {
    const secondImage: ExamImage = {
      id: "22222222-2222-4222-8222-222222222222",
      position: 2,
      alt_text: "Second diagram",
      media_type: "image/webp",
      url:
        "https://pub-example.r2.dev/questions/demo/second.webp",
    };

    render(
      <QuestionMedia
        images={[
          secondImage,
          image,
        ]}
      />,
    );

    const renderedImages =
      screen.getAllByRole("img");

    expect(renderedImages[0]).toHaveAttribute(
      "alt",
      image.alt_text,
    );

    expect(renderedImages[1]).toHaveAttribute(
      "alt",
      secondImage.alt_text,
    );
  });
});