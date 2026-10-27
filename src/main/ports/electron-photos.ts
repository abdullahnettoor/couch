import { nativeImage } from "electron";
import { meanBrightness, PhotoFiles, type EncodedPhoto, type Photos } from "./photos.ts";

const SAMPLE = 32;
const MAX_SIDE = 4096;

/** Photos decoded and re-encoded by Electron's nativeImage, in the main process. */
export class ElectronPhotos extends PhotoFiles implements Photos {
  encode(bytes: Buffer): EncodedPhoto | undefined {
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return undefined;
    const { width, height } = image.getSize();
    if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) return undefined;
    const small = image.resize({ width: SAMPLE, height: SAMPLE, quality: "good" });
    return { jpeg: image.toJPEG(85), brightness: meanBrightness(small.toBitmap(), true) };
  }
}
