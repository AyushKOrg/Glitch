"""
pc_bridge.py
------------
Runs on YOUR PC, next to main.py. The Vercel site calls this (through a
tunnel) so the web chat is the real Glitch, with the tools that make sense
on the web.

    pip install fastapi uvicorn
    python pc_bridge.py

Env (.env next to main.py):
    GLITCH_BRIDGE_SECRET   required - must match the same variable on Vercel
    GLITCH_BRIDGE_PORT     default 8787
    GLITCH_USER_NAME       name Glitch uses for you (default "User")

Web edition rules:
  - Only two modes: cognition and flash. Perception is not available.
  - Tools that only make sense at the PC are NOT bound and NOT executable
    (desktop control, screen/mouse, Selenium browser, YouTube). Removing them
    from the executor too means a hallucinated call can't run them.
  - Kept: web search, document read/notes, image/PDF-page viewing (flash
    only, needs a vision model), Gmail, and the sandboxed code-file tools.
  - Uploads from the site land in <read folder>/web_uploads/ (4 MB max,
    allow-listed file types). Files Glitch creates in its code workspace can
    be downloaded from the site; hidden folders are never exposed.
"""

import hmac
import os
import re
import threading
from pathlib import Path
from urllib.parse import unquote

import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel

load_dotenv()

import main as glitch  # noqa: E402  (after load_dotenv so env is ready)
import docs_tools  # noqa: E402
import image_tools  # noqa: E402
from pc_tools import CODE_WORKSPACE_ROOT  # noqa: E402

SECRET = os.getenv("GLITCH_BRIDGE_SECRET", "")
PORT = int(os.getenv("GLITCH_BRIDGE_PORT", "8787"))
USER_NAME = os.getenv("GLITCH_USER_NAME", "User")

WEB_MODES = ("cognition", "flash")

if not SECRET:
    raise SystemExit("Set GLITCH_BRIDGE_SECRET in .env before starting the bridge.")

# ---------------------------------------------------------
# Web tool set
# ---------------------------------------------------------

# Everything here is useless (or unsafe) when you're driving Glitch from a
# browser tab, so it is removed entirely.
REMOVED_ON_WEB = {
    # desktop / PC control
    "open_app", "open_file", "open_url", "type_text", "press_key", "open_in_vscode",
    # screen + mouse
    "take_screenshot", "move_mouse", "click_at", "drag_to", "scroll",
    # Selenium browser
    "browser_open", "browser_click_text", "browser_fill_field", "browser_new_tab",
    "browser_close", "compose_gmail_draft",
    # YouTube
    "search_youtube", "get_video_transcript",
}

WEB_TOOLS_BY_NAME = {
    name: tool_fn
    for name, tool_fn in glitch.TOOLS_BY_NAME.items()
    if name not in REMOVED_ON_WEB
}

_web_tools = list(WEB_TOOLS_BY_NAME.values())

glitch.MODE_TOOLS = {
    # Nemotron is text-only: no image tools.
    "cognition": [t for t in _web_tools if t.name not in glitch.IMAGE_TOOL_NAMES],
    "flash": _web_tools,
}
# The tool loop looks tools up in this dict, so swapping it is what actually
# stops removed tools from running.
glitch.TOOLS_BY_NAME = WEB_TOOLS_BY_NAME
glitch.LLM_CACHE.clear()

WEB_ADDENDUM = (
    "\n\nWEB EDITION: you are being used through a website. You do NOT have "
    "tools to open apps/files/URLs, type or press keys, control the screen "
    "or mouse, drive a browser, or use YouTube. Ignore any earlier mention "
    "of them and say plainly that they aren't available here if asked. "
    "What you do have: web_search, document tools (list_folder, "
    "read_document, create_word_notes), Gmail tools, and the sandboxed code "
    "file tools.\n"
    "FILES: when the user's message contains '[Attached file: <path>]', the "
    "file was uploaded from the website and saved at that path inside your "
    "allowed read folder. Open it with read_document (text, code, PDF, Word) "
    "or view_image / render_pdf_page (pictures, scanned PDFs, flash mode "
    "only) using exactly that path. Never pretend to have read an attachment "
    "you didn't open. When the user wants code or a text file, create it "
    "with create_code_file (use a clear relative path like 'project/main.py'); "
    "for notes use create_word_notes. Created files appear in the website's "
    "Files panel for download, so tell the user the file name and that it's "
    "in the Files panel - don't paste a huge file into chat as well."
)

glitch.init_all_mode_databases()
glitch.SPEAK_REPLIES = False  # no talking out loud for web requests

COLOR_SCHEME = glitch.get_color_scheme("default")
_turn_lock = threading.Lock()  # one request at a time

app = FastAPI(title="Glitch PC bridge")


class Msg(BaseModel):
    role: str
    content: str


class ChatIn(BaseModel):
    messages: list[Msg]
    mode: str = "flash"
    user: str = ""   # signed-in website username (already validated by the site)


def require_secret(authorization: str = Header(default="")):
    token = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token.encode(), SECRET.encode()):
        raise HTTPException(status_code=401, detail="Bad secret")


@app.get("/health")
def health():
    return {"ok": True, "modes": list(WEB_MODES)}


@app.post("/chat", dependencies=[Depends(require_secret)])
def chat(body: ChatIn):
    mode = body.mode.strip().lower()

    if mode not in WEB_MODES:
        raise HTTPException(status_code=400, detail="mode must be 'cognition' or 'flash'")

    history = [m for m in body.messages if m.role in ("user", "assistant")][-20:]

    if not history or history[-1].role != "user":
        raise HTTPException(status_code=400, detail="Last message must be from the user")

    # Only ever a plain account name in the prompt, never free text.
    who = body.user if re.fullmatch(r"[a-z0-9_.-]{1,32}", body.user or "") else USER_NAME
    system_text = glitch.build_system_prompt(who, mode) + WEB_ADDENDUM
    messages = [SystemMessage(content=system_text)]

    for m in history:
        messages.append(HumanMessage(content=m.content) if m.role == "user" else AIMessage(content=m.content))

    if not _turn_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Glitch is busy with another request")

    try:
        glitch.CURRENT_MODE = mode
        reply = glitch.get_response(messages, COLOR_SCHEME)
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        _turn_lock.release()

    return {"reply": reply}


# ---------------------------------------------------------
# Uploads (website -> PC) and downloads (PC -> website)
# ---------------------------------------------------------

# Let read_document open common code/text files too (it falls back to
# plain-text reading for anything that isn't a PDF or Word file).
docs_tools.READABLE_EXTENSIONS.update({
    ".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".csv", ".html", ".css",
    ".java", ".c", ".cpp", ".h", ".cs", ".go", ".rs", ".sql", ".yaml", ".yml",
    ".xml", ".log", ".ini", ".toml",
})

UPLOAD_EXTENSIONS = set(docs_tools.READABLE_EXTENSIONS) | set(image_tools.IMAGE_EXTENSIONS)
UPLOAD_DIR = docs_tools.READ_ROOT / "web_uploads"   # inside the read folder, so the doc/image tools can open it
MAX_TRANSFER_BYTES = 4 * 1024 * 1024                # matches Vercel's request/response size limit
MAX_LISTED_FILES = 100
SKIP_DIRS = {"__pycache__", "node_modules"}


def _safe_upload_name(raw: str) -> str:
    """Basename only, boring characters only, allow-listed extension."""
    base = unquote(raw or "").replace("\\", "/").split("/")[-1]
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base).strip(" .")
    stem, ext = os.path.splitext(base)
    ext = ext.lower()

    if not stem or ext not in UPLOAD_EXTENSIONS:
        return ""

    return f"{stem[:80]}{ext}"


def _unique_path(directory: Path, name: str) -> Path:
    target = directory / name
    stem, ext = os.path.splitext(name)
    counter = 1

    while target.exists():
        target = directory / f"{stem}_{counter}{ext}"
        counter += 1

    return target


@app.post("/upload", dependencies=[Depends(require_secret)])
async def upload(request: Request, x_filename: str = Header(default="")):
    name = _safe_upload_name(x_filename)

    if not name:
        raise HTTPException(
            status_code=415,
            detail="That file type isn't supported. Allowed: "
            + ", ".join(sorted(UPLOAD_EXTENSIONS)),
        )

    declared = int(request.headers.get("content-length") or 0)

    if declared > MAX_TRANSFER_BYTES:
        raise HTTPException(status_code=413, detail="File is over 4 MB.")

    data = await request.body()

    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")

    if len(data) > MAX_TRANSFER_BYTES:
        raise HTTPException(status_code=413, detail="File is over 4 MB.")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    target = _unique_path(UPLOAD_DIR, name)
    target.write_bytes(data)

    return {"path": f"web_uploads/{target.name}", "size": len(data)}


def _is_hidden(parts) -> bool:
    return any(p.startswith(".") or p in SKIP_DIRS for p in parts)


@app.get("/files", dependencies=[Depends(require_secret)])
def list_files():
    """Files Glitch created in its code workspace (code files, notes/*.docx).
    Hidden folders (.screenshots, .images, ...) are never listed."""
    found = []

    if CODE_WORKSPACE_ROOT.exists():
        for dirpath, dirnames, filenames in os.walk(CODE_WORKSPACE_ROOT):
            dirnames[:] = [d for d in dirnames if not _is_hidden([d])]

            for filename in filenames:
                full = Path(dirpath) / filename
                rel = full.relative_to(CODE_WORKSPACE_ROOT)

                if _is_hidden(rel.parts):
                    continue

                try:
                    stat = full.stat()
                except OSError:
                    continue

                found.append({
                    "path": rel.as_posix(),
                    "size": stat.st_size,
                    "modified": int(stat.st_mtime),
                    "downloadable": stat.st_size <= MAX_TRANSFER_BYTES,
                })

    found.sort(key=lambda f: f["modified"], reverse=True)
    return {"files": found[:MAX_LISTED_FILES]}


@app.get("/download", dependencies=[Depends(require_secret)])
def download(path: str):
    resolved = (CODE_WORKSPACE_ROOT / path).resolve()

    try:
        rel = resolved.relative_to(CODE_WORKSPACE_ROOT)
    except ValueError:
        raise HTTPException(status_code=400, detail="Path is outside the workspace.")

    if _is_hidden(rel.parts) or not resolved.is_file():
        raise HTTPException(status_code=404, detail="No such file.")

    if resolved.stat().st_size > MAX_TRANSFER_BYTES:
        raise HTTPException(status_code=413, detail="File is over 4 MB; copy it from the PC instead.")

    return FileResponse(resolved, filename=resolved.name)


if __name__ == "__main__":
    # Bind to localhost only; the tunnel is what exposes it.
    uvicorn.run(app, host="127.0.0.1", port=PORT)
