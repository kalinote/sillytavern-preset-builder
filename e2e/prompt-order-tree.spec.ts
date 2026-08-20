import { expect, test } from "@playwright/test";

const PORT = 3101;
const STUDIO_ORIGIN = `http://127.0.0.1:${PORT}`;

test("prompt tree follows prompt_order and updates enabled state and runtime order", async ({ page, request }) => {
  let delayFirstPromptOrderResponse = true;
  await page.route("**/api/projects/*/structure/mutations", async (route) => {
    const response = await route.fetch();
    if (delayFirstPromptOrderResponse) {
      delayFirstPromptOrderResponse = false;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    await route.fulfill({ response });
  });
  const name = `Prompt order tree ${Date.now()}`;
  const imported = await request.post(`${STUDIO_ORIGIN}/api/projects/import/json`, {
    data: {
      name,
      preset: {
        prompts: [
          { identifier: "prompt-a", name: "Prompt A", enabled: true, content: "A" },
          { identifier: "prompt-b", name: "Prompt B", enabled: false, content: "B" },
          { identifier: "prompt-c", name: "Prompt C", enabled: false, content: "C" },
        ],
        prompt_order: [{
          character_id: 100001,
          group_note: "keep-group-field",
          order: [
            { identifier: "prompt-b", enabled: false, entry_note: "keep-entry-field" },
            { identifier: "prompt-a", enabled: true },
          ],
        }],
        extensions: {},
      },
    },
  });
  expect(imported.status()).toBe(201);
  const project = await imported.json() as { project: { id: string } };

  await page.goto(STUDIO_ORIGIN);
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

  const promptRows = page.locator('button[aria-expanded][data-tree-path^="core/prompts/"]');
  await expect.poll(async () => promptRows.allTextContents()).toEqual(["Prompt B", "Prompt A", "Prompt C"]);

  const enabledColors = await page.getByRole("switch", { name: "禁用 Prompt A" }).evaluate((element) => ({
    track: getComputedStyle(element).backgroundColor,
    thumb: getComputedStyle(element.firstElementChild as Element).backgroundColor,
  }));
  const disabledColors = await page.getByRole("switch", { name: "启用 Prompt B" }).evaluate((element) => ({
    track: getComputedStyle(element).backgroundColor,
    thumb: getComputedStyle(element.firstElementChild as Element).backgroundColor,
  }));
  expect(enabledColors.track).not.toBe(disabledColors.track);
  expect(enabledColors.thumb).not.toBe(disabledColors.thumb);

  await page.getByRole("switch", { name: "启用 Prompt B" }).click();
  const pendingPromptB = page.getByRole("switch", { name: "禁用 Prompt B" });
  await expect(pendingPromptB).toBeChecked({ timeout: 500 });
  await expect(pendingPromptB).toBeEnabled();
  await expect(pendingPromptB).toHaveAttribute("aria-busy", "true");
  await pendingPromptB.click();
  const pendingPromptBDisabled = page.getByRole("switch", { name: "启用 Prompt B" });
  await expect(pendingPromptBDisabled).not.toBeChecked();
  await expect(pendingPromptBDisabled).toBeEnabled();
  await pendingPromptBDisabled.click();
  await expect(pendingPromptB).toBeChecked();
  await expect(pendingPromptB).toHaveAttribute("aria-busy", "false");

  await page.getByRole("button", { name: "下移 Prompt B" }).click();
  await expect.poll(async () => promptRows.allTextContents()).toEqual(["Prompt A", "Prompt B", "Prompt C"]);

  await page.getByRole("switch", { name: "启用 Prompt C" }).click();
  await expect(page.getByRole("switch", { name: "禁用 Prompt C" })).toBeChecked();
  await page.getByRole("button", { name: "上移 Prompt C" }).click();
  await expect.poll(async () => promptRows.allTextContents()).toEqual(["Prompt A", "Prompt C", "Prompt B"]);

  await page.getByRole("switch", { name: "禁用 Prompt A" }).click();
  await expect(page.getByRole("switch", { name: "启用 Prompt A" })).not.toBeChecked();

  const promptRow = (label: string) => promptRows.filter({ hasText: label }).locator("..");
  await promptRow("Prompt B").locator('span[draggable="true"]').dragTo(promptRow("Prompt A"), {
    targetPosition: { x: 8, y: 1 },
  });
  await expect.poll(async () => promptRows.allTextContents()).toEqual(["Prompt B", "Prompt A", "Prompt C"]);
  await expect(page.locator('[role="switch"][aria-busy="true"]')).toHaveCount(0);

  const built = await request.post(`${STUDIO_ORIGIN}/api/projects/${project.project.id}/build`, { data: {} });
  expect(built.status()).toBe(200);
  const result = await built.json() as {
    preset: { prompt_order: Array<{ group_note: string; order: Array<Record<string, unknown>> }> };
  };
  expect(result.preset.prompt_order[0]).toEqual({
    character_id: 100001,
    group_note: "keep-group-field",
    order: [
      { identifier: "prompt-b", enabled: true, entry_note: "keep-entry-field" },
      { identifier: "prompt-a", enabled: false },
      { identifier: "prompt-c", enabled: true },
    ],
  });
});
