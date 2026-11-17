"""Raksa · Desain D Business Manager (hanya saat dibuka dari alamat Business Manager):
bar atas bersama (/bm-bar.js), warna & huruf bersama (/bm-tema.css), tema terang/gelap ikut BM.
Di alamat raksa-mu (robot manual UI.Vision) tampilan tetap seperti dulu."""
import re, sys, pathlib
D = pathlib.Path(__file__).resolve().parent.parent / "dist"

def ganti(s, a, b, n=1):
    assert s.count(a) == n, (a[:80], s.count(a))
    return s.replace(a, b)

# --- app.js
p = D / "app.js"; s = p.read_text()
s = ganti(s, 'F!=null&&F.value&&c(F.value)}catch{}})()},[])',
  'F!=null&&F.value&&!window.BMTema&&c(F.value)}catch{}})();const bmT=e=>c(e.detail.gelap?"dark":"light");document.addEventListener("bm-tema",bmT);return()=>document.removeEventListener("bm-tema",bmT)},[])')
s = ganti(s, 'document.documentElement.classList.toggle("dark",u==="dark");',
  'document.documentElement.classList.toggle("dark",u==="dark");if(window.BMTema&&BMTema.gelap()!==(u==="dark"))BMTema.set(u);')
s = ganti(s, 'function RaksaPindahAplikasi({peran}){', 'function RaksaPindahAplikasi({peran}){if(window.BMTema)return null;')
s = ganti(s, 'f.jsx("button",{onClick:()=>i(a==="dark"?"light":"dark"),className:"rounded-lg border border-n-200 bg-surface p-2 text-n-800 hover:bg-n-50"',
  'f.jsx("button",{onClick:()=>i(a==="dark"?"light":"dark"),className:"rk-tema rounded-lg border border-n-200 bg-surface p-2 text-n-800 hover:bg-n-50"')
s = ganti(s, 'className:"sticky top-0 z-30 border-b border-n-200 bg-surface/95 backdrop-blur"', 'className:"rk-kepala sticky top-0 z-30 border-b border-n-200 bg-surface/95 backdrop-blur"')
s = ganti(s, '"sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-auto bg-brand-900 py-5 lg:flex"', '"rk-sisi sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-auto bg-brand-900 py-5 lg:flex"')
p.write_text(s)

# --- index.html (dua salinan)
SISIP = ('<script>/* Business Manager: bar atas & tema bersama (Desain D) */if(location.hostname!=="raksa-mu.vercel.app")'
         'document.write(\'<link rel="stylesheet" href="/bm-tema.css"><script src="/bm-bar.js"><\\/script>\');</script>\n'
         '<script>if(window.BMTema)document.documentElement.dataset.theme=BMTema.gelap()?"dark":"light";</script>\n</head>')
for f in [D / "index.html", D / "raksa" / "index.html"]:
    t = f.read_text()
    if "bm-bar.js" not in t:
        t = ganti(t, "</head>", SISIP)
        t = ganti(t, "if(window.__rkBM||window.top!==window", "if(window.__rkBM||window.BMTema||window.top!==window")
    f.write_text(t)

# --- raksa.css: warna Desain D (triplet RGB untuk Tailwind Raksa)
CSS = r"""
/* ===== Business Manager · Desain D (hanya saat bar BM aktif) ===== */
html.bm-ber-bar{--bg:255 255 255;--surface:255 255 255;--n-50:247 248 250;--n-100:242 244 247;--n-200:227 230 235;--n-300:205 210 218;--n-400:156 163 175;--n-500:107 114 128;--n-600:75 85 99;--n-700:55 65 81;--n-800:31 41 55;--n-900:17 24 39}
html.bm-ber-bar.dark{--bg:14 16 20;--surface:21 24 30;--n-50:18 20 25;--n-100:27 31 39;--n-200:39 43 52;--n-300:52 57 69;--n-400:107 115 131;--n-500:148 156 171;--n-600:180 186 197;--n-700:196 201 210;--n-800:220 223 229;--n-900:232 234 239}
html.bm-ber-bar,html.bm-ber-bar body{font-family:var(--bm-font)}
html.bm-ber-bar .font-mono,html.bm-ber-bar code,html.bm-ber-bar .tabular-nums{font-family:var(--bm-mono)}
html.bm-ber-bar .rounded-2xl{border-radius:.75rem}html.bm-ber-bar .rounded-3xl{border-radius:.875rem}html.bm-ber-bar .rounded-xl{border-radius:.625rem}
html.bm-ber-bar main > *{animation:bm-masuk .18s ease-out}
html.bm-ber-bar header.rk-kepala{top:var(--bm-bar-h)}
html.bm-ber-bar .rk-tema{display:none}
html.bm-ber-bar aside.rk-sisi{top:var(--bm-bar-h);height:calc(100vh - var(--bm-bar-h));background:var(--bm-side);border-right:1px solid var(--bm-border);padding-top:12px;color:var(--bm-fg-2)}
html.bm-ber-bar aside.rk-sisi > div:first-child{display:none}
html.bm-ber-bar aside.rk-sisi::before{content:"RAKSA";display:block;padding:0 22px 8px;font:600 11px var(--bm-mono);letter-spacing:.06em;color:var(--bm-muted)}
html.bm-ber-bar aside.rk-sisi [class*="text-white"]{color:var(--bm-muted)}
html.bm-ber-bar aside.rk-sisi [data-nav]{color:var(--bm-fg-2);border-radius:6px;font-size:13.5px}
html.bm-ber-bar aside.rk-sisi [data-nav]:hover{background:var(--bm-surface-2);color:var(--bm-fg)}
html.bm-ber-bar aside.rk-sisi [data-nav].bg-white\/10{background:var(--bm-surface);color:var(--bm-fg);font-weight:600;box-shadow:inset 3px 0 0 var(--bm-acc),0 0 0 1px var(--bm-border)}
"""
c = D / "raksa.css"; t = c.read_text()
if "Desain D" not in t:
    c.write_text(t + CSS)
print("ok")
