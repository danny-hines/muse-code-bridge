# Combined launcher icon

The current launcher uses `chatgpt-muse.png` and `chatgpt-muse.icns`: the ChatGPT knot with a Meta badge at lower right. It was made with the built-in imagegen tool and packaged with standard macOS padding and a transparent icon mask. The [current prompt](chatgpt-muse-prompt.md) is saved alongside it. Rebuild the current ICNS with `node scripts/build-launcher-icon.mjs`.

## Previous Codex variant

`codex-muse.png` and `codex-muse.icns` retain the earlier Codex-based design for reference. The installer now uses the ChatGPT-based variant above.

The artwork was created with the built-in `image_gen` tool, using the installed Codex `app.icns` as the reference, with a Meta infinity badge in the lower-right corner. Native icon packaging applies a transparent macOS rounded-square mask and standard padding. No API-key/CLI image generation was used.

The following prompts document the earlier Codex-based variant.

## Generation prompt

Use case: compositing.
Asset type: a single macOS application icon, square 1024 by 1024 pixels.
Edit target: the supplied original Codex app icon. Preserve its blue/purple soft glass flower-shaped icon, white terminal chevron and underscore, proportions, lighting and white rounded-square app tile. Keep the Codex mark recognizable and essentially unchanged.
Primary request: add a small Meta logo badge at the lower-right corner to distinguish a combined Codex + Muse launcher.
Badge: a clean, crisp white circular badge with a very subtle gray edge and soft shadow. Inside it, the recognizable blue Meta infinity-loop symbol ONLY, no wordmark and no lettering. The badge should occupy about 27 percent of the canvas width, centered at roughly 78 percent across and 78 percent down, overlapping the bottom-right edge of the blue Codex flower without covering the white terminal mark. Make the Meta loop legible at small Dock sizes.
Keep the result polished, simple, and aligned to macOS icon conventions. One icon only, straight-on. Use transparent pixels outside the rounded-square tile; no checkerboard, no surrounding scene, no labels, no additional symbols. Do not redraw the original into a different style.

## Background refinement prompt

Use case: background-extraction. Edit this exact macOS icon: keep the white rounded-square tile, blue/purple Codex flower and terminal mark, and small Meta infinity badge at lower right exactly as they are. Remove ONLY the gray checkerboard outside the rounded-square tile. The checkerboard in the input is an unwanted opaque background, NOT part of the design. Deliver a PNG with a real transparent alpha channel outside the icon, alpha zero at all four outer corners. Do not paint or simulate transparency with any pattern. Do not add a shadow on a background, do not include any checkerboard pixels, no colored backdrop. Preserve the icon's edges cleanly. One square 1024x1024 icon.

The generated background remained opaque; the native icon mask excludes that outside matte. The final PNG has transparent corners.
