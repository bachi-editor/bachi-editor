# Third-party notices

"Bundled components" covers third-party code that ships inside Bachi, with its
license text. "Acknowledgements" credits projects Bachi builds *on* without
redistributing any of their code.

## Bundled components

### tja2fumen

The TJA-to-fumen conversion model in `src/model/tjaImport.ts` is derived in
part from [tja2fumen](https://github.com/vivaria/tja2fumen).

MIT License

Copyright (c) 2023 Vivaria

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### TaikoSoundEditor nus3bank template

`src/assets/song-template.nus3bank` is copied from
[TaikoSoundEditor](https://github.com/NotImplementedLife/TaikoSoundEditor).

MIT License

Copyright (c) 2023 NotImplementedLife

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Acknowledgements

No code from the projects below is bundled in Bachi; they are credited for the
knowledge and formats the editor builds on.

### TaikoLocalServer

[TaikoLocalServer](https://github.com/asesidaa/TaikoLocalServer) is the server
implementation whose data formats Bachi's server-data editing targets (the dan
course files in `src/codec/serverdata/`). Bachi reads and writes those formats
from a clean-room implementation and redistributes none of its code.

The repository publishes no license file, so no license is asserted here and
none of its source may be vendored into this project.
