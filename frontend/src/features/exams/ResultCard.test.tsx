import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import ResultCard from "./ResultCard";

const mockLogout = vi.fn();

vi.mock(
  "@/features/auth/AuthProvider",
  () => ({
    useAuth: () => ({
      token: "test-token",
      ready: true,
      setToken: vi.fn(),
      logout: mockLogout,
    }),
  }),
);

afterEach(() => {
  cleanup();
});

describe("ResultCard", () => {
  it("displays a passing result", () => {
    render(
      <ResultCard
        scorePercent={85}
        correctCount={17}
        incorrectCount={3}
        isPassed={true}
        passingScorePercent={65}
      />,
    );

    expect(
      screen.getByText("85%"),
    ).toBeTruthy();

    expect(
      screen.getByText("Passed"),
    ).toBeTruthy();

    expect(
      screen.getByText("17"),
    ).toBeTruthy();

    expect(
      screen.getByText("3"),
    ).toBeTruthy();
  });

  it("displays a failing result", () => {
    render(
      <ResultCard
        scorePercent={40}
        correctCount={4}
        incorrectCount={6}
        isPassed={false}
        passingScorePercent={65}
      />,
    );

    expect(
      screen.getByText("40%"),
    ).toBeTruthy();

    expect(
      screen.getByText("Not passed"),
    ).toBeTruthy();
  });

  it(
    "handles an exam without a gradable score",
    () => {
      render(
        <ResultCard
          scorePercent={null}
          correctCount={0}
          incorrectCount={0}
          isPassed={null}
          passingScorePercent={65}
        />,
      );

      expect(
        screen.getByText(
          "Not assessed",
        ),
      ).toBeTruthy();

      expect(
        screen.getByText(
          /No automatically graded score/i,
        ),
      ).toBeTruthy();
    },
  );

  it(
    "displays the passing threshold",
    () => {
      render(
        <ResultCard
          scorePercent={70}
          correctCount={7}
          incorrectCount={3}
          isPassed={true}
          passingScorePercent={65}
        />,
      );

      expect(
        screen.getByText(
          "65% required to pass",
        ),
      ).toBeTruthy();
    },
  );

  it(
    "rounds fractional scores for display",
    () => {
      render(
        <ResultCard
          scorePercent={66.6667}
          correctCount={2}
          incorrectCount={1}
          isPassed={false}
          passingScorePercent={70}
        />,
      );

      expect(
        screen.getByText("67%"),
      ).toBeTruthy();

      expect(
        screen.getByText(
          "Not passed",
        ),
      ).toBeTruthy();
    },
  );
});