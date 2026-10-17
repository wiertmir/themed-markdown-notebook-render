#!/bin/sh
# Copies the viewers' browser builds out of node_modules into vendor/, which the .vsix ships (vsce leaves out node_modules).
set -e
rm -rf vendor
mkdir -p vendor/mermaid/chunks vendor/leaflet vendor/three
cp node_modules/mermaid/dist/mermaid.esm.min.mjs vendor/mermaid/
cp -r node_modules/mermaid/dist/chunks/mermaid.esm.min vendor/mermaid/chunks/
rm vendor/mermaid/chunks/*/*.map
cp -r node_modules/leaflet/dist/leaflet-src.esm.js node_modules/leaflet/dist/leaflet.css node_modules/leaflet/dist/images vendor/leaflet/
cp -r node_modules/topojson-client/src vendor/topojson-client
cp node_modules/three/build/three.module.js node_modules/three/build/three.core.js vendor/three/
# the addons import the bare 'three', which the webview can't resolve
for f in loaders/STLLoader.js controls/OrbitControls.js; do
  sed "s|from 'three'|from './three.module.js'|" "node_modules/three/examples/jsm/$f" > "vendor/three/$(basename "$f")"
done
