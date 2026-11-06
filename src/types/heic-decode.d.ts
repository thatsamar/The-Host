// heic-decode ships no types. Only what server-photos.ts uses.
declare module "heic-decode" {
  interface DecodedImage {
    width: number;
    height: number;
    /** RGBA, 4 bytes a pixel. */
    data: Uint8ClampedArray;
  }
  interface HeicImage {
    width: number;
    height: number;
    decode(): Promise<DecodedImage>;
  }
  interface Decode {
    (input: { buffer: Uint8Array }): Promise<DecodedImage>;
    /** Every image in the file, undecoded; call `dispose` when done to free the decoder's memory. */
    all(input: { buffer: Uint8Array }): Promise<HeicImage[] & { dispose(): void }>;
  }
  const decode: Decode;
  export default decode;
}
