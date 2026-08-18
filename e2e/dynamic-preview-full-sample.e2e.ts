import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PORT = 3101;
const STUDIO_ORIGIN = `http://127.0.0.1:${PORT}`;
const PREVIEW_ORIGIN = `http://localhost:${PORT}`;
const PROJECT_NAME = "Full sample RegexBinding E2E";

test("full sample SPreset RegexBinding bootstraps against the preview preset context", async ({ page, request }) => {
  test.setTimeout(180_000);
  const source = await readFile(
    join(process.cwd(), "docs", "preset-[主预设] V18 狐神抚 · 毓忻.json"),
    "utf8",
  );
  const preset = JSON.parse(source) as Record<string, unknown>;
  const importedResponse = await request.post(`${STUDIO_ORIGIN}/api/projects/import/json`, {
    data: {
      name: PROJECT_NAME,
      version: "full-sample-e2e",
      preview: { javascriptEnabled: true },
      preset,
    },
  });
  expect(importedResponse.status()).toBe(201);

  const pageErrors: string[] = [];
  const consoleMessages: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  await page.goto(STUDIO_ORIGIN);
  await expect(page.getByText("工程服务正常", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "预览" }).click();
  await page.getByRole("button", { name: "启动", exact: true }).click();
  await expect(page.getByText("脚本运行中", { exact: true })).toBeVisible({ timeout: 60_000 });

  const runtimeHandle = await page.locator('iframe[title="项目动态 JavaScript 预览"]').elementHandle();
  const runtimeFrame = await runtimeHandle?.contentFrame();
  if (!runtimeHandle || !runtimeFrame) throw new Error("Preview Host frame is unavailable");
  const readDiagnostics = async () => runtimeFrame.evaluate((projectName) => {
    const runtimeWindow = window as typeof window & {
      SillyTavern?: {
        extensionSettings?: {
          regexBinding_scriptId?: string;
          regex?: unknown[];
          preset_allowed_regex?: { openai?: string[] };
        };
        getContext?: () => {
          chatCompletionSettings?: {
            prompts?: unknown[];
            extensions?: {
              regex_scripts?: unknown[];
              SPreset?: { RegexBinding?: { regexes?: unknown[] } };
            };
          };
        };
      };
      __regexScriptOrder?: number[];
      versionNumber?: number;
    };
    const settings = runtimeWindow.SillyTavern?.extensionSettings;
    const preset = runtimeWindow.SillyTavern?.getContext?.().chatCompletionSettings;
    return {
      projectName,
      scriptId: settings?.regexBinding_scriptId,
      scriptOrder: runtimeWindow.__regexScriptOrder,
      versionNumber: runtimeWindow.versionNumber,
      allowedPresets: settings?.preset_allowed_regex?.openai,
      globalRegexCount: settings?.regex?.length,
      promptCount: preset?.prompts?.length,
      regexCount: preset?.extensions?.regex_scripts?.length,
      bindingCount: preset?.extensions?.SPreset?.RegexBinding?.regexes?.length,
      scripts: Array.from(document.scripts, (script) => ({
        id: script.id,
        src: script.src,
        type: script.type,
        textLength: script.textContent?.length ?? 0,
      })),
      relevantResources: performance.getEntriesByType("resource")
        .map((entry) => ({ name: entry.name, duration: entry.duration, initiatorType: entry.initiatorType }))
        .filter((entry) => /regex|inject|astro|version/i.test(entry.name)),
    };
  }, PROJECT_NAME);
  try {
    try {
      await expect.poll(async () => {
        const diagnostics = await readDiagnostics();
        return Array.isArray(diagnostics.scriptOrder)
          && (diagnostics.promptCount ?? 0) > 0
          && (diagnostics.regexCount ?? 0) > 0
          && diagnostics.regexCount === diagnostics.bindingCount;
      }, { timeout: 45_000 }).toBe(true);
    } catch (error) {
      const diagnostics = {
        runtime: await readDiagnostics(),
        pageErrors,
        consoleMessages,
      };
      const body = JSON.stringify(diagnostics, null, 2);
      await test.info().attach("full-sample-runtime-diagnostics.json", {
        body,
        contentType: "application/json",
      });
      throw new Error(`RegexBinding bootstrap timed out. Diagnostics:\n${body}`, { cause: error });
    }

    const compatibility = await runtimeFrame.evaluate(async () => {
      const runtimeWindow = window as typeof window & {
        SillyTavern: {
          extensionSettings: {
            regexBinding_scriptId?: string;
            regex: unknown[];
            preset_allowed_regex: { openai: string[] };
          };
          getContext(): {
            chatCompletionSettings: {
              prompts: unknown[];
              extensions: {
                regex_scripts: unknown[];
                SPreset?: { RegexBinding?: { regexes?: unknown[] } };
              };
            };
          };
        };
        versionNumber?: number;
      };
      const context = runtimeWindow.SillyTavern.getContext();
      const version = await fetch("/version").then((response) => response.json()) as { pkgVersion: string };
      return {
        promptCount: context.chatCompletionSettings.prompts.length,
        regexCount: context.chatCompletionSettings.extensions.regex_scripts.length,
        bindingCount: context.chatCompletionSettings.extensions.SPreset?.RegexBinding?.regexes?.length ?? 0,
        globalRegexArray: Array.isArray(runtimeWindow.SillyTavern.extensionSettings.regex),
        allowedPresetArray: Array.isArray(runtimeWindow.SillyTavern.extensionSettings.preset_allowed_regex.openai),
        scriptId: runtimeWindow.SillyTavern.extensionSettings.regexBinding_scriptId,
        versionNumber: runtimeWindow.versionNumber,
        pkgVersion: version.pkgVersion,
      };
    });

    expect(compatibility.promptCount).toBeGreaterThan(0);
    expect(compatibility.regexCount).toBeGreaterThan(0);
    expect(compatibility.regexCount).toBe(compatibility.bindingCount);
    expect(compatibility.globalRegexArray).toBe(true);
    expect(compatibility.allowedPresetArray).toBe(true);
    expect(compatibility.scriptId).toBeTruthy();
    expect(compatibility.versionNumber).toBe(11800);
    expect(compatibility.pkgVersion).toBe("1.18.0");
    expect(pageErrors.filter((message) => /prompts is not defined|chatCompletionSettings.*undefined/i.test(message))).toEqual([]);

    await page.getByRole("button", { name: "上下文", exact: true }).click();
    await page.getByRole("button", { name: "模拟生成管线", exact: true }).click();
    const generationResult = page.getByTestId("preview-generation-result");
    await expect(generationResult.getByText("生成管线完成", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(generationResult).toContainText("GENERATE_AFTER_DATA");
    await expect(generationResult).toContainText("CHAT_COMPLETION_SETTINGS_READY");
    await expect(generationResult).toContainText(/\d+ → \d+ 条消息/);
    expect(pageErrors.filter((message) => /generation pipeline|generate_after_data|chat_completion_prompt_ready/i.test(message))).toEqual([]);

    const previewApi = await request.get(`${PREVIEW_ORIGIN}/api/health`);
    expect(previewApi.status()).toBe(404);
  } finally {
    await runtimeHandle.dispose();
  }
});
