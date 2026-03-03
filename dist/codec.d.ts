export declare class Vid {
    private f;
    private cp;
    private bw;
    private o;
    private wu;
    private w;
    private oc?;
    private oe?;
    private isGif;
    private gifEncoder?;
    private hasV;
    private qActive;
    constructor(o: any);
    init(): Promise<void>;
    private wc;
    pushVid(f: any, k?: boolean): Promise<void>;
    pushAud(a: any): Promise<void>;
    flush(): Promise<ArrayBuffer>;
    private _clean;
}
