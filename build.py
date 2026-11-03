import pathlib
s = pathlib.Path('src')
css, core, demo, app = [(s/f).read_text() for f in ['style.css','core.js','demo.js','app.js']]
head = '''<title>SimTag 2027 Dienstplan</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;600&family=IBM+Plex+Mono:wght@500;600&display=swap">
<style>
''' + css + '''</style>
'''
body = lambda demo_flag: '''<div id="app"><p style="padding:24px">SimTag-Dienstplan wird geladen …</p></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>''' + ('window.SIMTAG_DEMO=true;' if demo_flag else '') + '''</script>
<script>
''' + core + '''</script>
<script>
''' + demo + '''</script>
<script>
''' + app + '''</script>
'''
out = pathlib.Path('dist'); out.mkdir(exist_ok=True)
(out/'simtag-dienstplan.html').write_text(head + body(True))
(out/'public').mkdir(exist_ok=True)
(out/'public'/'index.html').write_text('<!doctype html>\n<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>\n' + head + '</head><body>\n' + body(False) + '</body></html>\n')
print('ok')
