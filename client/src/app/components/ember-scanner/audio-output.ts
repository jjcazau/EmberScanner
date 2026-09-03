/** Keeps one media player and local stream alive across individual radio calls. */
export class ScannerAudioOutput {
    readonly destination: AudioNode;

    private player?: HTMLAudioElement;
    private stream?: MediaStreamAudioDestinationNode;
    private silence?: AudioBufferSourceNode;
    private active = false;
    private disposed = false;

    constructor(private context: AudioContext, document: Document, onPause: () => void) {
        this.destination = context.destination;
        const player = document.createElement('audio');

        if (!('srcObject' in player) || !context.createMediaStreamDestination) return;

        try {
            this.stream = context.createMediaStreamDestination();
            player.srcObject = this.stream.stream;
            player.setAttribute('playsinline', '');
            player.setAttribute('aria-hidden', 'true');
            player.hidden = true;
            player.preload = 'auto';
            player.addEventListener('pause', () => {
                // Native media controls can pause the element without calling our UI.
                if (this.active && player.paused) onPause();
            });
            document.body.appendChild(player);
            this.player = player;
            this.destination = this.stream;
        } catch (error) {
            this.stream?.stream.getTracks().forEach(track => track.stop());
            this.stream = undefined;
            player.srcObject = null;
            player.remove();
            console.warn('Local audio streaming unavailable; using direct audio output', error);
        }
    }

    async start(): Promise<void> {
        if (this.disposed) return;
        this.active = true;

        try {
            if (this.stream && !this.silence) {
                // Render actual silence between transmissions without JS timers.
                // This keeps the same track open; iOS may still suspend a quiet app.
                this.silence = this.context.createBufferSource();
                this.silence.buffer = this.context.createBuffer(1, 128, this.context.sampleRate);
                this.silence.loop = true;
                this.silence.connect(this.stream);
                this.silence.start();
            }

            // Start both operations inside the initiating user gesture, before awaiting.
            const resume = this.context.state === 'running' ? Promise.resolve() : this.context.resume();
            const play = this.player?.paused ? this.player.play() : Promise.resolve();
            await Promise.all([resume, play]);

            // A pause/stop may have happened while iOS was starting the player.
            if (!this.active || this.disposed) this.player?.pause();
        } catch (error) {
            if (this.active && !this.disposed) {
                console.warn('Audio playback could not resume; tap Live Feed or Play to retry', error);
            }
        }
    }

    stop(): void {
        this.active = false;
        this.player?.pause();
        if (this.silence) {
            this.silence.stop();
            this.silence.disconnect();
            this.silence = undefined;
        }
    }

    dispose(): void {
        this.disposed = true;
        this.stop();
        this.stream?.stream.getTracks().forEach(track => track.stop());
        if (this.player) {
            this.player.srcObject = null;
            this.player.remove();
        }
        this.player = undefined;
        this.stream = undefined;
    }
}
