/**
 * Asset Generation Types - V2
 * Inspired by PiXelDa architecture
 */

// ============== Model Configuration ==============

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  modelType: 'tongyi' | 'doubao' | 'openai-compat' | 'minimax';
}

export interface ImageModelConfig extends ModelConfig {
  modelNameGeneration: string;
  modelNameEditing: string;
  temperature?: number;
  timeout?: number;
}

export interface VideoModelConfig extends ModelConfig {
  modelNameVideo: string;
  modelNameVideoText?: string;
  resolution?: '480P' | '720P' | '512P' | '768P' | '1080P';
}

export interface AudioModelConfig extends ModelConfig {
  modelNameChat: string;
  maxTokens?: number;
  /** MiniMax `music_generation` model (e.g. music-2.6, music-2.6-free). */
  musicModel?: string;
  /** MiniMax speech model for SFX (e.g. speech-2.8-turbo). */
  speechModel?: string;
  /** MiniMax T2A voice_id (e.g. male-qn-qingse). */
  speechVoiceId?: string;
}

// ============== Request Types ==============

export interface BaseAssetRequest {
  key: string;
  description: string;
}

export interface BackgroundRequest extends BaseAssetRequest {
  type: 'background';
  resolution?: '1024*1024' | '1536*1024' | '2048*2048';
}

export interface ImageRequest extends BaseAssetRequest {
  type: 'image';
  size?: '512*512' | '1024*1024';
  /**
   * When true, keep the generated background (no auto matting).
   * Default false — sprites are matted like the platform seed path.
   */
  keepBackground?: boolean;
}

export interface AnimationDef {
  name: string;
  frameCount: number;
  action_desc: string;
}

export interface AnimationRequest extends BaseAssetRequest {
  type: 'animation';
  animations: AnimationDef[];
  /**
   * Use I2V (Image-to-Video) for animation generation
   * Default: true (recommended - outputs to Beijing OSS which is accessible)
   * If set to false, uses I2I (Image-to-Image) which may have OSS network issues
   */
  useI2V?: boolean;
}

export interface AudioRequest extends BaseAssetRequest {
  type: 'audio';
  audioType: 'bgm' | 'sfx';
  duration?: number;
  genre?: string;
  tempo?: 'slow' | 'medium' | 'fast';
}

export interface TilesetRequest extends BaseAssetRequest {
  type: 'tileset';
  /** Grid size (default 7 = 7x7 = 49 tiles) */
  tileset_size?: number;
  /** Pixel size per tile (default 64) */
  tile_size?: number;
}

export type AssetRequest =
  | BackgroundRequest
  | ImageRequest
  | AnimationRequest
  | AudioRequest
  | TilesetRequest;

// ============== Generation Parameters ==============

export interface GenerateAssetsParams {
  style_anchor: string;
  composition_env?: string;
  output_dir_name?: string;
  model_type?: 'tongyi' | 'doubao' | 'openai-compat';
  assets: AssetRequest[];
}

// ============== Response Types ==============

export interface GenerationResult {
  success: boolean;
  key: string;
  url?: string;
  error?: string;
}

export interface ImageGenerationResponse {
  url: string;
  taskId?: string;
}

export interface VideoGenerationResponse {
  videoUrl: string;
  taskId: string;
}

export interface AudioGenerationResponse {
  originalUrl: string;
  chiptuneUrl?: string;
}

// ============== Asset Pack Types ==============

export interface AssetPackFile {
  type: 'image' | 'audio' | 'video' | 'tileset';
  key: string;
  url: string;
}

export interface AssetPack {
  [section: string]: { files: AssetPackFile[] };
}

// ============== Frame Split Types ==============

export interface FrameSplitRequest {
  videoUrl: string;
  fromTime: number;
  toTime: number;
  frameCount: number;
}

export interface FrameSplitResult {
  frames: Buffer[];
  frameUrls?: string[];
}
