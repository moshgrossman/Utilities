#!/usr/bin/env python3
"""Build form-filler-offline.html — one self-contained file, no folder, no server.

Run from the repo root:   python3 form-filler/build-offline.py
Everything (libraries included) is inlined, so the file works when opened
straight from a Downloads folder with no network at all.
"""
import base64, pathlib, re

HERE = pathlib.Path(__file__).parent
html = (HERE / "index.html").read_text(encoding="utf-8")

def inline_script(src_attr, path):
    return f"<script>\n/* {path.name} */\n{path.read_text(encoding='utf-8')}\n</script>"

for name in ["pdf.min.js", "pdf-lib.min.js", "mammoth.min.js", "html2canvas.min.js"]:
    tag = f'<script src="vendor/{name}"></script>'
    html = html.replace(tag, inline_script(tag, HERE / "vendor" / name))

# The pdf.js worker has to stay a separate file at runtime, so carry it as
# base64 and hand the library a Blob built from it.
worker_b64 = base64.b64encode((HERE / "vendor" / "pdf.worker.min.js").read_bytes()).decode()
html = html.replace(
    "<script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';</script>",
    "<script>\n(function(){var b=atob(\"" + worker_b64 + "\");var a=new Uint8Array(b.length);"
    "for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);"
    "pdfjsLib.GlobalWorkerOptions.workerSrc=URL.createObjectURL(new Blob([a],{type:'text/javascript'}));})();\n</script>")

for name in ["detect.js", "app.js"]:
    html = html.replace(f'<script src="{name}"></script>', inline_script(name, HERE / name))

# No manifest, no icon file and no service worker when it is a lone file.
html = re.sub(r'\s*<link rel="manifest"[^>]*>', "", html)
html = re.sub(r'\s*<link rel="icon"[^>]*>', "", html)

out = HERE / "form-filler-offline.html"
out.write_bytes(html.encode("utf-8"))
print(f"wrote {out} ({out.stat().st_size/1024/1024:.1f} MB)")
