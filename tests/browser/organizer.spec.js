const { test, expect } = require("@playwright/test");
const fixture = require("./fixtures/shared.json");

const SG = fixture.definitions.subgraphs.find((s) => s.name === "Sampler").id;
const MENU_ITEM = "Subgraph IO Organizer…";

async function boot(page) {
  await page.goto("/");
  await page.waitForFunction(() => window.app?.rootGraph && window.app.extensionManager?.workflow && window.LiteGraph);
  await page.evaluate((wf) => app.loadGraphData(wf), structuredClone(fixture));
  await page.waitForFunction((id) => app.rootGraph.nodes.some((n) => n.type === id), SG);
  await page.waitForTimeout(1000);
}

function modified(page) {
  return page.evaluate(() => app.extensionManager.workflow.activeWorkflow.isModified);
}

function serialize(page) {
  return page.evaluate(() => app.rootGraph.serialize());
}

// Every instance of the Sampler subgraph, keyed by "<graph>:<node id>".
function hosts(wf) {
  const graphs = [["root", wf], ...wf.definitions.subgraphs.map((s) => [s.name, s])];
  return Object.fromEntries(graphs.flatMap(([name, g]) => g.nodes.filter((n) => n.type === SG).map((n) => [`${name}:${n.id}`, n])));
}

// Promoted widget values by input name; widgets_values follows the inputs that carry a widget.
function values(n) {
  const names = n.inputs.filter((s) => s.widget).map((s) => s.name);
  return Object.fromEntries(names.map((name, i) => [name, n.widgets_values?.[i]]));
}

function slotName(g, id, slot, side) {
  if (id === -10) return `in:${g.inputs[slot]?.name}`;
  if (id === -20) return `out:${g.outputs[slot]?.name}`;
  return g.nodes.find((n) => n.id === id)?.[side][slot]?.name;
}

// Each link as "origin node.slot name -> target node.slot name", so it survives a renumbering of slots.
function wiring(wf) {
  const graphs = [["root", wf], ...wf.definitions.subgraphs.map((s) => [s.name, s])];
  return graphs.flatMap(([name, g]) => g.links.map((l) => {
    const [o, os, t, ts] = Array.isArray(l) ? l.slice(1, 5) : [l.origin_id, l.origin_slot, l.target_id, l.target_slot];
    return `${name}: ${o}.${slotName(g, o, os, "outputs")} -> ${t}.${slotName(g, t, ts, "inputs")}`;
  })).sort();
}

function definition(wf) {
  const sg = wf.definitions.subgraphs.find((s) => s.id === SG);
  return { inputs: sg.inputs.map((s) => s.name), outputs: sg.outputs.map((s) => s.name) };
}

async function selectHost(page) {
  await page.evaluate((id) => {
    const node = app.rootGraph.nodes.find((n) => n.type === id);
    app.canvas.selectNode(node);
  }, SG);
}

async function openWithKey(page) {
  await selectHost(page);
  await page.locator("#graph-canvas").focus();
  await page.keyboard.press("Alt+r");
  await expect(page.locator(".sio-dialog")).toBeVisible();
}

function label(page, name) {
  return page.locator(`.sio-dialog .sio-label[title^="${name} ("]`);
}

async function moveUp(page, name, times) {
  await label(page, name).click();
  for (let i = 0; i < times; i++) await page.keyboard.press("Alt+ArrowUp");
}

async function remove(page, name) {
  await label(page, name).click();
  await page.keyboard.press("Delete");
}

async function applyAndWait(page) {
  await page.locator(".sio-dialog .sio-primary").click();
  await expect(page.locator(".sio-dialog")).toHaveCount(0);
}

// Screen position of a point given in graph coordinates of the canvas's current graph.
function screenPoint(page, pos) {
  return page.evaluate((p) => {
    const { offset, scale } = app.canvas.ds;
    const [x, y] = [(p[0] + offset[0]) * scale, (p[1] + offset[1]) * scale];
    const r = app.canvas.canvas.getBoundingClientRect();
    return { x: r.left + x, y: r.top + y };
  }, pos);
}

async function rightClickHost(page) {
  const vue = page.locator(`[data-node-id="11"]`);
  if (await vue.count()) return vue.click({ button: "right", position: { x: 40, y: 12 } });
  const pos = await page.evaluate((id) => {
    const n = app.rootGraph.nodes.find((x) => x.type === id);
    return [n.pos[0] + 40, n.pos[1] - 15];
  }, SG);
  const p = await screenPoint(page, pos);
  await page.mouse.click(p.x, p.y, { button: "right" });
}

test("frontend version", async ({ page }) => {
  await boot(page);
  const version = await page.evaluate(() => window.__COMFYUI_FRONTEND_VERSION__);
  const vue = await page.locator("[data-node-id]").count();
  const named = await page.evaluate(() => app.extensionManager.setting.get("Comfy.Workflow.NamedValuesRestore"));
  test.info().annotations.push({ type: "frontend", description: `${version} ${vue ? "vue" : "canvas"} named=${named}` });
  expect(version).toBe(process.env.EXPECT_FRONTEND ?? version);
});

test("apply reorders every instance", async ({ page }) => {
  await boot(page);
  const before = await serialize(page);
  expect(Object.keys(hosts(before))).toHaveLength(3);
  await openWithKey(page);
  await moveUp(page, "negative", 2);
  await moveUp(page, "width", 2);
  await moveUp(page, "LATENT_1", 1);
  await applyAndWait(page);
  const after = await serialize(page);
  const order = { inputs: ["negative", "model", "positive", "width", "seed", "steps"], outputs: ["LATENT_1", "LATENT"] };
  expect(definition(after)).toEqual(order);
  const old = hosts(before);
  for (const [key, n] of Object.entries(hosts(after))) {
    expect(n.inputs.map((s) => s.name), key).toEqual(order.inputs);
    expect(n.outputs.map((s) => s.name), key).toEqual(order.outputs);
    expect(values(n), key).toEqual(values(old[key]));
  }
  expect(values(hosts(after)["root:11"])).toEqual({ width: 640, seed: 111, steps: 21 });
  expect(wiring(after)).toEqual(wiring(before));
});

test("one Ctrl+Z undoes apply", async ({ page }) => {
  await boot(page);
  const before = await serialize(page);
  expect(await modified(page)).toBe(false);
  await openWithKey(page);
  await moveUp(page, "negative", 2);
  await moveUp(page, "LATENT_1", 1);
  await applyAndWait(page);
  expect(definition(await serialize(page)).inputs[0]).toBe("negative");
  expect(await modified(page)).toBe(true);
  await page.locator("#graph-canvas").focus();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => definition(await serialize(page))).toEqual(definition(before));
  const after = await serialize(page);
  for (const [key, n] of Object.entries(hosts(after))) expect(n.inputs.map((s) => s.name), key).toEqual(hosts(before)[key].inputs.map((s) => s.name));
  expect(wiring(after)).toEqual(wiring(before));
});

test("removing inputs drops them everywhere", async ({ page }) => {
  await boot(page);
  const before = await serialize(page);
  await openWithKey(page);
  await remove(page, "positive");
  await remove(page, "steps");
  await applyAndWait(page);
  const after = await serialize(page);
  expect(definition(after).inputs).toEqual(["model", "negative", "seed", "width"]);
  const old = hosts(before);
  for (const [key, n] of Object.entries(hosts(after))) {
    expect(n.inputs.map((s) => s.name), key).toEqual(["model", "negative", "seed", "width"]);
    const { steps, ...rest } = values(old[key]);
    expect(values(n), key).toEqual(rest);
  }
  const gone = wiring(before).filter((w) => !/[.:](positive|steps)$/.test(w) && !/in:(positive|steps) ->/.test(w));
  expect(wiring(after)).toEqual(gone);
});

test("menus, Alt+R and the Extensions command open the dialog", async ({ page }) => {
  await boot(page);
  await rightClickHost(page);
  await page.getByText(MENU_ITEM).first().click();
  await expect(page.locator(".sio-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".sio-dialog")).toHaveCount(0);

  await page.evaluate((id) => {
    const n = app.rootGraph.nodes.find((x) => x.type === id);
    app.canvas.openSubgraph(n.subgraph, n);
  }, SG);
  const p = await screenPoint(page, await page.evaluate(() => {
    const nodes = app.canvas.graph.nodes;
    return [Math.max(...nodes.map((n) => n.pos[0] + n.size[0])) + 100, Math.min(...nodes.map((n) => n.pos[1]))];
  }));
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByText(MENU_ITEM).first().click();
  await expect(page.locator(".sio-dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator("#graph-canvas").focus();
  await page.keyboard.press("Alt+r");
  await expect(page.locator(".sio-dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  // The Comfy logo menu: a wrapper div up to about 1.48, a "Menu" button later.
  await page.locator(`.comfy-menu-button-wrapper, button[aria-label="Menu"]`).first().click();
  await page.getByRole("menuitem", { name: "Extensions", exact: true }).first().hover();
  await page.getByRole("menuitem", { name: /^Subgraph IO Organizer/ }).last().click();
  await expect(page.locator(".sio-dialog")).toBeVisible();
});

test("server errors show in the footer", async ({ page }) => {
  await boot(page);
  await page.route("**/subgraph_io_organizer/apply", (route) => route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"boom"}' }));
  await openWithKey(page);
  await moveUp(page, "LATENT_1", 1);
  await page.locator(".sio-dialog .sio-primary").click();
  await expect(page.locator(".sio-sum")).toHaveText("Apply failed: boom");
  await page.unroute("**/subgraph_io_organizer/apply");
  await page.route("**/subgraph_io_organizer/apply", (route) => route.fulfill({ status: 403, contentType: "text/plain", body: "Forbidden" }));
  await page.locator(".sio-dialog .sio-primary").click();
  await expect(page.locator(".sio-sum")).toContainText("403");
});
