import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
async function command(page: Page, cmd: string) {
  const input = page.getByRole("textbox", { name: "MDS 命令输入" });
  await input.fill(cmd);
  await input.press("Enter");
  return page.locator(".terminal-entry").last();
}
async function batch(page: Page, commands: string) {
  for (const cmd of commands.split("\n")) await command(page, cmd);
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "MDS 命令输入" }),
  ).toBeVisible();
});
test("queries, mode transitions, Tab, history and output filters work in the terminal", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const input = page.getByRole("textbox", { name: "MDS 命令输入" });
  await input.fill("sh ver");
  await input.press("Tab");
  await expect(input).toHaveValue("show version");
  await input.press("Enter");
  await expect(page.locator(".terminal-entry").last()).toContainText(
    "cisco MDS 9710",
  );
  await input.press("ArrowUp");
  await expect(input).toHaveValue("show version");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("");
  await batch(page, "conf t\nint fc1/1\nshutdown");
  await expect(page.locator(".terminal-input-line label")).toHaveText(
    "MDS-9710(config-if)#",
  );
  await input.press("Control+z");
  await expect(page.locator(".terminal-input-line label")).toHaveText(
    "MDS-9710#",
  );
  await expect(await command(page, "show interface fc1/1")).toContainText(
    "administratively down",
  );
  await expect(await command(page, "sh flogi database")).toContainText(
    "Total number of flogi = 1",
  );
  await batch(page, "conf t\nint fc1/1\nno shut\nend");
  await expect(
    await command(page, "sh int brief | include up | count"),
  ).toContainText("Count: 4 lines");
  await input.press("Control+l");
  await expect(page.locator(".terminal-entry")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("VSAN and zoning workflow changes actual fabric results", async ({
  page,
}) => {
  await batch(
    page,
    "conf t\nvsan database\nvsan 30 name LAB\nvsan 30 interface fc1/3\nexit\nzone name HOST_ONLY vsan 10\nmember pwwn 21:00:00:24:ff:01:00:01\nexit\nzoneset name TEST vsan 10\nmember HOST_ONLY\nexit\nzoneset activate name TEST vsan 10\nend",
  );
  await expect(await command(page, "show vsan 30")).toContainText("name: LAB");
  await expect(
    await command(page, "show zoneset active vsan 10"),
  ).toContainText("zoneset name TEST");
  await expect(
    await command(page, "fcping pwwn 50:00:09:73:00:01:00:01 vsan 10"),
  ).toContainText("zoning access denied");
  await expect(page.locator(".error-entry")).toHaveCount(0);
});
test("fault toggles affect SFP, counters, FLOGI, logs and recover", async ({
  page,
}) => {
  const sfp = page.getByRole("button", {
    name: "光模块缺失 fc1/1",
    exact: true,
  });
  await sfp.click();
  await expect(sfp).toHaveAttribute("aria-pressed", "true");
  await expect(
    await command(page, "show interface fc1/1 transceiver details"),
  ).toContainText("sfp is not present");
  await expect(await command(page, "show flogi database")).toContainText(
    "Total number of flogi = 1",
  );
  await expect(await command(page, "show logging last 20")).toContainText(
    "sfp-missing",
  );
  await page.getByRole("button", { name: "恢复全部故障" }).click();
  await expect(sfp).toHaveAttribute("aria-pressed", "false");
  await page
    .getByRole("button", { name: "CRC 错误 fc1/1", exact: true })
    .click();
  await expect(
    await command(page, "show interface fc1/1 counters detailed"),
  ).toContainText("427 CRC errors");
  await page
    .getByRole("button", { name: "BB Credit 耗尽 fc1/1", exact: true })
    .click();
  await expect(
    await command(page, "show interface fc1/1 counters detailed"),
  ).toContainText("0 transmit B2B credits remaining");
  await page.getByRole("button", { name: "恢复全部故障" }).click();
  await expect(
    await command(page, "show interface fc1/1 counters detailed"),
  ).toContainText("427 CRC errors");
  await command(page, "clear counters interface fc1/1");
  await expect(
    await command(page, "show interface fc1/1 counters detailed"),
  ).toContainText("0 CRC errors");
  await expect(await command(page, "show flogi database")).toContainText(
    "Total number of flogi = 2",
  );
});
test("devices and configuration are isolated and persist through a browser reload", async ({
  page,
}) => {
  await batch(page, "conf t\nhostname SAN-A\nend\ncopy run start");
  await page.getByRole("button", { name: /MDS-9396 Fabric switch/ }).click();
  await expect(page.locator(".terminal-input-line label")).toHaveText(
    "MDS-9396#",
  );
  await expect(await command(page, "show version")).toContainText("MDS 9396");
  await expect(await command(page, "show running-config")).not.toContainText(
    "hostname SAN-A",
  );
  await page.getByRole("button", { name: /SAN-A Director/ }).click();
  await expect(page.locator(".terminal-input-line label")).toHaveText("SAN-A#");
  await page.reload();
  await expect(page.locator(".terminal-input-line label")).toHaveText("SAN-A#");
  await expect(await command(page, "show startup-config")).toContainText(
    "hostname SAN-A",
  );
  await batch(page, "conf t\nhostname UNSAVED\nend\nreload");
  await expect(page.locator(".terminal-input-line label")).toHaveText("SAN-A#");
});
test("multi-line paste executes a coherent configuration session", async ({
  page,
}) => {
  await page.getByRole("textbox", { name: "MDS 命令输入" }).evaluate((el) => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      "conf t\nvsan database\nvsan 40 name PASTE\nvsan 40 interface fc1/4\nend\nshow vsan 40",
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator(".terminal-entry").last()).toContainText(
    "name: PASTE",
  );
  await expect(page.locator(".error-entry")).toHaveCount(0);
});
test("reference search, reset confirmation and focus mode work", async ({
  page,
}) => {
  await page.getByRole("button", { name: "命令参考" }).click();
  await page.getByRole("textbox", { name: "搜索命令" }).fill("transceiver");
  await page
    .getByRole("button", { name: "show interface fc1/1 transceiver details" })
    .click();
  await expect(page.getByRole("textbox", { name: "MDS 命令输入" })).toHaveValue(
    "show interface fc1/1 transceiver details",
  );
  await page.getByRole("textbox", { name: "MDS 命令输入" }).press("Enter");
  await expect(page.locator(".terminal-entry").last()).toContainText(
    "sfp is present",
  );
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await page.getByRole("button", { name: "退出专注模式" }).click();
  await command(page, "lab fault link-down interface fc1/1");
  await page.getByRole("button", { name: "重置当前交换机" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "链路中断 fc1/1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "重置当前交换机" }).click();
  await page.getByRole("button", { name: "重置设备", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "链路中断 fc1/1", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});
test("mobile layout keeps the terminal usable and does not overflow the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await expect(await command(page, "show version")).toContainText("MDS 9710");
  const size = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.viewport);
  await page.screenshot({ path: "/tmp/mds-lab-mobile.png", fullPage: true });
});
test("desktop is stable with no unexpected external requests", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (req) => {
    if (!req.url().startsWith("http://127.0.0.1:5173"))
      external.push(req.url());
  });
  await page.reload();
  await expect(page.locator(".terminal-frame")).toBeVisible();
  await page.screenshot({ path: "/tmp/mds-lab-desktop.png", fullPage: true });
  expect(external).toEqual([]);
});

test("context help, cancellation and session export work", async ({
  page,
  context,
}) => {
  const input = page.getByRole("textbox", { name: "MDS 命令输入" });
  await input.fill("show int ");
  await input.press("?");
  await expect(page.locator(".terminal-entry").last()).toContainText(
    "show interface brief",
  );
  await expect(input).toHaveValue("show int ");
  await input.press("Control+c");
  await expect(input).toHaveValue("");
  await expect(page.locator(".terminal-entry").last()).toContainText("^C");
  await command(page, "show version");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "复制终端记录" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("MDS-9710# show version");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出终端记录" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("MDS-9710-console.txt");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toContain("MDS-9710# show version");
});

test("port editor applies a range, reports errors atomically and survives refresh", async ({
  page,
}) => {
  await page.getByRole("button", { name: "配置端口 · fc1/1" }).click();
  const dialog = page.getByRole("dialog", { name: "端口配置" });
  await dialog.getByLabel("端口 / 范围").fill("fc1/3-5");
  await dialog.getByLabel("描述", { exact: true }).fill("Batch SAN");
  await dialog.getByLabel("VSAN", { exact: true }).selectOption("20");
  await dialog.getByLabel("接收 BB Credit").fill("64");
  await dialog.getByLabel("Beacon", { exact: true }).check();
  await dialog.getByRole("button", { name: "应用配置" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(await command(page, "show interface fc1/4")).toContainText(
    "Receive B2B Credit is 64",
  );
  await page.reload();
  await expect(await command(page, "show interface fc1/5")).toContainText(
    "Description: Batch SAN",
  );
  await page.getByRole("button", { name: "配置端口 · fc1/1" }).click();
  await dialog.getByLabel("端口 / 范围").fill("fc1/3-5");
  await dialog.getByLabel("描述", { exact: true }).fill("INVALID_CHANGE");
  await dialog.getByLabel("Trunk 允许 VSAN").fill("4094");
  await dialog.getByRole("button", { name: "应用配置" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Invalid VSAN list");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(await command(page, "show interface fc1/4")).toContainText(
    "Description: Batch SAN",
  );
});

test("port editor connects a new endpoint and makes it visible to FLOGI", async ({
  page,
}) => {
  await page.getByRole("button", { name: "配置端口 · fc1/1" }).click();
  const dialog = page.getByRole("dialog", { name: "端口配置" });
  await dialog.getByLabel("端口 / 范围").fill("fc1/3");
  await dialog.getByLabel("模拟设备接入").selectOption("connect");
  await dialog.getByLabel("设备角色").selectOption("Target");
  await dialog.getByLabel("设备 PWWN").fill("50:00:00:00:00:00:00:03");
  await dialog.getByRole("button", { name: "应用配置" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(await command(page, "show flogi database")).toContainText(
    "50:00:00:00:00:00:00:03",
  );
});
