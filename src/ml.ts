import { log, AegisError } from './core';

export class WebML {

    public static async autoCaptionStream(stream: MediaStream, lang: string = 'en-US'): Promise<string> {
        return new Promise((resolve, reject) => {
            const SpeechReco = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechReco) return reject(new AegisError("SpeechRecognition not supported."));

            const reco = new SpeechReco();
            reco.continuous = true;
            reco.interimResults = false;
            reco.lang = lang;

            let srt = "";
            let idx = 1;

            reco.onresult = (event: SpeechRecognitionEvent) => {
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        const text = event.results[i][0].transcript;
                        const start = new Date(idx * 2000).toISOString().substr(11, 12).replace('.', ',');
                        const end = new Date((idx + 1) * 2000).toISOString().substr(11, 12).replace('.', ',');
                        srt += `${idx}\n${start} --> ${end}\n${text.trim()}\n\n`;
                        idx++;
                    }
                }
            };

            reco.onerror = (e: SpeechRecognitionErrorEvent) => reject(e);
            reco.onend = () => resolve(srt);

            reco.start();
            const tracks = stream.getAudioTracks();
            if (tracks.length > 0) {
                tracks[0].addEventListener('ended', () => reco.stop());
            }
            stream.addEventListener('inactive', () => reco.stop());
        });
    }

    public static async detectFaces(source: CanvasImageSource | VideoFrame | Blob): Promise<DetectedFace[]> {
        if (!window.FaceDetector) {
            log.warn("WebML", "FaceDetector API not supported in this browser.");
            return [];
        }
        try {
            const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 10 });
            return await detector.detect(source as ImageBitmapSource);
        } catch (e) {
            log.error("FaceDetector failed", e);
            return [];
        }
    }

    public static async detectBarcodes(source: CanvasImageSource | VideoFrame | Blob): Promise<DetectedBarcode[]> {
        if (!window.BarcodeDetector) {
            log.warn("WebML", "BarcodeDetector API not supported in this browser.");
            return [];
        }
        try {
            const detector = new BarcodeDetector({ formats: ['qr_code', 'ean_13'] });
            return await detector.detect(source as ImageBitmapSource);
        } catch (e) {
            log.error("BarcodeDetector failed", e);
            return [];
        }
    }
}
