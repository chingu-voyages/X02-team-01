import {
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import LoginForm from "./LoginForm";

const mockSetToken = vi.fn();

vi.mock("../AuthProvider", () => ({
  useAuth: () => ({
    setToken: mockSetToken,
  }),
}));

describe("LoginForm Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(
    "renders email and password inputs and submit button",
    () => {
      render(<LoginForm />);

      expect(
        screen.getByLabelText(
          /email address/i,
        ),
      ).toBeInTheDocument();

      expect(
        screen.getByLabelText(/password/i),
      ).toBeInTheDocument();

      expect(
        screen.getByRole("button", {
          name: /^sign in$/i,
        }),
      ).toBeInTheDocument();
    },
  );

  it(
    "shows validation errors when submitting empty required fields",
    async () => {
      render(<LoginForm />);

      await userEvent.click(
        screen.getByRole("button", {
          name: /^sign in$/i,
        }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            /email is required/i,
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            /password is required/i,
          ),
        ).toBeInTheDocument();
      });
    },
  );

  it(
    "stores the learner token and redirects to categories",
    async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token:
              "fake-jwt-token",
            token_type: "bearer",
            learner: {
              id: "learner-id",
              email:
                "learner@example.com",
              fullName:
                "Test Learner",
              role: "learner",
              is_verified: true,
              status: "verified",
              created_at:
                new Date().toISOString(),
            },
          }),
        });

      render(<LoginForm />);

      await userEvent.type(
        screen.getByLabelText(
          /email address/i,
        ),
        "learner@example.com",
      );

      await userEvent.type(
        screen.getByLabelText(
          /password/i,
        ),
        "Str0ngEn0ugh1",
      );

      await userEvent.click(
        screen.getByRole("button", {
          name: /^sign in$/i,
        }),
      );

      await waitFor(() => {
        expect(
          global.fetch,
        ).toHaveBeenCalledWith(
          "/api/v1/auth/login",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              email:
                "learner@example.com",
              password:
                "Str0ngEn0ugh1",
            }),
          }),
        );

        expect(
          mockSetToken,
        ).toHaveBeenCalledWith(
          "fake-jwt-token",
          "/categories",
        );
      });
    },
  );

  it(
    "stores the administrator token and redirects to the admin question bank",
    async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token:
              "admin-jwt-token",
            token_type: "bearer",
            learner: {
              id: "admin-id",
              email:
                "admin@example.com",
              fullName:
                "Admin User",
              role: "administrator",
              is_verified: true,
              status: "verified",
              created_at:
                new Date().toISOString(),
            },
          }),
        });

      render(<LoginForm />);

      await userEvent.type(
        screen.getByLabelText(
          /email address/i,
        ),
        "admin@example.com",
      );

      await userEvent.type(
        screen.getByLabelText(
          /password/i,
        ),
        "AdminPassword123!",
      );

      await userEvent.click(
        screen.getByRole("button", {
          name: /^sign in$/i,
        }),
      );

      await waitFor(() => {
        expect(
          mockSetToken,
        ).toHaveBeenCalledWith(
          "admin-jwt-token",
          "/admin/questions",
        );
      });
    },
  );

  it(
    "redirects contributors to the admin question bank",
    async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token:
              "contributor-token",
            token_type: "bearer",
            learner: {
              id: "contributor-id",
              email:
                "contributor@example.com",
              fullName:
                "Contributor User",
              role: "contributor",
              is_verified: true,
              status: "verified",
              created_at:
                new Date().toISOString(),
            },
          }),
        });

      render(<LoginForm />);

      await userEvent.type(
        screen.getByLabelText(
          /email address/i,
        ),
        "contributor@example.com",
      );

      await userEvent.type(
        screen.getByLabelText(
          /password/i,
        ),
        "Contributor123!",
      );

      await userEvent.click(
        screen.getByRole("button", {
          name: /^sign in$/i,
        }),
      );

      await waitFor(() => {
        expect(
          mockSetToken,
        ).toHaveBeenCalledWith(
          "contributor-token",
          "/admin/questions",
        );
      });
    },
  );

  it(
    "displays the backend message for invalid credentials",
    async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue({
          ok: false,
          json: async () => ({
            code:
              "INVALID_CREDENTIALS",
            message:
              "Invalid email or password",
          }),
        });

      render(<LoginForm />);

      await userEvent.type(
        screen.getByLabelText(
          /email address/i,
        ),
        "wrong@example.com",
      );

      await userEvent.type(
        screen.getByLabelText(
          /password/i,
        ),
        "WrongPassword",
      );

      await userEvent.click(
        screen.getByRole("button", {
          name: /^sign in$/i,
        }),
      );

      await waitFor(() => {
        expect(
          screen.getByRole("alert"),
        ).toHaveTextContent(
          "Invalid email or password",
        );

        expect(
          mockSetToken,
        ).not.toHaveBeenCalled();
      });
    },
  );

  it(
    "displays verification guidance for an unverified account",
    async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 403,
          json: async () => ({
            detail: {
              code:
                "ACCOUNT_NOT_VERIFIED",
              message:
                "Verify your email before signing in.",
            },
          }),
        });

      render(<LoginForm />);

      await userEvent.type(
        screen.getByLabelText(
          /email address/i,
        ),
        "pending@example.com",
      );

      await userEvent.type(
        screen.getByLabelText(
          /password/i,
        ),
        "Password123!",
      );

      await userEvent.click(
        screen.getByRole("button", {
          name: /^sign in$/i,
        }),
      );

      await waitFor(() => {
        expect(
          screen.getByRole("alert"),
        ).toHaveTextContent(
          "Verify your email before signing in.",
        );

        expect(
          mockSetToken,
        ).not.toHaveBeenCalled();
      });
    },
  );
});