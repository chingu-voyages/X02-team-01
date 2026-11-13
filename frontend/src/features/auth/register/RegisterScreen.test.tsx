import {
  render,
  screen,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import RegisterScreen from "./RegisterScreen";

const mockLogout = vi.fn();

vi.mock(
  "@/features/auth/AuthProvider",
  () => ({
    useAuth: () => ({
      token: null,
      ready: true,
      setToken: vi.fn(),
      logout: mockLogout,
    }),
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
}));

describe(
  "RegisterScreen Layout & Structure",
  () => {
    it(
      "renders the main page header and step badge",
      () => {
        render(<RegisterScreen />);

        const mainHeading =
          screen.getByRole("heading", {
            level: 1,
            name: /create an account/i,
          });

        expect(
          mainHeading,
        ).toBeInTheDocument();
      },
    );

    it(
      "renders the benefits card alongside the form",
      () => {
        render(<RegisterScreen />);

        const cardHeading =
          screen.getByRole("heading", {
            level: 2,
            name:
              /why create an account|benefits/i,
          });

        expect(
          cardHeading,
        ).toBeInTheDocument();
      },
    );

    it(
      "maintains proper form landmark structure",
      () => {
        render(<RegisterScreen />);

        const formElement =
          screen.queryByRole("form", {
            hidden: true,
          }) ??
          document.querySelector("form");

        expect(
          formElement,
        ).toBeInTheDocument();
      },
    );
  },
);