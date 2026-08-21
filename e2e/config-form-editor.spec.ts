import { expect, test, type APIRequestContext } from "@playwright/test";

const PORT = 3101;
const STUDIO_ORIGIN = `http://127.0.0.1:${PORT}`;

async function readJsonFile(request: APIRequestContext, projectId: string, path: string) {
  const response = await request.get(`${STUDIO_ORIGIN}/api/projects/${projectId}/files/${path}`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { file?: { content: string }; content?: string };
  const content = payload.file?.content ?? payload.content;
  if (typeof content !== "string") throw new TypeError("Project file response is missing content");
  return JSON.parse(content) as Record<string, unknown>;
}

test("settings, prompt fields, and project files support direct form editing", async ({ page, request }) => {
  const name = `Config form ${Date.now()}`;
  const imported = await request.post(`${STUDIO_ORIGIN}/api/projects/import/json`, {
    data: {
      name,
      version: "1.0.0",
      preset: {
        chat_completion_source: "deepseek",
        deepseek_model: "deepseek-chat",
        openai_max_context: 128000,
        openai_max_tokens: 8192,
        stream_openai: true,
        max_context_unlocked: true,
        temperature: 1,
        top_p: 0.9,
        top_k: 40,
        frequency_penalty: 0,
        presence_penalty: 0,
        repetition_penalty: 1,
        function_calling: true,
        enable_web_search: false,
        impersonation_prompt: "Write as {{user}}",
        new_chat_prompt: "Start a new conversation",
        wi_format: "<world>{0}</world>",
        scenario_format: "<scenario>{{scenario}}</scenario>",
        custom_request_field: { keep: true },
        prompts: [],
        prompt_order: [],
        extensions: { custom_plugin: { keep: true } },
      },
    },
  });
  expect(imported.status()).toBe(201);
  const result = await imported.json() as { project: { id: string } };
  const projectId = result.project.id;

  await page.goto(STUDIO_ORIGIN);
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

  const search = page.getByPlaceholder("搜索工程文件或条目…");
  await search.fill("请求参数与基本配置");
  await page.locator('[data-source-path="preset.settings.json"]').click();

  await expect(page.getByRole("heading", { name: "请求参数与基本配置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "表单", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeVisible();

  await page.getByLabel("上下文长度").fill("256000");
  await page.getByLabel("上下文长度").press("Tab");
  await page.getByLabel("最大输出").fill("16384");
  await page.getByLabel("最大输出").press("Tab");
  await page.getByRole("switch", { name: "流式输出" }).click();

  await expect.poll(async () => {
    const config = await readJsonFile(request, projectId, "preset.settings.json");
    return {
      context: config.openai_max_context,
      output: config.openai_max_tokens,
      stream: config.stream_openai,
      unknown: config.custom_request_field,
      extensions: config.extensions,
      prompt: config.impersonation_prompt,
    };
  }).toEqual({
    context: 256000,
    output: 16384,
    stream: false,
    unknown: { keep: true },
    extensions: undefined,
    prompt: undefined,
  });

  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await expect(page.getByRole("region", { name: "preset.settings.json 源码编辑器容器", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "表单", exact: true }).click();
  await expect(page.getByRole("heading", { name: "请求参数与基本配置" })).toBeVisible();

  await search.fill("预设提示词与标签");
  await page.locator('[data-source-path="preset.prompt-fields.json"]').click();
  await expect(page.getByRole("heading", { name: "预设提示词与标签" })).toBeVisible();
  await page.getByLabel("角色扮演提示词").fill("Edited impersonation prompt");
  await page.getByLabel("角色扮演提示词").press("Tab");
  await page.getByLabel("世界信息标签").fill("<world-info>{0}</world-info>");
  await page.getByLabel("世界信息标签").press("Tab");

  await expect.poll(async () => {
    const promptFields = await readJsonFile(request, projectId, "preset.prompt-fields.json");
    return {
      impersonation: promptFields.impersonation_prompt,
      worldInfo: promptFields.wi_format,
      extensions: promptFields.extensions,
      temperature: promptFields.temperature,
    };
  }).toEqual({
    impersonation: "Edited impersonation prompt",
    worldInfo: "<world-info>{0}</world-info>",
    extensions: undefined,
    temperature: undefined,
  });

  const builtResponse = await request.post(`${STUDIO_ORIGIN}/api/projects/${projectId}/build`, { data: {} });
  const built = await builtResponse.json() as { preset: Record<string, unknown> };
  expect(built.preset.impersonation_prompt).toBe("Edited impersonation prompt");
  expect(built.preset.extensions).toEqual({ custom_plugin: { keep: true } });

  const customPluginPath = `extensions/ext-${Buffer.from("custom_plugin", "utf8").toString("base64url")}.json`;
  await search.fill("custom_plugin 配置");
  const customPluginFile = page.locator(`[data-source-path="${customPluginPath}"]`);
  await expect(customPluginFile).toHaveCount(1);
  await customPluginFile.click();
  await expect(page.getByRole("region", {
    name: `${customPluginPath.split("/").at(-1)} 源码编辑器容器`,
    exact: true,
  })).toBeVisible();
  expect(await readJsonFile(request, projectId, customPluginPath)).toEqual({ keep: true });

  await search.fill("工程配置");
  await page.locator('[data-source-path="project.json"]').click();
  await expect(page.getByRole("heading", { name: "工程配置" })).toBeVisible();

  const nextName = `${name} edited`;
  await page.getByLabel("工程名称").fill(nextName);
  await page.getByLabel("工程名称").press("Tab");
  await page.getByLabel("版本").fill("2.0.0");
  await page.getByLabel("版本").press("Tab");
  await page.getByLabel("默认 SillyTavern 预设名").fill("Visual request preset");
  await page.getByLabel("默认 SillyTavern 预设名").press("Tab");
  const previewSwitch = page.getByRole("switch", { name: "允许动态 JavaScript 预览" });
  const nextPreviewState = !(await previewSwitch.isChecked());
  await previewSwitch.click();

  await expect.poll(async () => {
    const response = await request.get(`${STUDIO_ORIGIN}/api/projects/${projectId}`);
    const payload = await response.json() as {
      project: {
        name: string;
        version: string;
        targetPresetName: string;
        preview: { javascriptEnabled: boolean };
      };
    };
    return payload.project;
  }).toMatchObject({
    name: nextName,
    version: "2.0.0",
    targetPresetName: "Visual request preset",
    preview: { javascriptEnabled: nextPreviewState },
  });

  await expect(page.getByText(nextName, { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await expect(page.getByRole("region", { name: "project.json 源码编辑器容器", exact: true })).toBeVisible();
});
