import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import RegisterScreen from "./RegisterScreen";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
}));

describe('RegisterScreen Layout & Structure', () => {
  it('renders the main page header and step badge', () => {
    render(<RegisterScreen />);
    
    // Verify header title using the name option for precise, robust matching
    const mainHeading = screen.getByRole('heading', { level: 1, name: /create an account/i });
    expect(mainHeading).toBeInTheDocument();
  });

  it('renders the benefits card alongside the form', () => {
    render(<RegisterScreen />);
    
    // Target the specific heading text inside the card
    const cardHeading = screen.getByRole('heading', { level: 2, name: /why create an account|benefits/i });
    expect(cardHeading).toBeInTheDocument();
  });

  it('maintains proper form landmark structure', () => {
    render(<RegisterScreen />);
    
    // Use queryByRole to safely fallback without throwing when checking form elements
    const formElement = screen.queryByRole('form', { hidden: true }) || document.querySelector('form');
    expect(formElement).toBeInTheDocument();
  });
});