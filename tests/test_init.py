import asyncio
import json
import sys

PKG = sys.modules["subgraph_io_organizer"]  # loaded with a fake server module in conftest.py
SERVER = sys.modules["server"]


class FakeRequest:
    def __init__(self, body):
        self.body = body

    async def json(self):
        return self.body


def call(body):
    resp = asyncio.run(PKG.apply(FakeRequest(body)))
    return resp.status, json.loads(resp.text)


def workflow():
    return {
        "id": "R",
        "nodes": [{"id": 1, "type": "S", "inputs": [{"name": "a"}, {"name": "b"}], "outputs": [{"name": "x"}]}],
        "links": [],
        "definitions": {"subgraphs": [{"id": "S", "inputs": [{"name": "a"}, {"name": "b"}], "outputs": [{"name": "x"}], "links": []}]},
    }


def test_route_registered():
    assert [r.path for r in SERVER.PromptServer.instance.routes] == ["/subgraph_io_organizer/apply"]
    assert PKG.WEB_DIRECTORY == "./js"
    assert PKG.NODE_CLASS_MAPPINGS == {}


def test_apply_ok():
    status, body = call({"workflow": workflow(), "sg_id": "S", "inputs": [1], "outputs": [], "widgets": {"R:1": []}})
    assert status == 200
    assert body["definitions"]["subgraphs"][0]["inputs"] == [{"name": "b"}]
    assert body["definitions"]["subgraphs"][0]["outputs"] == []
    assert body["nodes"][0]["inputs"] == [{"name": "b"}]


def test_apply_error():
    status, body = call({"workflow": workflow(), "sg_id": "nope", "inputs": [], "outputs": [], "widgets": {}})
    assert status == 400
    assert body == {"error": "Subgraph nope is not in this workflow."}


def test_apply_malformed():
    ok = {"workflow": workflow(), "sg_id": "S", "inputs": [1], "outputs": [], "widgets": {"R:1": []}}
    assert call({**ok, "widgets": {}}) == (400, {"error": "'R:1'"})
    wf = workflow()
    wf["nodes"].append({"id": 2, "type": "Src", "inputs": [], "outputs": []})
    wf["links"].append([7, 2, 0, 1, 0, "*"])
    assert call({**ok, "workflow": wf}) == (400, {"error": "list index out of range"})
    status, _ = call({**ok, "inputs": None})
    assert status == 400
