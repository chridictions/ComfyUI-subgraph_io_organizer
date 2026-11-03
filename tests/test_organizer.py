import pytest

from organizer import SG_IN, SG_OUT, _detach, _remap_widget_values, lf, remap, set_slot


def slot(name, link=None, **extra):
    return dict(name=name, link=link, **extra)


def out(name, links):
    return dict(name=name, links=links)


def inner_subgraph():
    """Subgraph S: inputs a, b, c; outputs x, y. Node 1 uses them, node 2 feeds node 1 directly."""
    return {
        "id": "S",
        "inputs": [{"name": "a"}, {"name": "b"}, {"name": "c"}],
        "outputs": [{"name": "x"}, {"name": "y"}],
        "nodes": [
            {"id": 1, "type": "Work", "inputs": [slot("i0", 10), slot("i1", 11), slot("i2", 12), slot("i3", 15)],
             "outputs": [out("o0", [13]), out("o1", [14])]},
            {"id": 2, "type": "Src", "inputs": [], "outputs": [out("o0", [15])]},
        ],
        "links": [
            dict(id=10, origin_id=-10, origin_slot=0, target_id=1, target_slot=0, type="*"),
            dict(id=11, origin_id=-10, origin_slot=1, target_id=1, target_slot=1, type="*"),
            dict(id=12, origin_id=-10, origin_slot=2, target_id=1, target_slot=2, type="*"),
            dict(id=13, origin_id=1, origin_slot=0, target_id=-20, target_slot=0, type="*"),
            dict(id=14, origin_id=1, origin_slot=1, target_id=-20, target_slot=1, type="*"),
            dict(id=15, origin_id=2, origin_slot=0, target_id=1, target_slot=3, type="*"),
        ],
    }


def parent_subgraph():
    """Subgraph P holding instance 50 of S that only lists input b, fed by node 51 (dict-form link)."""
    return {
        "id": "P",
        "inputs": [],
        "outputs": [],
        "nodes": [
            {"id": 50, "type": "S", "inputs": [slot("b", 60)], "outputs": [out("x", []), out("y", [])]},
            {"id": 51, "type": "Src", "inputs": [], "outputs": [out("o0", [60])]},
        ],
        "links": [dict(id=60, origin_id=51, origin_slot=0, target_id=50, target_slot=0, type="*")],
    }


def workflow():
    """Root graph R with list-form links: 100 -> instance 200 of S -> 300."""
    return {
        "id": "R",
        "nodes": [
            {"id": 100, "type": "Src", "inputs": [], "outputs": [out("o0", [20, 21, 24])]},
            {"id": 200, "type": "S",
             "inputs": [slot("a", 20, slot_index=0), slot("b", 21, widget={"name": "b"}), slot("c", None, widget={"name": "c"})],
             "outputs": [dict(name="x", links=[22], slot_index=0), dict(name="y", links=[23], slot_index=1)],
             "widgets_values": ["bv", "cv"]},
            {"id": 300, "type": "Sink", "inputs": [slot("i0", 22), slot("i1", 23), slot("i2", 24)], "outputs": []},
        ],
        "links": [
            [20, 100, 0, 200, 0, "*"],
            [21, 100, 0, 200, 1, "*"],
            [22, 200, 0, 300, 0, "*"],
            [23, 200, 1, 300, 1, "*"],
            [24, 100, 0, 300, 2, "*"],
        ],
        "definitions": {"subgraphs": [inner_subgraph(), parent_subgraph(), {"id": "Empty"}]},
    }


# Inputs of each instance of S that have a widgetId in the frontend.
WIDGETS = {"R:200": ["b", "c"], "P:50": []}


def links_by_id(g):
    return {lf(l)["id"]: lf(l) for l in g["links"]}


def node(g, nid):
    return next(n for n in g["nodes"] if n["id"] == nid)


def test_lf_and_set_slot_list_form():
    l = [1, 2, 3, 4, 5, "T"]
    assert lf(l) == dict(id=1, origin_id=2, origin_slot=3, target_id=4, target_slot=5, type="T")
    set_slot(l, "origin_slot", 7)
    set_slot(l, "target_slot", 8)
    assert l == [1, 2, 7, 4, 8, "T"]


def test_lf_and_set_slot_dict_form():
    l = dict(id=1, origin_id=2, origin_slot=3, target_id=4, target_slot=5, type="T")
    assert lf(l) is l
    set_slot(l, "target_slot", 9)
    assert l["target_slot"] == 9


def test_detach_absent_link_id_changes_nothing():
    g = {"nodes": [], "links": [[1, 2, 0, 3, 0, "*"]]}
    _detach(g, 99)
    assert g["links"] == [[1, 2, 0, 3, 0, "*"]]


def test_detach_empty_graph():
    g = {}
    _detach(g, 1)
    assert g == {}


def test_detach_missing_endpoints():
    g = {"links": [[1, 2, 0, 3, 0, "*"]]}
    _detach(g, 1)
    assert g["links"] == []


def test_detach_clears_both_endpoints():
    g = workflow()
    _detach(g, 22)
    assert 22 not in links_by_id(g)
    assert node(g, 200)["outputs"][0]["links"] == []
    assert node(g, 300)["inputs"][0]["link"] is None


def test_detach_endpoints_not_pointing_at_link():
    g = {"nodes": [{"id": 2, "outputs": [out("o", None)]}, {"id": 3, "inputs": [slot("i", 5)]}],
         "links": [[1, 2, 0, 3, 0, "*"]]}
    _detach(g, 1)
    assert g["links"] == []
    assert g["nodes"][1]["inputs"][0]["link"] == 5


def test_widget_values_without_values():
    n = {"inputs": [slot("a", widget={})]}
    _remap_widget_values(n, [0], ["a"], set())
    assert "widgets_values" not in n


def test_widget_values_length_mismatch_untouched():
    n = {"inputs": [slot("a", widget={})], "widgets_values": [1, 2]}
    _remap_widget_values(n, [0], ["a"], set())
    assert n["widgets_values"] == [1, 2]


def test_widget_values_follow_order():
    n = {"inputs": [slot("a"), slot("b", widget={}), slot("c", widget={})], "widgets_values": ["bv", "cv"]}
    _remap_widget_values(n, [2, 0], ["b", "c"], {"b"})
    assert n["widgets_values"] == ["cv"]


def test_widget_positions_from_widget_ids_not_flags():
    # Frontend #18990: "a" keeps its serialized widget flag but has no widgetId, so it has no value.
    n = {"inputs": [slot("a", widget={}), slot("b", widget={}), slot("c", widget={})], "widgets_values": ["bv", "cv"]}
    _remap_widget_values(n, [2, 0, 1], ["b", "c"], set())
    assert n["widgets_values"] == ["cv", "bv"]


def test_widgets_values_named_pruned():
    n = {"inputs": [slot("a", widget={}), slot("b", widget={})], "widgets_values": [1, 2],
         "widgets_values_named": {"a": 1, "b": 2, "z": 3}}
    _remap_widget_values(n, [1], ["a", "b"], {"a", "gone"})
    assert n["widgets_values"] == [2]
    assert n["widgets_values_named"] == {"b": 2, "z": 3}


def test_reorder_inputs():
    wf = workflow()
    remap(wf, "S", "inputs", [2, 0, 1], WIDGETS)
    sg = wf["definitions"]["subgraphs"][0]
    assert [s["name"] for s in sg["inputs"]] == ["c", "a", "b"]
    inner = links_by_id(sg)
    assert [inner[i]["origin_slot"] for i in (10, 11, 12)] == [1, 2, 0]
    assert inner[15]["origin_slot"] == 0
    inst = node(wf, 200)
    assert [s["name"] for s in inst["inputs"]] == ["c", "a", "b"]
    assert [s.get("slot_index") for s in inst["inputs"]] == [None, 1, None]
    assert inst["widgets_values"] == ["cv", "bv"]
    root = links_by_id(wf)
    assert root[20]["target_slot"] == 1
    assert root[21]["target_slot"] == 2
    assert root[24]["target_slot"] == 2


def test_delete_input():
    wf = workflow()
    remap(wf, "S", "inputs", [0, 2], WIDGETS)
    sg = wf["definitions"]["subgraphs"][0]
    assert [s["name"] for s in sg["inputs"]] == ["a", "c"]
    inner = links_by_id(sg)
    assert 11 not in inner
    assert inner[12]["origin_slot"] == 1
    assert node(sg, 1)["inputs"][1]["link"] is None
    assert 21 not in links_by_id(wf)
    assert node(wf, 100)["outputs"][0]["links"] == [20, 24]
    assert node(wf, 200)["widgets_values"] == ["cv"]


def test_reorder_outputs():
    wf = workflow()
    remap(wf, "S", "outputs", [1, 0])
    sg = wf["definitions"]["subgraphs"][0]
    inner = links_by_id(sg)
    assert inner[13]["target_slot"] == 1
    assert inner[14]["target_slot"] == 0
    inst = node(wf, 200)
    assert [(s["name"], s["slot_index"]) for s in inst["outputs"]] == [("y", 0), ("x", 1)]
    assert inst["widgets_values"] == ["bv", "cv"]
    root = links_by_id(wf)
    assert root[22]["origin_slot"] == 1
    assert root[23]["origin_slot"] == 0


def test_delete_output():
    wf = workflow()
    remap(wf, "S", "outputs", [0])
    sg = wf["definitions"]["subgraphs"][0]
    assert 14 not in links_by_id(sg)
    assert node(sg, 1)["outputs"][1]["links"] == []
    assert 23 not in links_by_id(wf)
    assert node(wf, 300)["inputs"][1]["link"] is None
    assert [s["name"] for s in node(wf, 200)["outputs"]] == ["x"]


def test_nested_instance_with_fewer_inputs_reorder():
    wf = workflow()
    remap(wf, "S", "inputs", [2, 1, 0], WIDGETS)
    p = wf["definitions"]["subgraphs"][1]
    assert [s["name"] for s in node(p, 50)["inputs"]] == ["b"]
    assert links_by_id(p)[60]["target_slot"] == 0


def test_nested_instance_delete_input():
    wf = workflow()
    remap(wf, "S", "inputs", [0, 2], WIDGETS)
    p = wf["definitions"]["subgraphs"][1]
    assert node(p, 50)["inputs"] == []
    assert p["links"] == []
    assert node(p, 51)["outputs"][0]["links"] == []


def test_unknown_subgraph():
    with pytest.raises(ValueError, match="not in this workflow"):
        remap(workflow(), "nope", "inputs", [])


@pytest.mark.parametrize("keep", [[0, 0, 1], [0, 1, 3], [-1, 0, 1]])
def test_invalid_order(keep):
    with pytest.raises(ValueError, match="Invalid inputs order"):
        remap(workflow(), "S", "inputs", keep)


def test_instance_names_not_in_definition():
    wf = workflow()
    node(wf, 200)["outputs"].append(out("zz", []))
    with pytest.raises(ValueError, match="Node 200 has outputs"):
        remap(wf, "S", "outputs", [0, 1])


def floating(id, origin_id, origin_slot, target_id, target_slot):
    return dict(id=id, origin_id=origin_id, origin_slot=origin_slot, target_id=target_id, target_slot=target_slot, type="*")


def test_floating_links_delete_input():
    wf = workflow()
    wf["floatingLinks"] = [floating(1, -1, -1, 200, 1), floating(2, -1, -1, 200, 2), floating(3, 200, 1, -1, -1), floating(4, -1, -1, 300, 0)]
    sg = wf["definitions"]["subgraphs"][0]
    sg["floatingLinks"] = [floating(5, SG_IN, 1, -1, -1), floating(6, SG_IN, 2, -1, -1)]
    remap(wf, "S", "inputs", [0, 2], WIDGETS)
    assert wf["floatingLinks"] == [floating(2, -1, -1, 200, 1), floating(3, 200, 1, -1, -1), floating(4, -1, -1, 300, 0)]
    assert sg["floatingLinks"] == [floating(6, SG_IN, 1, -1, -1)]


def test_floating_links_delete_output():
    wf = workflow()
    wf["floatingLinks"] = [floating(3, 200, 1, -1, -1), floating(7, 200, 0, -1, -1)]
    sg = wf["definitions"]["subgraphs"][0]
    # Frontend #12986 writes the output node on the origin side.
    sg["floatingLinks"] = [floating(8, -1, -1, SG_OUT, 1), floating(9, SG_OUT, 0, -1, -1), floating(10, SG_OUT, 1, -1, -1)]
    remap(wf, "S", "outputs", [1])
    assert wf["floatingLinks"] == [floating(3, 200, 0, -1, -1)]
    assert sg["floatingLinks"] == [floating(8, -1, -1, SG_OUT, 0), floating(10, SG_OUT, 0, -1, -1)]


def check_links(g):
    """Every link is listed on both endpoint slots, the way rgthree's link checker expects."""
    nodes = {n["id"]: n for n in g.get("nodes", [])}
    for l in g.get("links", []):
        f = lf(l)
        if f["target_id"] not in (SG_IN, SG_OUT):
            assert nodes[f["target_id"]]["inputs"][f["target_slot"]]["link"] == f["id"]
        if f["origin_id"] not in (SG_IN, SG_OUT):
            assert f["id"] in nodes[f["origin_id"]]["outputs"][f["origin_slot"]]["links"]


@pytest.mark.parametrize("side, keep", [("inputs", [2, 0, 1]), ("inputs", [0, 2]), ("inputs", [1]), ("outputs", [1, 0]), ("outputs", [0]), ("outputs", [])])
def test_links_consistent_after_remap(side, keep):
    wf = workflow()
    remap(wf, "S", side, keep, WIDGETS)
    for g in [wf] + wf["definitions"]["subgraphs"]:
        check_links(g)


def test_minus_one_slot_links_deleted():
    # Corrupt links with slot -1 (frontend #15732) are never in the new order, so they are deleted.
    wf = workflow()
    wf["links"].append([99, 100, 0, 200, -1, "*"])
    node(wf, 100)["outputs"][0]["links"].append(99)
    sg = wf["definitions"]["subgraphs"][0]
    sg["links"].append(dict(id=98, origin_id=SG_IN, origin_slot=-1, target_id=1, target_slot=3, type="*"))
    remap(wf, "S", "inputs", [0, 1, 2], WIDGETS)
    assert 99 not in links_by_id(wf)
    assert node(wf, 100)["outputs"][0]["links"] == [20, 21, 24]
    assert node(wf, 200)["inputs"][2]["link"] is None
    assert 98 not in links_by_id(sg)
    assert node(sg, 1)["inputs"][3]["link"] == 15
