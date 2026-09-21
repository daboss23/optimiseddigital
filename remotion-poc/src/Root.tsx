import { Composition } from 'remotion';
import { OptimisedAd } from './OptimisedAd';
import { AdvancedDemo } from './AdvancedDemo';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="OptimisedAd"
        component={OptimisedAd}
        durationInFrames={120}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ hook: 'Stop guessing what to build next.' }}
      />
      <Composition
        id="AdvancedDemo"
        component={AdvancedDemo}
        durationInFrames={690}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
