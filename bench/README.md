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
| `steam-renderer.json` | ANGLE SwiftShader (software GL; Chromium's default in this headless run) | `npm run bench` | ~59.5-59.8 fps average, 3-6 frames under 55 per profile → fails the zero-slow-frame criterion |
| `steam-renderer-metal.json` | ANGLE Metal, Apple M1 Max (hardware GPU, not throttled) | `BENCH_ANGLE=metal npm run bench`, then the file renamed | 901 frames per profile at 60 fps, 0 frames under 55 on all three profiles |

Both are the same machine and build. The Pixel 5 profile throttles the CPU only (4×), never the GPU, so it is not a real phone: a physical-device run is still owed. `derive` (one-time, on load) took 345.9 ms under 4× CPU, over the 50 ms budget in R15.5 (task 39 moves it into a Web Worker).
