import { EventEmitter, WritableOptions } from 'node:stream';
import { EncodedMediaWritable, MediaEncoder, isAudioDefinition, isVideoDefinition } from './MediaStream';
import ffmpeg from 'ffmpeg.js';

const { FormatContext, OutputFormat } = ffmpeg;

export const verbose = (process.env.DEBUG_MUXER || process.env.DEBUG_ALL) ? console.debug.bind(console) : () => undefined;

export interface MuxerOptions extends WritableOptions {
  outputFile: string;
  outputFormat?: string;
  streams: MediaEncoder[];
  objectMode?: never;
}

/**
 * A Muxer is an object that creates a number of Writables
 * that can accept data from encoders.
 * The encoders must be created before creating the Muxer as
 * their parameters must be known beforehand.
 * Emits 'finish' on close.
 * 
 * @example
 * const output = new Muxer({ outputFile: tempFile, streams: [videoOutput, audioOutput] });
 */
export class Muxer extends EventEmitter {
  protected outputFile: string;
  protected outputFormatName: string;
  protected outputFormat: any;
  protected formatContext: any;
  protected rawStreams: MediaEncoder[];
  protected writing: boolean;
  protected primed: boolean;
  protected ended: number;
  protected writingQueue: { idx: number, packet: any, callback: (error?: Error | null | undefined) => void; }[];
  streams: EncodedMediaWritable[];
  video: EncodedMediaWritable[];
  audio: EncodedMediaWritable[];

  constructor(options: MuxerOptions) {
    super();
    this.outputFile = options.outputFile;
    this.outputFormatName = options.outputFormat ?? '';
    this.rawStreams = options.streams;
    this.streams = [];
    this.audio = [];
    this.video = [];
    this.writing = false;
    this.primed = false;
    this.ended = 0;
    this.writingQueue = [];

    for (const idx in this.rawStreams) {
      const writable = new EncodedMediaWritable({
        objectMode: true,
        write: (chunk: any, encoding: BufferEncoding, callback: (error?: Error | null | undefined) => void) => {
          this.write(+idx, chunk, callback);
        },
        destroy: (error: Error | null, callback: (error: Error | null) => void): void => {
          if (error) {
            verbose(`Muxer: error on stream #${idx}, destroy all streams`, error);
            for (const s in this.streams) {
              if (s !== idx)
                this.streams[s].destroy(error);
            }
            this.formatContext.closeAsync()
              .then(() => callback(error))
              .catch(callback);
          } else {
            verbose(`Muxer: destroy stream #${idx}`);
            callback(null);
          }
        },
        final: (callback: (error: Error | null) => void): void => {
          verbose(`Muxer: end stream #${idx}`);
          this.ended++;
          if (this.ended === this.streams.length) {
            verbose('Muxer: All streams ended, writing trailer');
            this.formatContext.writeTrailerAsync()
              .then(() => this.formatContext.closeAsync())
              .then(() => this.emit('finish'))
              .then(() => callback(null))
              .catch(callback);
          } else {
            callback(null);
          }
        },
      });
      this.streams[+idx] = writable;
      const def = this.rawStreams[idx].definition();

      if (def.type === 'Video') {
        this.video.push(writable);
      } else if (def.type === 'Audio') {
        this.audio.push(writable);
      } else {
        throw new Error('Unsupported stream type');
      }
    }
  }

  protected async prime(): Promise<void> {
    verbose(`Muxer: opening ${this.outputFile}`);
    this.outputFormat = new OutputFormat;
    this.outputFormat.setFormat(this.outputFormatName, this.outputFile, '');
    this.formatContext = new FormatContext;
    this.formatContext.setOutputFormat(this.outputFormat);

    for (const idx in this.rawStreams) {
      const coder = this.rawStreams[idx].coder();
      const def = this.rawStreams[idx].definition();

      let stream;
      if (isVideoDefinition(def)) {
        stream = this.formatContext.addVideoStream(coder);
        stream.setFrameRate(def.frameRate);
      } else if (isAudioDefinition(def)) {
        stream = this.formatContext.addAudioStream(coder);
      } else {
        throw new Error('Unsupported stream type');
      }
      verbose(`Muxer: created stream #${idx}: type ${stream.mediaType()}, ` +
        `${stream.isVideo() ? 'video' : ''}${stream.isAudio() ? 'audio' : ''}`);
    }

    await this.formatContext.openOutputAsync(this.outputFile);
    await this.formatContext.dumpAsync();
    await this.formatContext.writeHeaderAsync();
    await this.formatContext.flushAsync();
    this.primed = true;
    this.emit('ready');
    verbose('Muxer: ready');
  }

  protected write(idx: number, packet: any, callback: (error?: Error | null | undefined) => void): void {
    if (!packet.isComplete()) {
      verbose('Muxer: skipping empty packet (codec is still priming)');
      callback();
      return;
    }

    this.writingQueue.push({ idx, packet, callback });
    if (this.writing) {
      verbose(`Muxer: enqueuing for writing on #${idx}, pts=${packet.pts()}, queue length ${this.writingQueue.length}`);
      return;
    }

    (async () => {
      this.writing = true;
      if (!this.primed) {
        await this.prime();
      }
      while (this.writingQueue.length > 0) {
        const job = this.writingQueue.shift()!;
        try {
          job.packet.setStreamIndex(job.idx);
          verbose(`Muxer: packet #${job.idx}: pts=${job.packet.pts()}, dts=${job.packet.dts()} / ${job.packet.pts().seconds()} / ${job.packet.timeBase()} / stream ${job.packet.streamIndex()}, size: ${job.packet.size()}`);
          await this.formatContext.writePacketAsync(job.packet);
          job.callback();
        } catch (err) {
          verbose(`Muxer: ${err}`);
          job.callback(err as Error);
        }
      }
      this.writing = false;
    })();
  }
}

