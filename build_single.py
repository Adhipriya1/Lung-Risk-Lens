"""Builds dist/lung-risk-lens.html: one self-contained file with the CSV embedded (offline use / sharing)."""
import re, pathlib
root = pathlib.Path(__file__).parent
html = (root/'index.html').read_text(encoding='utf-8')
css = (root/'styles.css').read_text(encoding='utf-8')
js = (root/'ml.js').read_text(encoding='utf-8') + '\n' + (root/'app.js').read_text(encoding='utf-8')
csv = (root/'data/lung_cancer.csv').read_text(encoding='utf-8')
html = html.replace('<script src="data/lung_cancer.js"></script>\n','')
(root/'data/lung_cancer.js').write_text('/* bundled copy of lung_cancer.csv, used only when the page is opened without a server. Regenerate with build_single.py */\nwindow.SEED_CSV = ' + __import__('json').dumps(csv) + ';\n', encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="styles.css">', f'<style>\n{css}\n</style>')
html = html.replace('<script src="ml.js"></script>\n', '').replace('<script src="app.js"></script>', f'<script id="seed" type="text/plain">{csv}</script>\n<script>\n{js}\n</script>')
(root/'dist').mkdir(exist_ok=True)
(root/'dist/lung-risk-lens.html').write_text(html, encoding='utf-8')
# artifact variant: no doctype/html/head/body wrappers
head = re.search(r'<head>(.*)</head>', html, re.S).group(1)
head = re.sub(r'<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*', '', head)
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
(root/'dist/artifact.html').write_text(head.strip() + '\n' + body.strip() + '\n', encoding='utf-8')
print('ok', len(html))
