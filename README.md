<p align="center">
  <img src="pasty-logo.png" alt="Pasty" width="400">
</p>

<h1 align="center">Pasty</h1>

<p align="center">
  A browser-based image layer compositing tool built with vanilla Web Components.<br>
  Paste images, stack layers, blend, transform, and export — no server required.
</p>

---

## Overview

Pasty is a lightweight, client-side image compositing app that runs entirely in the browser. It uses Web Components, SVG rendering, and IndexedDB for persistent storage. There are no dependencies, no build step, and no server — just open `index.html` in a browser.

## Features

- **Layer compositing** — Paste or drag-and-drop images as layers, reorder them, and adjust visibility, opacity, and blend modes
- **18 blend modes** — normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity, plus-darker, plus-lighter
- **Transform tools** — Move, scale, rotate, and resize layers directly on the canvas or via numeric inputs in the panel
- **Pan & zoom** — Space+drag to pan, scroll wheel to zoom, with zoom level display and fit-to-canvas button
- **Undo/redo** — Full undo/redo history with `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`
- **Persistent state** — Layer metadata saved to localStorage, image data stored in IndexedDB; survives page reloads
- **Project save/load** — Export the full project as JSON (with embedded images) and re-import it later
- **Image export** — Export the composited result as SVG and/or PNG
- **Resizable panel** — Drag the panel edge to resize the layers panel between 200px and 600px
- **No dependencies** — Pure vanilla JS, Web Components, and browser APIs

## Getting Started

1. Open `index.html` in any modern browser
2. Paste an image (`Ctrl/Cmd+V`) or drag-and-drop an image file onto the canvas
3. Add more layers, adjust blend modes and opacity, transform and position them
4. Export your composition as SVG or PNG

## Keyboard & Mouse Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + V` | Paste image as new layer |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + 0` | Reset zoom |
| `Arrow keys` | Nudge selected layer 1px |
| `Shift + Arrow keys` | Nudge selected layer 10px |
| `Alt + Up/Down` | Reorder layer z-index |
| `Delete / Backspace` | Delete selected layer |
| `Space + drag` | Pan canvas |
| `Scroll wheel` | Zoom in/out |
| `Alt + drag` | Scale width (horizontal) / height (vertical) |
| `Alt + Shift + drag` | Scale proportionally |
| `Alt + R + drag` | Rotate layer |
| `Double-click layer name` | Rename layer |

## Layers Panel

Each layer row shows:

- **Drag handle** — Grip icon to reorder layers by dragging
- **Visibility toggle** — Show/hide the layer
- **Lock toggle** — Lock the layer to prevent edits
- **Thumbnail** — Preview of the layer image
- **Layer name** — Double-click to rename
- **Blend mode** — Dropdown to select from 18 blend modes
- **Opacity slider** — Drag to adjust layer opacity with live canvas preview
- **Delete button** — Remove the layer
- **Transform controls** (selected layer) — Numeric inputs for width, height, and rotation

## Project Management

| Button | Action |
|---|---|
| **Save** | Exports the full project as JSON with embedded image data; copy to clipboard |
| **Load** | Paste previously saved JSON to restore a project |
| **Clear** | Permanently deletes all layers, images, and undo history (with confirmation) |

## Export

Check **SVG** and/or **PNG** and click **Export Image** to download the composited result. The selection outline is automatically excluded from exports.

## Architecture

Pasty is built with four Web Components and a shared state module:

| File | Component | Role |
|---|---|---|
| `pasty-app.js` | `<pasty-app>` | Root shell — layout, resize handle, global keyboard shortcuts |
| `pasty-canvas.js` | `<pasty-canvas>` | SVG canvas — rendering, pan/zoom, drag/transform interactions |
| `pasty-panel.js` | `<pasty-panel>` | Layers panel — layer list, controls, drag reorder |
| `pasty-export.js` | `<pasty-export>` | Export section — SVG/PNG export, project save/load/clear |
| `state.js` | _(module)_ | Shared state — layers, undo/redo, IndexedDB images, event bus |

## Storage

- **localStorage** — Layer metadata, undo/redo stacks, viewBox, selection
- **IndexedDB** (`pasty-db`) — Full image data as base64 data URLs

## License

MIT
