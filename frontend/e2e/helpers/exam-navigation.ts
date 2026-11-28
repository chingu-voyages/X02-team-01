import { expect, type Page } from "@playwright/test";

/** The active mobile disclosure, not the retired modal implementation. */
export function mobileNavigation(page: Page) {
  const trigger = page.getByRole("button", { name: /^Question navigation ·/i });
  const panel = page.getByRole("region", {
    name: "Mobile question navigation",
    exact: true,
  });
  const navigator = panel.getByRole("navigation", {
    name: "Question navigation",
    exact: true,
  });
  const numbers = navigator.getByRole("list", { name: "Question numbers" });
  const previousSet = navigator.getByRole("button", { name: "Previous question set" });
  const nextSet = navigator.getByRole("button", { name: "Next question set" });

  async function expectOpen() {
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
  }

  async function expectClosed() {
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
  }

  async function open() {
    await expectClosed();
    await trigger.click();
    await expectOpen();
  }

  async function close() {
    await expectOpen();
    await trigger.click();
    await expectClosed();
  }

  async function expectSet(first: number, last: number, total = 40) {
    await expect(navigator.getByText(`${first}-${last} of ${total}`, { exact: true })).toBeVisible();
    await expect(numbers.getByRole("button")).toHaveCount(last - first + 1);
    if (first === 1) await expect(previousSet).toBeDisabled();
    else await expect(previousSet).toBeEnabled();
    if (last === total) await expect(nextSet).toBeDisabled();
    else await expect(nextSet).toBeEnabled();
  }

  // These two helpers intentionally assert each intermediate set, including
  // the disabled boundary controls, for the 40-question fixture.
  async function goToLastSet() {
    await expectSet(1, 15);
    await nextSet.click();
    await expectSet(16, 30);
    await nextSet.click();
    await expectSet(31, 40);
  }

  async function goToFirstSet() {
    await expectSet(31, 40);
    await previousSet.click();
    await expectSet(16, 30);
    await previousSet.click();
    await expectSet(1, 15);
  }

  async function expectQuestionFocus(number: number, total = 40) {
    await expect(page.getByRole("heading", {
      level: 1,
      name: `Question ${number} of ${total}`,
      exact: true,
    })).toBeFocused();
  }

  return { trigger, panel, navigator, numbers, previousSet, nextSet, open, close,
    expectOpen, expectClosed, expectSet, goToLastSet, goToFirstSet, expectQuestionFocus };
}
