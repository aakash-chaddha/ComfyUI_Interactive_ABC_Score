# Vendored assets

Everything here is served locally from this node package's static route.
Nothing in this package makes an internet request at runtime.

## abcjs

- Package: `abcjs` v6.7.0 (MIT), © 2009-2026 Paul Rosen and Gregory Dyke
- Source: https://registry.npmjs.org/abcjs/-/abcjs-6.7.0.tgz
- File: `vendor/abcjs/abcjs-basic-min.js` (verbatim `dist/abcjs-basic-min.js` from the tarball)
- License: `vendor/abcjs/LICENSE.md` (from the tarball)
- Refresh: download the newer tarball and replace the dist file.

## SoundFont (FluidR3 GM, acoustic grand piano)

- Source: https://github.com/paulrosen/midi-js-soundfonts (branch `gh-pages`),
  folder `FluidR3_GM/acoustic_grand_piano-mp3/`, fetched via
  `raw.githubusercontent.com/paulrosen/midi-js-soundfonts/gh-pages/FluidR3_GM/acoustic_grand_piano-mp3/<NOTE>.mp3`
- Files: `soundfont/acoustic_grand_piano-mp3/*.mp3` (89 files, ~2.2 MB) — the
  layout abcjs's synth loads: `{root}{instrument}-mp3/{note}.mp3`
- The underlying samples are FluidR3_GM by Frank Neumann (freeware GM bank);
  they are distributed in midi-js-soundfonts alongside the project's own
  notices. Keep this provenance note on refresh.
- Full multi-instrument sets can be dropped in by any user-supplied root
  registered in `localStorage['AbcScore.soundFontUrl']` (must end with `/`).
  The default install never reaches for the network.
