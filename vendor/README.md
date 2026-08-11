# vendor/

Drop point for local-only binaries that must never be committed or bundled.
Everything in this directory except this file is gitignored.

## `vendor/g719/`

The G.719 codec modules used by the audio tests:

```
vendor/g719/g719.wasm            decoder
vendor/g719/g719-encoder.wasm    encoder
```

These are proprietary build artifacts and are not distributed with Bachi. The
application does not read this directory — the shipped editor takes the modules
from the user at runtime and keeps them in IndexedDB. Only the test suite reads
them, and only to verify the decode/encode paths.

Point somewhere else with `BACHI_G719_DIR` in `.env`. Without them, the G.719
suites skip and the rest of the tests still run.
