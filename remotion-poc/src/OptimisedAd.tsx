import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

/**
 * Tiny proof-of-concept "counter": takes a written hook + brand mark and
 * composes a finished, brand-styled 9:16 ad over a dark/amber background.
 * In production the background would be the AI-generated clip from the oven.
 */
export const OptimisedAd: React.FC<{ hook: string }> = ({ hook }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Hook captions slide/fade up (this is the "burn the hook onto the video" part).
  const enter = spring({ frame: frame - 10, fps, config: { damping: 200 } });
  const y = interpolate(enter, [0, 1], [60, 0]);
  const opacity = interpolate(frame, [10, 30], [0, 1], { extrapolateRight: 'clamp' });

  // Slow amber glow drift so it feels alive, not a static slide.
  const glow = interpolate(frame, [0, durationInFrames], [0.25, 0.55]);
  const outro = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
  });

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0a' }}>
      {/* amber glow — stands in for AI clip background */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 35%, rgba(245,158,11,${glow}) 0%, rgba(10,10,10,0) 60%)`,
        }}
      />
      {/* brand mark top */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-start',
          alignItems: 'center',
          paddingTop: 90,
          opacity: outro,
        }}
      >
        <div
          style={{
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontSize: 34,
            letterSpacing: 6,
            color: '#f59e0b',
            fontWeight: 700,
          }}
        >
          THE PRO BUILDER
        </div>
      </AbsoluteFill>
      {/* the hook caption */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: 80,
          transform: `translateY(${y}px)`,
          opacity: opacity * outro,
        }}
      >
        <div
          style={{
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontSize: 84,
            lineHeight: 1.1,
            fontWeight: 800,
            color: '#ffffff',
            textAlign: 'center',
          }}
        >
          {hook}
        </div>
      </AbsoluteFill>
      {/* tagline bottom */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingBottom: 110,
          opacity: outro,
        }}
      >
        <div
          style={{
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontSize: 30,
            color: 'rgba(255,255,255,0.6)',
            letterSpacing: 2,
          }}
        >
          Engineered For Performance.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
