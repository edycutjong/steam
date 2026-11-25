# DX report: friction with Kiro itself

Dated entries, newest last, plain facts.

## 2026-11-25

- The shell tool's default timeout (120 s) killed a foreground `npx playwright test` run with no output; the suite takes about 6 minutes. Reran it in the background with `nohup` and polled the log.
- A tool result of 35 KB (a `cat` of a spec plus a config) was cut to its first and last 500 characters; the full text was in a file under the session folder and had to be re-read in smaller commands.
