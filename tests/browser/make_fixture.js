// Builds fixtures/shared.json with the frontend's own API. Run against leg A (frontend 1.48.6):
//   node make_fixture.js http://127.0.0.1:<port>
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

// add() and input() run in the page; they are injected with addScriptTag.
function add(type, x, y) {
  const n = LiteGraph.createNode(type);
  n.pos = [x, y];
  app.graph.add(n);
  return n;
}

function input(n, name) {
  return n.inputs.findIndex((i) => i.name === name);
}

// Subgraph "Sampler" (KSampler + EmptyLatentImage) with three socket inputs, three promoted widgets
// and two outputs; two instances on the root graph and a third inside subgraph "Outer".
function build() {
  const g = app.graph;
  g.clear();
  const ck = add("CheckpointLoaderSimple", 0, 0);
  const pos = add("CLIPTextEncode", 0, 200);
  const neg = add("CLIPTextEncode", 0, 450);
  const prims = [add("PrimitiveInt", 0, 700), add("PrimitiveInt", 0, 800), add("PrimitiveInt", 0, 900)];
  const ks = add("KSampler", 450, 0);
  const el = add("EmptyLatentImage", 450, 500);
  const dec = add("VAEDecode", 1300, 0);
  const up = add("LatentUpscaleBy", 1300, 200);
  ck.connect(1, pos, 0);
  ck.connect(1, neg, 0);
  ck.connect(0, ks, 0);
  pos.connect(0, ks, 1);
  neg.connect(0, ks, 2);
  el.connect(0, ks, 3);
  prims[0].connect(0, ks, input(ks, "seed"));
  prims[1].connect(0, ks, input(ks, "steps"));
  prims[2].connect(0, el, input(el, "width"));
  ks.connect(0, dec, 0);
  ck.connect(2, dec, 1);
  el.connect(0, up, 0);
  const { subgraph, node: a } = g.convertToSubgraph(new Set([ks, el]));
  prims.forEach((p) => g.remove(p));
  subgraph.name = "Sampler";
  a.pos = [450, 0];
  const b = add(subgraph.id, 450, 400);
  ck.connect(0, b, 0);
  neg.connect(0, b, 2);
  const c = add(subgraph.id, 450, 800);
  const dec2 = add("VAEDecode", 1300, 800);
  ck.connect(0, c, 0);
  c.connect(0, dec2, 0);
  g.convertToSubgraph(new Set([c])).subgraph.name = "Outer";
  const wf = g.serialize();
  // Distinct promoted values per instance (seed, steps, width), as a saved file would hold them.
  const hosts = [...wf.nodes, ...wf.definitions.subgraphs.flatMap((s) => s.nodes)].filter((n) => n.type === subgraph.id);
  hosts.forEach((n, i) => (n.widgets_values = [111 * (i + 1), 21 + i, 640 + 64 * i]));
  return JSON.stringify(wf, null, 1);
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage();
  await page.goto(process.argv[2]);
  await page.waitForFunction(() => window.app?.graph && window.app.extensionManager);
  await page.addScriptTag({ content: `${add}\n${input}` });
  const json = await page.evaluate(build);
  fs.writeFileSync(path.join(__dirname, "fixtures", "shared.json"), json + "\n");
  await browser.close();
})();
