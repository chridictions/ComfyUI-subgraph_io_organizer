from aiohttp import web
from server import PromptServer

from .organizer import remap

WEB_DIRECTORY = "./js"
NODE_CLASS_MAPPINGS = {}


@PromptServer.instance.routes.post("/subgraph_io_organizer/apply")
async def apply(request):
    body = await request.json()
    wf = body["workflow"]
    try:
        remap(wf, body["sg_id"], "inputs", body["inputs"])
        remap(wf, body["sg_id"], "outputs", body["outputs"])
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    return web.json_response(wf)
