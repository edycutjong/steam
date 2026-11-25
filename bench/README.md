# Benchmarks

`steam-renderer.json` is written by `scripts/measure-steam.ts`. It is the only source for any fps figure in this repository.

## Reproduce

```sh
npm run bench
```

That runs `npm run build`, serves `dist/` with `vite preview`, and drives Chromium through Playwright. For each profile it loads `/?fps=1`, waits for the renderer's first frame, then records every `requestAnimationFrame` interval for 15 s (the lead-in, the write-on and the hold). It exits 1 when a profile has an average below 55 fps or a frame slower than 1000/55 ms; the JSON is written either way.

Profiles:

| Name | Viewport | Device scale | CPU |
| --- | --- | --- | --- |
| `desktop-1280x720` | 1280×720 | 1 | none |
| `desktop-1920x1080` | 1920×1080 | 1 | none |
| `pixel5-4x-cpu` | 393×851, touch | 2.75 | `Emulation.setCPUThrottlingRate` 4 |

Each profile records frames, average fps, frames under 55 fps (intervals over 18.18 ms), p50 / p95 / worst frame time, the one-time `derive` duration, the GPU renderer from `WEBGL_debug_renderer_info`, and the profile's settings. The file also records the machine (`os.cpus()[0].model`), browser version and date.

Options: `BENCH_MS=<ms>` changes the duration (default 15000). `BENCH_ANGLE=<backend>` passes `--use-angle=<backend>` to Chromium (for example `metal`); without it Chromium picks its own backend, which is what the committed run used.

## Reading the numbers

The committed run used whatever backend Chromium chose on that machine; the `gpuRenderer` field says which. Frame times are quantised by the display clock (about 16.7 ms), so p50 and p95 sit on that value. Run the command on the machine you care about and compare its own file.

## Committed runs

| File | Backend (`gpuRenderer`) | Command | Result |
| --- | --- | --- | --- |
| `steam-renderer.json` | ANGLE SwiftShader (software GL; Chromium's default in this headless run), shader at commit d829327 (before the renderer-v0-frames D6-D11 fixes) | `npm run bench` | ~59.5-59.8 fps average, 3-6 frames under 55 per profile → fails the zero-slow-frame criterion |
| `steam-renderer-metal.json` | ANGLE Metal, Apple M1 Max (hardware GPU, not throttled), shader at commit 68a379d (after D6-D11) | `BENCH_ANGLE=metal npm run bench`, then the file renamed | 901 frames per profile at 60 fps, 0 frames under 55 on all three profiles |

Both are the same machine and build. The Pixel 5 profile throttles the CPU only (4×), never the GPU, so it is not a real phone: a physical-device run is still owed. `derive` (one-time, on load) took 345.9 ms under 4× CPU before D6 removed the channel dilation, and 103.4 ms after it (metal file), still over the 50 ms budget in R15.5 (task 39 moves it into a Web Worker). The SwiftShader row is not re-run on the D6-D11 shader yet.


## Cook Mode: `cook.json`

Written by `scripts/measure-cook.ts` (`npm run bench:cook`): the deep link `/#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12&lead=3&fps=1` in the production build, every `requestAnimationFrame` interval for 15 s from `cook:ready` (lead-in, write-on, hold), and the times from navigation to `cook:ready` and to `cook:reveal:till-it-looks-red-smooth`. Run 2026-11-25T00:15:58.762Z on Apple M1 Max, Chromium 159.0.8154.6, SwiftShader.

| Profile | Mean fps | Min fps | Worst frame ms | Frames over 18.2 ms | Nav to ready ms | Nav to reveal ms | Budget |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `desktop-1280x720` | 59.54 | 29.94 | 33.4 | 7 | 1553 | 3108 | fail |
| `pixel5-4x-cpu` | 28.01 | 14.99 | 66.7 | 388 | 1814 | 3276 | fail |

Both profiles miss the budget in this run. The machine was loaded (load averages 16.96 25.49 22.56 by `uptime`), and the renderer-only benchmark re-run under the same load measured 34.3 fps desktop and 21.78 fps on the Pixel 5 profile (`docs/kiro-evidence/cook-mode/renderer-same-load.txt`), below Cook Mode's own figures, so this run does not separate Cook Mode's cost from the load. A run on an idle machine is still owed.
