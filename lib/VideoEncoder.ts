import { Transform } from 'node:stream';
import ffmpeg from '..';
import { VideoStreamDefinition } from './Stream';
import { TransformCallback } from 'stream';

const { VideoEncoderContext, Codec, VideoFrame } = ffmpeg;

export const verbose = (process.env.DEBUG_VIDEO_ENCODER || process.env.DEBUG_ALL) ? console.debug.bind(console) : () => undefined;

export class VideoEncoder extends Transform {
  protected def: VideoStreamDefinition;
  protected encoder: any;
  protected codec: any;
  protected busy: boolean;

  constructor(def: VideoStreamDefinition) {
    super({ objectMode: true });
    this.def = def;
    this.codec = ffmpeg.findEncodingCodec(this.def.codec);
    verbose(`VideoEncoder: using ${this.codec.name()}`);
    this.encoder = new VideoEncoderContext(this.codec);
    this.encoder.setWidth(this.def.width);
    this.encoder.setHeight(this.def.height);
    if (this.def.timeBase)
      this.encoder.setTimeBase(this.def.timeBase);
    else
      this.encoder.setTimeBase(new ffmpeg.Rational(1, 1000));
    this.encoder.setBitRate(this.def.bitRate);
    this.encoder.setPixelFormat(this.def.pixelFormat);
    this.busy = false;
  }

  _construct(callback: (error?: Error | null | undefined) => void): void {
    (async () => {
      this.busy = true;
      verbose('VideoEncoder: priming the encoder');
      await this.encoder.openCodecAsync(this.codec);
      verbose(`VideoEncoder: encoder primed, codec ${this.codec.name()}, ` +
        `bitRate: ${this.encoder.bitRate()}, pixelFormat: ${this.encoder.pixelFormat()}, ` +
        `timeBase: ${this.encoder.timeBase()}, ${this.encoder.width()}x${this.encoder.height()}`
      );
      this.busy = false;
    })().then(() => void callback()).then(() => this.emit('ready')).catch(callback);
  }

  _transform(frame: any, encoding: BufferEncoding, callback: TransformCallback): void {
    verbose('VideoEncoder: encoding frame');
    if (this.busy) return void callback(new Error('VideoEncoder called while busy, use proper writing semantics'));
    (async () => {
      this.busy = true;
      if (!this.encoder) {
        return void callback(new Error('VideoEncoder is not primed'));
      }
      if (!(frame instanceof VideoFrame)) {
        return void callback(new Error('Input is not a raw video'));
      }
      if (!frame.isComplete()) {
        return void callback(new Error('Received incomplete frame'));
      }
      frame.setPictureType(ffmpeg.AV_PICTURE_TYPE_NONE);
      frame.setTimeBase(this.encoder.timeBase());
      const packet = await this.encoder.encodeAsync(frame);
      verbose(`VideoEncoder: frame: pts=${frame.pts()} / ${frame.pts().seconds()} / ${frame.timeBase()} / ${frame.width()}x${frame.height()}, size=${frame.size()}, ref=${frame.isReferenced()}:${frame.refCount()} / type: ${frame.pictureType()} }`);
      this.push(packet);
      this.busy = false;
    })().then(() => void callback()).catch(callback);
  }

  _flush(callback: TransformCallback): void {
    verbose('VideoEncoder: flushing');
    if (this.busy) return void callback(new Error('VideoEncoder called while busy, use proper writing semantics'));
    this.encoder.finalizeAsync()
      .then((pkt: any) => this.push(pkt))
      .then(() => void callback())
      .catch(callback);
  }

  coder(): any {
    return this.encoder;
  }

  definition(): VideoStreamDefinition {
    return this.def;
  }
}
