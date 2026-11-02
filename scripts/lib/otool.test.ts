import { describe, expect, it } from "vite-plus/test";
import { parseOtool } from "./otool.mts";

const deps = `/opt/homebrew/Cellar/ffmpeg/9.0.2_1/lib/libavcodec.63.dylib:
\t/opt/homebrew/opt/ffmpeg/lib/libavcodec.63.dylib (compatibility version 63.0.0, current version 63.1.102)
\t@rpath/libswresample.7.dylib (compatibility version 7.0.0, current version 7.1.100)
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
\t/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 150.0.0, current version 3000.0.0)
`;
const id = `/opt/homebrew/Cellar/ffmpeg/9.0.2_1/lib/libavcodec.63.dylib:
/opt/homebrew/opt/ffmpeg/lib/libavcodec.63.dylib
`;
const loads = `Load command 12
          cmd LC_RPATH
      cmdsize 40
         path @loader_path/../lib (offset 12)
Load command 13
          cmd LC_LOAD_DYLIB
      cmdsize 56
Load command 14
          cmd LC_RPATH
      cmdsize 48
         path /opt/homebrew/lib (offset 12)
`;

describe("parseOtool", () => {
  it("lists references without the library's own install name, system ones included", () => {
    expect(parseOtool({ deps, id, loads }).deps).toEqual([
      "@rpath/libswresample.7.dylib",
      "/usr/lib/libSystem.B.dylib",
      "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation",
    ]);
  });
  it("reads every rpath, in order", () => {
    expect(parseOtool({ deps, id, loads }).rpaths).toEqual([
      "@loader_path/../lib",
      "/opt/homebrew/lib",
    ]);
  });
  it("copes with no rpaths and with a file that has no install name", () => {
    expect(parseOtool({ deps, id: "x.dylib:\n", loads: "" })).toEqual({
      deps: [
        "/opt/homebrew/opt/ffmpeg/lib/libavcodec.63.dylib",
        "@rpath/libswresample.7.dylib",
        "/usr/lib/libSystem.B.dylib",
        "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation",
      ],
      rpaths: [],
    });
  });
});
