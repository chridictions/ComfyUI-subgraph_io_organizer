import importlib.util
import sys
import types
from pathlib import Path

from aiohttp import web

ROOT = Path(__file__).resolve().parent.parent

server = types.ModuleType("server")
server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(routes=web.RouteTableDef()))
sys.modules["server"] = server

spec = importlib.util.spec_from_file_location("subgraph_io_organizer", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
package = importlib.util.module_from_spec(spec)
sys.modules["subgraph_io_organizer"] = package
spec.loader.exec_module(package)

# The project folder name has a hyphen, so pytest imports its __init__.py as a top-level "__init__"
# module while setting up the tests, where the relative import fails. Hand it the package loaded above.
sys.modules["__init__"] = package
