import { nativeImage } from "electron";
import {
  imageSize,
  MAX_PIXELS,
  MAX_SIDE,
  meanBrightness,
  PhotoFiles,
  type EncodedPhoto,
  type Photos,
} from "./photos.ts";

const SAMPLE = 32;

/** Photos decoded and re-encoded by Electron's nativeImage, in the main process. */
export class ElectronPhotos extends PhotoFiles implements Photos {
  encode(bytes: Buffer): EncodedPhoto | undefined {
    // The declared size is read from the header first: decoding is where a small file turns into gigabytes.
    const declared = imageSize(bytes);
    if (!declared) return undefined;
    const { width, height } = declared;
    if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) return undefined;
    if (width * height > MAX_PIXELS) return undefined;
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return undefined;
    const small = image.resize({ width: SAMPLE, height: SAMPLE, quality: "good" });
    return { jpeg: image.toJPEG(85), brightness: meanBrightness(small.toBitmap(), true) };
  }
}
