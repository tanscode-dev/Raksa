#!/usr/bin/env bash
# Membangun Raksa 1.0 ke folder dist/ (situs statis siap di-deploy ke Vercel).
set -euo pipefail
cd "$(dirname "$0")"
VERSI="${RAKSA_VERSI:-1.0.$(date +%y%m%d%H%M)}"
SUPABASE_URL="${SUPABASE_URL:-https://djvvnkvdmwyltdhjmoax.supabase.co}"
SUPABASE_KEY="${SUPABASE_KEY:-sb_publishable_47Yl6p-QFvBiG5ltoNH9hg_KY3gm-xF}"
GITHUB_ACTIONS="${GITHUB_ACTIONS_URL:-https://github.com/tanscode-dev/Raksa/actions/workflows/robot1.yml}"

rm -rf dist && mkdir -p dist
# 1. aplikasi: prototype yang disetujui + perubahan produksi
python3 tools/patch.py prototype/raksa-prototype-v15.js src/komponen.jsx dist/app.raw.js
npx esbuild dist/app.raw.js --minify-whitespace --minify-syntax --target=es2020 --outfile=dist/app.js --log-level=warning
rm dist/app.raw.js
# 2. pembuka (login + sinkron data)
npx esbuild src/boot.js --bundle --minify --target=es2020 --format=iife --outfile=dist/boot.js --log-level=warning \
  --define:__SUPABASE_URL__="\"$SUPABASE_URL\"" --define:__SUPABASE_KEY__="\"$SUPABASE_KEY\"" \
  --define:__GITHUB_ACTIONS__="\"$GITHUB_ACTIONS\"" --define:__VERSI__="\"$VERSI\""
# 3. file statis
cp src/raksa.css dist/raksa.css
cp -r public/. dist/
sed "s/__VERSI__/$VERSI/g" src/index.html > dist/index.html
sed "s/__VERSI__/$VERSI/g" src/sw.js > dist/sw.js
cp vercel.json dist/vercel.json
echo "Raksa $VERSI siap di dist/"
