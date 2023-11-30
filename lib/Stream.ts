export const StreamTypes = {
  'Audio': 'Audio',
  'Video': 'Video',
  'Subtitle': 'Subtitle',
  'Data': 'Data'
} as const;

export type StreamType = keyof typeof StreamTypes;

export interface StreamDefinition {
  type: StreamType;
  bitRate: number;
  codec: number;
  timeBase?: any;
}

export interface VideoStreamDefinition extends StreamDefinition {
  type: 'Video';
  width: number;
  height: number;
  frameRate: number;
  pixelFormat: any;
}

export interface AudioStreamDefinition extends StreamDefinition {
  type: 'Audio';
  channelLayout: any;
  sampleFormat: any;
  sampleRate: any;
}

export function isVideoDefinition(def: StreamDefinition): def is VideoStreamDefinition {
  return def.type === 'Video';
}

export function isAudioDefinition(def: StreamDefinition): def is AudioStreamDefinition {
  return def.type === 'Audio';
}

export { Muxer } from './Muxer';
export { Demuxer } from './Demuxer';
export { VideoEncoder } from './VideoEncoder';
export { VideoDecoder } from './VideoDecoder';
export { VideoTransform } from './VideoTransform';
export { AudioDecoder } from './AudioDecoder';
export { AudioEncoder } from './AudioEncoder';
export { AudioTransform } from './AudioTransform';
export { Discarder } from './Discarder';
