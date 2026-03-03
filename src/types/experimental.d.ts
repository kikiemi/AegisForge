interface MLContext {
    compute(graph: MLGraph, inputs: Record<string, MLOperand>, outputs: Record<string, MLOperand>): Promise<void>;
}

interface MLOperandDescriptor {
    dataType?: 'float32' | 'float16' | 'int32' | 'uint32' | 'int8' | 'uint8';
    type?: 'float32' | 'float16' | 'int32' | 'uint32' | 'int8' | 'uint8';
    dimensions: number[];
}

interface MLOperand { }

interface MLGraph {
    compute(inputs: Record<string, ArrayBufferView>, outputs: Record<string, ArrayBufferView>): Promise<void>;
}

interface MLGraphBuilder {
    input(name: string, desc: MLOperandDescriptor): MLOperand;
    constant(desc: MLOperandDescriptor, buffer: ArrayBufferView): MLOperand;
    conv2d(input: MLOperand, filter: MLOperand, options?: Record<string, unknown>): MLOperand;
    add(a: MLOperand, b: MLOperand): MLOperand;
    relu(input: MLOperand): MLOperand;
    clamp(input: MLOperand, options?: { minValue?: number; maxValue?: number }): MLOperand;
    sigmoid(input: MLOperand): MLOperand;
    reshape(input: MLOperand, newShape: number[]): MLOperand;
    resample2d(input: MLOperand, options?: { sizes?: number[]; mode?: string }): MLOperand;
    build(outputs: Record<string, MLOperand>): Promise<MLGraph>;
}

declare var MLGraphBuilder: {
    new(context: MLContext): MLGraphBuilder;
};

interface NavigatorML {
    ml?: {
        createContext(options?: { deviceType?: string }): Promise<MLContext>;
    };
}


interface DetectedFace {
    boundingBox: DOMRectReadOnly;
}

interface FaceDetectorOptions {
    fastMode?: boolean;
    maxDetectedFaces?: number;
}

declare class FaceDetector {
    constructor(options?: FaceDetectorOptions);
    detect(image: ImageBitmapSource): Promise<DetectedFace[]>;
}

interface DetectedBarcode {
    boundingBox: DOMRectReadOnly;
    rawValue: string;
    format: string;
}

interface BarcodeDetectorOptions {
    formats?: string[];
}

declare class BarcodeDetector {
    constructor(options?: BarcodeDetectorOptions);
    detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}


interface SpeechRecognitionResult {
    readonly length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
    isFinal: boolean;
}

interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
    error: string;
    message: string;
}

declare class SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: ((event: Event) => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}


interface FileSystemSyncAccessHandle {
    read(buffer: ArrayBufferView, options?: { at?: number }): number;
    write(buffer: ArrayBufferView, options?: { at?: number }): number;
    truncate(newSize: number): void;
    getSize(): number;
    flush(): void;
    close(): void;
}

interface FileSystemFileHandle {
    createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
}


interface OffscreenCanvas {
    convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob>;
}


interface CanvasRenderingContext2D {
    imageSmoothingQuality: 'low' | 'medium' | 'high';
}

interface OffscreenCanvasRenderingContext2D {
    imageSmoothingQuality: 'low' | 'medium' | 'high';
}


interface Window {
    SpeechRecognition?: typeof SpeechRecognition;
    webkitSpeechRecognition?: typeof SpeechRecognition;
    FaceDetector?: typeof FaceDetector;
    BarcodeDetector?: typeof BarcodeDetector;
    webkitAudioContext?: typeof AudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
}

interface Navigator extends NavigatorML { }


declare var webkitAudioContext: typeof AudioContext | undefined;
declare var webkitOfflineAudioContext: typeof OfflineAudioContext | undefined;


interface MediaStreamTrackProcessor {
    readable: ReadableStream;
}

declare var MediaStreamTrackProcessor: {
    new(options: { track: MediaStreamTrack }): MediaStreamTrackProcessor;
} | undefined;


interface HTMLVideoElement {
    requestVideoFrameCallback(callback: (now: DOMHighResTimeStamp, metadata: Record<string, unknown>) => void): number;
    cancelVideoFrameCallback(handle: number): void;
}
