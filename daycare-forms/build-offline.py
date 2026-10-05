"""Builds daycare-forms-offline.html: the whole tool (library, forms, templates) in one file
that opens straight from a Downloads folder, with no server and no connection.
Run after any change:  python3 daycare-forms/build-offline.py"""
import base64, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
read = lambda p: open(os.path.join(HERE, p), encoding='utf-8').read()

html, app, forms, lib = read('index.html'), read('app.js'), read('forms.js'), read('vendor/pdf-lib.min.js')
paths = re.findall(r"'(templates/[^']+\.pdf)'", forms)
embedded = {p: base64.b64encode(open(os.path.join(HERE, p), 'rb').read()).decode() for p in paths}

# Templates come from the embedded copies instead of the network.
a = """    if (!templateCache[path]) {
      const r = await fetch(path);"""
b = """    if (!templateCache[path] && window.EMBEDDED_TEMPLATES && window.EMBEDDED_TEMPLATES[path]) {
      templateCache[path] = Uint8Array.from(atob(window.EMBEDDED_TEMPLATES[path]), ch => ch.charCodeAt(0));
    }
    if (!templateCache[path]) {
      const r = await fetch(path);"""
assert a in app; app = app.replace(a, b)
a = "if ('serviceWorker' in navigator)"
assert a in app; app = app.replace(a, "if (location.protocol.startsWith('http') && 'serviceWorker' in navigator)")

html = html.replace('<link rel="manifest" href="manifest.json">\n', '').replace('<link rel="icon" href="../icons/icon-daycare-forms-192.png">\n', '')
html = re.sub(r'(<div class="subtitle">v[\d.]+)', r'\1 (single-file copy)', html)
esc = lambda js: js.replace('</script', '<\\/script')
scripts = ('<script>' + esc(lib) + '</script>\n<script>window.EMBEDDED_TEMPLATES=' + json.dumps(embedded) + ';</script>\n'
           '<script>' + esc(forms) + '</script>\n<script>' + esc(app) + '</script>')
old = '<script src="vendor/pdf-lib.min.js"></script>\n<script src="forms.js"></script>\n<script src="app.js"></script>'
assert old in html; html = html.replace(old, scripts)
open(os.path.join(HERE, 'daycare-forms-offline.html'), 'w', encoding='utf-8').write(html)
print('wrote daycare-forms-offline.html', len(html) // 1024, 'KB')
