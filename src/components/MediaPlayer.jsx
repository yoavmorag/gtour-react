import React, { useRef, useState, useEffect } from 'react';

export default function MediaPlayer({ src, playSignal }) {
    const audioRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);

    // Play audio when playSignal or src changes
    useEffect(() => {
        if (src && playSignal) {
            audioRef.current.currentTime = 0;
            audioRef.current.play();
            setIsPlaying(true);
        }
    }, [src, playSignal]);

    const handlePauseContinue = () => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            audioRef.current.play();
            setIsPlaying(true);
        }
    };

    // Update play state if user pauses/plays via browser controls
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        return () => {
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
        };
    }, []);

    const isDisabled = !src;

    return (
        <div style={{
            position: 'fixed',
            bottom: 10,
            left: 10,
            background: '#f8f8f8',
            border: '1px solid #ccc',
            borderRadius: 8,
            padding: 10,
            minWidth: 220,
            zIndex: 100,
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            opacity: isDisabled ? 0.6 : 1,
            pointerEvents: 'auto'
        }}>
            <audio
                ref={audioRef}
                src={src || ''}
                preload="auto"
                onError={() => console.error("Audio failed to load:", src)}
            />
            <button
                onClick={handlePauseContinue}
                style={{
                    marginRight: 12,
                    padding: '4px 16px',
                    borderRadius: 5,
                    border: 'none',
                    background: isDisabled ? '#ccc' : '#888',
                    color: '#fff',
                    fontSize: 16,
                    cursor: isDisabled ? 'not-allowed' : 'pointer'
                }}
                disabled={isDisabled}
            >
                {isPlaying ? 'Pause' : 'Continue'}
            </button>
            <input
                type="text"
                value={src ? src.split('/').pop() : ''}
                readOnly
                style={{
                    width: 120,
                    fontSize: 14,
                    border: '1px solid #ccc',
                    borderRadius: 4,
                    padding: '2px 6px',
                    background: '#fff'
                }}
                disabled={isDisabled}
            />
        </div>
    );
}