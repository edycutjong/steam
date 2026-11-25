# Benchmarks

`results.json` is written by `scripts/measure-steam.ts` (five profiles, steam-renderer-v1). `steam-renderer.json` and `steam-renderer-metal.json` are the older three-profile runs of the v0 renderer and are kept as they were. These files and `cook.json` are the only sources for any fps figure in this repository.

## Reproduce

```sh
npm run bench
```

That runs `npm run build`, serves `dist/` with `vite preview`, and drives Chromium through Playwright. For each profile it loads `/?fps=1`, waits for the renderer's first frame, then records every `requestAnimationFrame` interval for 15 s (the lead-in, the write-on and the hold). It exits 1 when a profile has an average below 55 fps or a frame slower than 1000/55 ms; the JSON is written either way.

Profiles (defined in `scripts/steam-bench.ts`, summarised by `summarize` there):

| Name | Viewport | Device scale | CPU | GL | URL |
| --- | --- | --- | --- | --- | --- |
| `desktop-1280x720` | 1280x720 | 1 | none | the machine's | hero route `?fps=1` |
| `desktop-1920x1080` | 1920x1080 | 1 | none | the machine's | hero route `?fps=1` |
| `pixel5-4x-cpu` | 393x851, touch | 2.75 | `Emulation.setCPUThrottlingRate` 4 | the machine's | hero route `?fps=1` |
| `swiftshader-1280x720` | 1280x720 | 1 | none | Chromium software GL (`--use-angle=swiftshader`) | hero route `?fps=1` |
| `capture-1920x1080` | 1920x1080 | 1 | none | the machine's | hero route, no overlay (the video-capture setup) |

Each row records: frames, average fps, `p5Fps` (the 5th-percentile frame rate, 1000 / p95 frame time), frames under 55 fps (intervals over 18.18 ms), frame-time p50 / p95 / worst, `tier` (the quality governor's tier at the end of the run, read from `window.__steamStats.tier`: 0 full, 1 half-resolution fog, 2 no droplet or run detail, 3 static pane), the GPU renderer and vendor from `WEBGL_debug_renderer_info`, the one-time `derive` duration, and whether the row passed. The file also records the machine (`os.cpus()[0].model`), browser version and date. The software-GL row is recorded for the record: it has `budget: false` and never fails the run. The other four rows are the budget, and exit code 1 means one of them missed it.

A row whose `tier` is above 0 means the governor had to give up quality on that machine, so its fps is not the full-quality figure. Read `tier` before `avgFps`.

Options: `BENCH_MS=<ms>` changes the duration (default 15000). `BENCH_ANGLE=<backend>` passes `--use-angle=<backend>` to Chromium for the hardware rows (for example `metal`); without it Chromium picks its own backend. The software row always uses SwiftShader.

`bench/results.json` is the committed v1 run (below). Every number about the v1 renderer must come from it. The machine was **not idle**: other jobs were running, so the load average is recorded with each run.

## Reading the numbers

The committed run used whatever backend Chromium chose on that machine; the `gpuRenderer` field says which. Frame times are quantised by the display clock (about 16.7 ms), so p50 and p95 sit on that value. Run the command on the machine you care about and compare its own file.

## Committed runs

| File | Backend (`gpuRenderer`) | Command | Result |
| --- | --- | --- | --- |
| `steam-renderer.json` | ANGLE SwiftShader (software GL; Chromium's default in this headless run), shader at commit d829327 (before the renderer-v0-frames D6-D11 fixes) | `npm run bench` | ~59.5-59.8 fps average, 3-6 frames under 55 per profile → fails the zero-slow-frame criterion |
| `steam-renderer-metal.json` | ANGLE Metal, Apple M1 Max (hardware GPU, not throttled), shader at commit 68a379d (after D6-D11) | `BENCH_ANGLE=metal npm run bench`, then the file renamed | 901 frames per profile at 60 fps, 0 frames under 55 on all three profiles |
| `results.json` | ANGLE Metal, Apple M1 Max (hardware GPU, not throttled) for the four budget rows; SwiftShader for the software row. Shader at commit 553c771 (steam-renderer-v1 after look pass 3) | `BENCH_ANGLE=metal npm run bench`, 2026-11-25 22:24-22:26 WIB, load average 42 → 49 (1-min) | Second of two back-to-back runs. Budget rows: 901 frames at 60 fps, 0 frames under 55, tier 0 on all four. Software row: 34.96 fps, 182 frames under 55, governor ended at tier 3 (static pane). The first run (22:23, load average 37 → 42) had the same result except `desktop-1280x720`: 59.34 fps, 2 frames under 55 (so it failed the zero-slow-frame criterion); software row 34.16 fps, tier 3. |
| (earlier `results.json`, overwritten) | ANGLE Metal, Apple M1 Max (hardware GPU, not throttled) for the four budget rows; SwiftShader for the software row. Shader at commit f6d2ef8 (look pass 2) (steam-renderer-v1 after look pass 2) | `BENCH_ANGLE=metal npm run bench`, 2026-11-25 20:23-20:25 WIB, load average 48 → 34 (1-min) | Second of two back-to-back runs. Budget rows: 901 frames at 60 fps, 0 frames under 55, tier 0 on all four. Software row: 43.02 fps, 162 frames under 55, governor ended at tier 3 (static pane). The first run (20:22, load average 70 → 50) had the same result except `desktop-1280x720`: 59.07 fps, 1 frame under 55 (so it failed the zero-slow-frame criterion), and the software row ended at tier 2 (11.11 fps). |

Both are the same machine and build. The Pixel 5 profile throttles the CPU only (4×), never the GPU, so it is not a real phone: a physical-device run is still owed. `derive` (one-time, on load) took 345.9 ms under 4× CPU before D6 removed the channel dilation, and 103.4 ms after it (metal file), still over the 50 ms budget in R15.5 (task 39 moves it into a Web Worker). The SwiftShader row is not re-run on the D6-D11 shader yet.


## Cook Mode: `cook.json`

Written by `scripts/measure-cook.ts` (`npm run bench:cook`): the deep link `/#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12&lead=3&fps=1` in the production build, every `requestAnimationFrame` interval for 15 s from `cook:ready` (lead-in, write-on, hold), and the times from navigation to `cook:ready` and to `cook:reveal:till-it-looks-red-smooth`. Run 2026-11-25T00:15:58.762Z on Apple M1 Max, Chromium 159.0.8154.6, SwiftShader.

| Profile | Mean fps | Min fps | Worst frame ms | Frames over 18.2 ms | Nav to ready ms | Nav to reveal ms | Budget |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `desktop-1280x720` | 59.54 | 29.94 | 33.4 | 7 | 1553 | 3108 | fail |
| `pixel5-4x-cpu` | 28.01 | 14.99 | 66.7 | 388 | 1814 | 3276 | fail |

Both profiles miss the budget in this run. The machine was loaded (load averages 16.96 25.49 22.56 by `uptime`), and the renderer-only benchmark re-run under the same load measured 34.3 fps desktop and 21.78 fps on the Pixel 5 profile (`docs/kiro-evidence/cook-mode/renderer-same-load.txt`), below Cook Mode's own figures, so this run does not separate Cook Mode's cost from the load. A run on an idle machine is still owed.
