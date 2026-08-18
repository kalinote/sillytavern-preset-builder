import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const STUDIO_ORIGIN = "http://127.0.0.1:4174";

async function importStrictFixture(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${STUDIO_ORIGIN}/api/projects/import/json`, {
    data: {
      name: `StrictMode preview ${Date.now()}`,
      version: "strict-e2e",
      preview: { javascriptEnabled: true },
      preset: {
        prompts: [{ identifier: "main", name: "Main", role: "system", content: "StrictMode" }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
        extensions: {
          tavern_helper: {
            variables: {},
            scripts: [{
              type: "script",
              id: "strict-script",
              name: "Strict script",
              enabled: true,
              content: "console.log('STRICT_MODE_EXECUTION');",
              data: {},
            }],
          },
        },
      },
    },
  });
  expect(response.status()).toBe(201);
}

async function openPreview(page: Page): Promise<void> {
  await page.goto(STUDIO_ORIGIN);
  await expect(page.getByText("工程服务正常", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "预览" }).click();
}

test("React StrictMode and Inspector remounts keep one runtime session", async ({ page, request }) => {
  await importStrictFixture(request);
  await openPreview(page);
  const runtimeFrame = page.locator('iframe[title="项目动态 JavaScript 预览"]');
  await page.getByRole("button", { name: "启动", exact: true }).click();
  await expect(page.getByText("脚本运行中", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(runtimeFrame).toHaveCount(1);
  await page.getByRole("button", { name: /日志/ }).click();
  await expect(page.getByText(/STRICT_MODE_EXECUTION/)).toHaveCount(1);

  for (const device of ["平板", "手机", "桌面"]) {
    await page.getByRole("button", { name: device, exact: true }).click();
    await expect(runtimeFrame).toHaveCount(1);
    await expect(page.getByText(/STRICT_MODE_EXECUTION/)).toHaveCount(1);
  }

  await page.getByRole("tab", { name: "文件" }).click();
  await expect(runtimeFrame).toHaveCount(1);
  await page.getByRole("tab", { name: "预览" }).click();
  await expect(runtimeFrame).toHaveCount(1);
  await page.getByRole("button", { name: /日志/ }).click();
  await expect(page.getByText(/STRICT_MODE_EXECUTION/)).toHaveCount(1);

  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(runtimeFrame).toHaveCount(0);
});

